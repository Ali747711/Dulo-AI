// src/server.ts
// HTTP API for the Dulo web client. Runs stream back as Server-Sent Events.
import "./env.js";
import { mkdir } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";

import { FALLBACK_MODELS, MODEL } from "./llm.js";
import { closeRegistry, getRegistry, initRegistry } from "./registry.js";
import { createRunner } from "./session/runner.js";
import { handleSessionRoutes } from "./session/routes.js";
import { FileSessionStore } from "./session/store/files.js";
import { SESSIONS_DIR, WORKSPACE_ROOT } from "./paths.js";
import type { Tool } from "./types.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.DULO_CLIENT_ORIGIN ?? "http://localhost:5173";
// Where session data and the agent's workspace live: src/paths.ts, from
// DULO_SESSIONS_DIR / DULO_WORKSPACE_DIR, else under the checkout. A second
// harness started for testing MUST set both: PORT alone isolates nothing, so
// two instances otherwise share one directory — and a scratch instance's
// "clean up what I made" step then deletes the real instance's data too. That
// is not hypothetical: it destroyed this project's own session history once.

const corsHeaders = {
  "Access-Control-Allow-Origin": CLIENT_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify(body));
};

const runner = createRunner(new FileSessionStore(SESSIONS_DIR));

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      name: "dulo",
      model: MODEL,
      fallbackModels: FALLBACK_MODELS,
      hasApiKey: Boolean(process.env.OPENROUTER_API_KEY),
      toolCount: getRegistry().tools.length,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/tools") {
    json(
      res,
      200,
      getRegistry().tools.map(({ name, description, parameters }: Tool) => ({
        name,
        description,
        parameters,
      })),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/agents") {
    json(
      res,
      200,
      getRegistry().agents.map(({ name, description, model, tools: policy }) => ({
        name,
        description,
        model,
        tools: policy,
      })),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/skills") {
    json(
      res,
      200,
      getRegistry().skills.map(({ name, description }) => ({ name, description })),
    );
    return;
  }

  void handleSessionRoutes(req, res, url, {
    runner,
    corsHeaders,
    defaultModel: MODEL,
  }).then((handled) => {
    if (!handled) json(res, 404, { error: "not found" });
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dulo] route error:", message);
    if (!res.headersSent) json(res, 500, { error: message });
    else if (!res.writableEnded) res.end();
  });
});

// stdio MCP servers are child processes; without this they outlive the harness.
const shutdown = (signal: string) => {
  console.log(`\n[dulo] ${signal}, shutting down`);
  void closeRegistry().finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const start = async () => {
  try {
    await mkdir(WORKSPACE_ROOT, { recursive: true });
  } catch (error) {
    // The agent cannot work without somewhere to put its projects.
    console.error(
      `[dulo] cannot create the workspace ${WORKSPACE_ROOT}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
  await initRegistry();
  await runner.recover();
  server.listen(PORT, () => {
    console.log(`Dulo harness API listening on http://localhost:${PORT}`);
    console.log(`Allowing browser origin ${CLIENT_ORIGIN}`);
    // Printed on every start so a second instance pointed at the real data
    // directory is obvious before it writes anything, not after.
    console.log(`Sessions stored in ${SESSIONS_DIR}`);
    console.log(`Workspace: ${WORKSPACE_ROOT}`);
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn("Warning: OPENROUTER_API_KEY is not set, runs will fail");
    }
  });
};

void start();
