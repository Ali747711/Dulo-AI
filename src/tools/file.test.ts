// src/tools/file.test.ts
// The file tools are confined to the workspace (INV-9), refuse to remove the
// workspace itself (INV-10), and the three path tools do what they say.
// DULO_WORKSPACE_DIR is set before the module is imported, because the root
// is resolved at import time.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const outside = mkdtempSync(path.join(tmpdir(), "dulo-outside-"));
const workspace = mkdtempSync(path.join(tmpdir(), "dulo-ws-"));
process.env.DULO_WORKSPACE_DIR = workspace;

const { fileTools, resolveSafe } = await import("./file.js");

const tool = (name: string) => {
  const found = fileTools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}; have ${fileTools.map((t) => t.name).join(", ")}`);
  return found;
};

test("paths that resolve outside the workspace are refused", async () => {
  await assert.rejects(resolveSafe("../escape.txt"), /outside/);
  await assert.rejects(
    tool("write_file").execute({ path: "../escape.txt", content: "x" }),
    /outside/,
  );
  assert.equal(existsSync(path.join(path.dirname(workspace), "escape.txt")), false);
});

test("a symlink inside the workspace that points outside is refused", async () => {
  writeFileSync(path.join(outside, "secret.txt"), "s");
  symlinkSync(outside, path.join(workspace, "link"));
  await assert.rejects(resolveSafe("link/secret.txt"), /outside/);
});

test("make_dir creates nested folders inside the workspace", async () => {
  const out = await tool("make_dir").execute({ path: "proj/src/components" });
  assert.match(out, /proj\/src\/components/);
  assert.equal(existsSync(path.join(workspace, "proj/src/components")), true);
  await assert.rejects(tool("make_dir").execute({ path: "../nope" }), /outside/);
});

test("move_path moves a file and creates the destination folder", async () => {
  writeFileSync(path.join(workspace, "a.txt"), "hello");
  const out = await tool("move_path").execute({ from: "a.txt", to: "moved/b.txt" });
  assert.match(out, /moved/);
  assert.equal(existsSync(path.join(workspace, "a.txt")), false);
  assert.equal(existsSync(path.join(workspace, "moved/b.txt")), true);
  await assert.rejects(tool("move_path").execute({ from: "moved/b.txt", to: "../b.txt" }), /outside/);
});

test("remove_path removes files, needs recursive for a non-empty folder, never the root", async () => {
  mkdirSync(path.join(workspace, "dir/inner"), { recursive: true });
  writeFileSync(path.join(workspace, "dir/inner/f.txt"), "f");
  writeFileSync(path.join(workspace, "one.txt"), "1");

  assert.match(await tool("remove_path").execute({ path: "one.txt" }), /Removed/);
  assert.equal(existsSync(path.join(workspace, "one.txt")), false);

  await assert.rejects(tool("remove_path").execute({ path: "dir" }), /recursive/);
  assert.equal(existsSync(path.join(workspace, "dir/inner/f.txt")), true);

  assert.match(await tool("remove_path").execute({ path: "dir", recursive: true }), /Removed/);
  assert.equal(existsSync(path.join(workspace, "dir")), false);

  await assert.rejects(tool("remove_path").execute({ path: ".", recursive: true }), /workspace root/);
  await assert.rejects(tool("remove_path").execute({ path: "", recursive: true }), /workspace root/);
  assert.equal(existsSync(workspace), true);
});

test("read_file and list_files work on files inside the workspace", async () => {
  writeFileSync(path.join(workspace, "readme.md"), "# hi\n");
  assert.match(await tool("read_file").execute({ path: "readme.md" }), /# hi/);
  assert.match(await tool("list_files").execute({ dir: "." }), /readme\.md/);
});
