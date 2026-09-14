// src/tools/scaffold.test.ts
// Copying, placeholder filling, and the refusals (INV-13). The install is
// skipped here: `npm run template:check` proves the template really builds.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const workspace = mkdtempSync(path.join(tmpdir(), "dulo-scaffold-"));
process.env.DULO_WORKSPACE_DIR = workspace;

const { scaffoldProjectTool } = await import("./scaffold.js");

const scaffold = (args: Record<string, unknown>) =>
  scaffoldProjectTool.execute({ install: false, ...args } as never);

test("creates the project tree and fills the placeholders", async () => {
  const out = await scaffold({ slug: "northwind-coffee", name: "Northwind Coffee" });
  assert.match(out, /northwind-coffee\/package\.json/);
  assert.match(out, /northwind-coffee\/src\/App\.tsx/);

  const project = path.join(workspace, "northwind-coffee");
  const pkg = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8"));
  assert.equal(pkg.name, "northwind-coffee");
  assert.ok(pkg.scripts.dev && pkg.scripts.build, "dev and build scripts exist");

  const html = readFileSync(path.join(project, "index.html"), "utf8");
  assert.match(html, /<title>Northwind Coffee<\/title>/);
  assert.doesNotMatch(html, /\{\{/, "no placeholder left in index.html");

  const content = readFileSync(path.join(project, "src/content/site.ts"), "utf8");
  assert.match(content, /name: "Northwind Coffee"/);

  for (const file of ["vite.config.ts", "tsconfig.json", "src/index.css", "public/favicon.svg"]) {
    assert.ok(existsSync(path.join(project, file)), `${file} was copied`);
  }
});

test("the fresh project still carries TODOs, so the done check catches an unfinished page", () => {
  const content = readFileSync(path.join(workspace, "northwind-coffee/src/content/site.ts"), "utf8");
  assert.match(content, /TODO/, "placeholder copy is obvious until the agent replaces it");
});

test("refuses a slug that is not a safe folder and package name", async () => {
  await assert.rejects(scaffold({ slug: "../escape", name: "x" }), /not a valid project name/);
  await assert.rejects(scaffold({ slug: "Northwind Coffee", name: "x" }), /not a valid project name/);
  await assert.rejects(scaffold({ slug: "", name: "x" }), /not a valid project name/);
  await assert.rejects(scaffold({ slug: "ok-name", name: "  " }), /name cannot be empty/);
});

test("refuses to write into a folder that already has something in it", async () => {
  mkdirSync(path.join(workspace, "taken"), { recursive: true });
  writeFileSync(path.join(workspace, "taken/keep.txt"), "mine");
  await assert.rejects(scaffold({ slug: "taken", name: "Taken" }), /already exists/);
  assert.equal(readFileSync(path.join(workspace, "taken/keep.txt"), "utf8"), "mine");
});

test("an empty folder is fine to scaffold into", async () => {
  mkdirSync(path.join(workspace, "empty-one"), { recursive: true });
  const out = await scaffold({ slug: "empty-one", name: "Empty One" });
  assert.match(out, /empty-one\/package\.json/);
});
