// src/paths.test.ts
// The roots must come from the harness's own location, not from cwd, and the
// data dirs must honour their env overrides. Env is read at import time, so
// this file sets it up before importing the module under test.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const expectedRoot = path.resolve(here, "..");

const scratch = mkdtempSync(path.join(tmpdir(), "dulo-paths-"));
process.env.DULO_WORKSPACE_DIR = path.join(scratch, "ws");
process.env.DULO_SESSIONS_DIR = path.join(scratch, "sess");
process.env.DULO_CONFIG = path.join(scratch, "cfg.json");
// Start "from elsewhere": nothing below may depend on cwd.
process.chdir(scratch);

const paths = await import("./paths.js");

test("HARNESS_ROOT is the checkout, whatever the cwd is", () => {
  assert.equal(paths.HARNESS_ROOT, expectedRoot);
  assert.notEqual(process.cwd(), paths.HARNESS_ROOT);
});

test("the harness's own resources live under HARNESS_ROOT", () => {
  assert.equal(paths.AGENTS_DIR, path.join(expectedRoot, "src", "agents"));
  assert.equal(paths.SKILLS_DIR, path.join(expectedRoot, "src", "skills"));
  assert.equal(paths.CUSTOM_TOOLS_DIR, path.join(expectedRoot, "src", "tools", "custom"));
  assert.equal(paths.TEMPLATES_DIR, path.join(expectedRoot, "templates"));
  assert.equal(paths.ENV_FILE, path.join(expectedRoot, ".env"));
});

test("data dirs and the config file honour their env overrides", () => {
  assert.equal(paths.WORKSPACE_ROOT, path.join(scratch, "ws"));
  assert.equal(paths.SESSIONS_DIR, path.join(scratch, "sess"));
  assert.equal(paths.CONFIG_FILE, path.join(scratch, "cfg.json"));
});
