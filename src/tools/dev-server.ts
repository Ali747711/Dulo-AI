// src/tools/dev-server.ts
// Start, list and stop a project's dev server.
//
// The shell tool cannot do this: it runs one program with a 30-second cap and
// no background jobs, so a server started through it is killed before anyone
// can look at the page. A server is a long-lived process with a URL and a
// lifecycle, so it gets a tool that owns exactly that.
//
// Servers deliberately outlive the turn that started one: the whole point of
// "ready to preview" is that the person can click the URL after the report.
// They stop on `stop`, after IDLE_TIMEOUT_MS without being touched, or when
// the harness shuts down.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readdir } from "node:fs/promises";
import path from "node:path";

import type { Tool } from "../types.js";
import { resolveSafe } from "./file.js";

const PORT_RANGE = { first: 5200, last: 5299 };
const DEFAULT_START_TIMEOUT_MS = 45_000;
/** Overridable so a test does not have to wait out the real timeout. */
const startTimeoutMs = (): number => {
  const raw = Number(process.env.DULO_DEV_SERVER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_START_TIMEOUT_MS;
};
const IDLE_TIMEOUT_MS = 30 * 60_000;
const LOG_LIMIT = 20_000;

interface Running {
  project: string;
  dir: string;
  port: number;
  url: string;
  child: ChildProcess;
  log: string;
  startedAt: number;
  touchedAt: number;
  idleTimer: NodeJS.Timeout;
}

/** Keyed by the project's absolute directory. */
const servers = new Map<string, Running>();

const tail = (text: string, lines = 15): string =>
  text.split("\n").filter(Boolean).slice(-lines).join("\n");

const isFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });

const pickPort = async (): Promise<number> => {
  const taken = new Set([...servers.values()].map((s) => s.port));
  for (let port = PORT_RANGE.first; port <= PORT_RANGE.last; port++) {
    if (taken.has(port)) continue;
    if (await isFree(port)) return port;
  }
  throw new Error(
    `No free port between ${PORT_RANGE.first} and ${PORT_RANGE.last}. Stop a running server first.`,
  );
};

const stopServer = async (entry: Running): Promise<void> => {
  clearTimeout(entry.idleTimer);
  servers.delete(entry.dir);
  if (entry.child.exitCode !== null || entry.child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const force = setTimeout(() => {
      entry.child.kill("SIGKILL");
      resolve();
    }, 3000);
    force.unref();
    entry.child.once("close", () => {
      clearTimeout(force);
      resolve();
    });
    entry.child.kill("SIGTERM");
  });
};

const touch = (entry: Running): void => {
  entry.touchedAt = Date.now();
  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => void stopServer(entry), IDLE_TIMEOUT_MS);
  entry.idleTimer.unref();
};

/** Stop every server this harness started. Called on shutdown. */
export const stopAllDevServers = async (): Promise<void> => {
  await Promise.all([...servers.values()].map((entry) => stopServer(entry)));
};

const URL_PATTERN = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?\S*)/i;

const start = async (project: string): Promise<string> => {
  const dir = await resolveSafe(project);

  const existing = servers.get(dir);
  if (existing) {
    touch(existing);
    return `Already running at ${existing.url} (started ${Math.round(
      (Date.now() - existing.startedAt) / 1000,
    )}s ago). Open that URL, or stop it first if you want a fresh start.`;
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new Error(`No project at "${project}" in the workspace.`);
  }
  if (!entries.includes("package.json")) {
    throw new Error(`"${project}" has no package.json, so there is nothing to run.`);
  }
  if (!entries.includes("node_modules")) {
    throw new Error(
      `"${project}" has no node_modules. Install its dependencies first (npm install).`,
    );
  }

  const port = await pickPort();
  const child = spawn(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: dir, shell: false, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );

  const entry: Running = {
    project,
    dir,
    port,
    url: "",
    child,
    log: "",
    startedAt: Date.now(),
    touchedAt: Date.now(),
    idleTimer: setTimeout(() => {}, 0),
  };
  clearTimeout(entry.idleTimer);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const collect = (chunk: Buffer) => {
      entry.log += chunk.toString("utf8");
      if (entry.log.length > LOG_LIMIT) entry.log = entry.log.slice(-LOG_LIMIT);
      const match = URL_PATTERN.exec(entry.log);
      if (!match) return;
      // Vite prints the port it really bound; trust the output over our guess.
      entry.url = match[1].replace(/\/$/, "") + "/";
      servers.set(dir, entry);
      touch(entry);
      finish(() =>
        resolve(
          `Running at ${entry.url} for "${project}" (port ${entry.port}). ` +
            `It keeps running after this turn, so the URL stays openable. ` +
            `Stop it with action "stop" when you are finished.\n\n${tail(entry.log, 6)}`,
        ),
      );
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    child.once("error", (error) =>
      finish(() => reject(new Error(`Could not start the dev server: ${error.message}`))),
    );
    child.once("close", (code) =>
      finish(() =>
        reject(
          new Error(
            `The dev server for "${project}" stopped before printing a URL (exit ${code}).\n\n${tail(entry.log)}`,
          ),
        ),
      ),
    );

    const waitMs = startTimeoutMs();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new Error(
            `The dev server for "${project}" printed no URL within ${
              waitMs / 1000
            }s and was stopped.\n\n${tail(entry.log)}`,
          ),
        ),
      );
    }, waitMs);
    timer.unref();
  });
};

export const devServerTool: Tool = {
  name: "dev_server",
  description:
    "Start, check or stop the development server of a project in the workspace, so its page " +
    "can be opened in a browser. Starting returns the URL. The server keeps running after " +
    "the turn ends; stop it when the work is finished.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "status", "stop"],
        description: "What to do. Default: start.",
      },
      project: {
        type: "string",
        description:
          "Project folder name, relative to the workspace root. Required for start and stop.",
      },
    },
    required: ["project"],
  },
  execute: async ({
    action = "start",
    project,
  }: {
    action?: "start" | "status" | "stop";
    project: string;
  }) => {
    if (action === "status") {
      if (servers.size === 0) return "No dev server is running.";
      return [...servers.values()]
        .map(
          (s) =>
            `${s.project}: ${s.url} (port ${s.port}, idle ${Math.round(
              (Date.now() - s.touchedAt) / 1000,
            )}s)`,
        )
        .join("\n");
    }

    if (!project?.trim()) throw new Error("project is required");

    if (action === "stop") {
      const dir = await resolveSafe(project);
      const entry = servers.get(dir);
      if (!entry) return `No dev server is running for "${project}".`;
      await stopServer(entry);
      return `Stopped the dev server for "${project}".`;
    }

    return start(project);
  },
};

/** Directory of a running server, for tests. */
export const runningProjects = (): string[] => [...servers.keys()].map((dir) => path.basename(dir));

export const devServerTools: Tool[] = [devServerTool];
