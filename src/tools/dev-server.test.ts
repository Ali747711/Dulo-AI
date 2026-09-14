// src/tools/dev-server.test.ts
// Starting returns a real URL, status lists it, stop ends the process, and a
// project whose dev script never prints a URL fails with the log instead of
// hanging (INV-12, AC-12). The fake projects use a Node script as their `dev`
// script, so no Vite install is needed.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const workspace = mkdtempSync(path.join(tmpdir(), "dulo-devserver-"));
process.env.DULO_WORKSPACE_DIR = workspace;

const { devServerTool, runningProjects, stopAllDevServers } = await import("./dev-server.js");

/** A project whose `npm run dev` behaves as described. */
const makeProject = (name: string, script: string) => {
  const dir = path.join(workspace, name);
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  writeFileSync(path.join(dir, "dev.mjs"), script);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, scripts: { dev: "node dev.mjs" } }),
  );
  return dir;
};

const GOOD = `
import { createServer } from "node:http";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
createServer((_req, res) => res.end("ok")).listen(port, "127.0.0.1", () => {
  console.log("  ➜  Local:   http://127.0.0.1:" + port + "/");
});
`;

const SILENT = `
setTimeout(() => {}, 60_000);
console.log("starting up, no url here");
`;

const CRASHES = `
console.error("boom: missing dependency");
process.exit(1);
`;

after(async () => {
  await stopAllDevServers();
});

test("start returns a loopback URL in range, status lists it, stop ends it", async () => {
  makeProject("good", GOOD);

  const started = await devServerTool.execute({ action: "start", project: "good" });
  const url = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(started as string);
  assert.ok(url, `expected a loopback URL, got: ${started}`);
  const port = Number(url[1]);
  assert.ok(port >= 5200 && port <= 5299, `port ${port} is in the reserved range`);

  const response = await fetch(url[0]);
  assert.equal(await response.text(), "ok", "the server really answers");

  const status = await devServerTool.execute({ action: "status", project: "good" });
  assert.match(status as string, /good: http:\/\/127\.0\.0\.1:/);
  assert.deepEqual(runningProjects(), ["good"]);

  const stopped = await devServerTool.execute({ action: "stop", project: "good" });
  assert.match(stopped as string, /Stopped/);
  assert.deepEqual(runningProjects(), []);
  await assert.rejects(fetch(url[0]), "nothing listens on that port any more");
});

test("starting twice returns the URL that is already running", async () => {
  makeProject("twice", GOOD);
  const first = await devServerTool.execute({ action: "start", project: "twice" });
  const second = await devServerTool.execute({ action: "start", project: "twice" });
  assert.match(second as string, /Already running/);
  const urlOf = (out: unknown) => /http:\/\/127\.0\.0\.1:\d+\//.exec(out as string)?.[0];
  assert.equal(urlOf(second), urlOf(first));
  await devServerTool.execute({ action: "stop", project: "twice" });
});

test("a dev script that prints no URL is stopped and reports its log", async () => {
  makeProject("silent", SILENT);
  process.env.DULO_DEV_SERVER_TIMEOUT_MS = "800";
  try {
    await assert.rejects(
      devServerTool.execute({ action: "start", project: "silent" }),
      (error: unknown) => {
        assert.match(String(error), /no URL/i);
        assert.match(String(error), /starting up, no url here/);
        return true;
      },
    );
  } finally {
    delete process.env.DULO_DEV_SERVER_TIMEOUT_MS;
  }
  assert.deepEqual(runningProjects(), [], "nothing is left running");
});

test("a dev script that exits immediately reports the exit and its output", async () => {
  makeProject("crashes", CRASHES);
  await assert.rejects(
    devServerTool.execute({ action: "start", project: "crashes" }),
    (error: unknown) => {
      assert.match(String(error), /stopped before printing a URL/);
      assert.match(String(error), /boom: missing dependency/);
      return true;
    },
  );
});

test("refuses a project that is missing, has no package.json, or was never installed", async () => {
  await assert.rejects(
    devServerTool.execute({ action: "start", project: "nope" }),
    /No project at/,
  );

  mkdirSync(path.join(workspace, "bare"), { recursive: true });
  await assert.rejects(
    devServerTool.execute({ action: "start", project: "bare" }),
    /no package\.json/,
  );

  const uninstalled = path.join(workspace, "uninstalled");
  mkdirSync(uninstalled, { recursive: true });
  writeFileSync(path.join(uninstalled, "package.json"), JSON.stringify({ name: "u" }));
  await assert.rejects(
    devServerTool.execute({ action: "start", project: "uninstalled" }),
    /node_modules/,
  );

  await assert.rejects(
    devServerTool.execute({ action: "start", project: "../escape" }),
    /outside the workspace/,
  );
});

test("stopping something that is not running says so plainly", async () => {
  makeProject("idle", GOOD);
  const out = await devServerTool.execute({ action: "stop", project: "idle" });
  assert.match(out as string, /No dev server is running/);
});
