// src/risk.test.ts
// The rule table is the trust boundary, so it is tested directly. A wrong
// "allowed" is the one dangerous failure here; a wrong "ask" only annoys.
import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, type RiskTier } from "./risk.js";
import { builtinTools } from "./tools/index.js";

const tierOf = (tool: string, args: Record<string, unknown> = {}): RiskTier =>
  classify(tool, args).tier;

const shell = (command: string): RiskTier => tierOf("shell", { command });

test("reads and local conveniences run without asking", () => {
  for (const tool of [
    "read_file",
    "list_files",
    "glob",
    "grep_files",
    "get_current_time",
    "calculate",
    "get_uuid",
    "get_random_number",
    "generate_password",
    "get_system_info",
    "manage_todos",
    "load_skill",
    "report_done",
    "review_verdict",
  ]) {
    assert.equal(tierOf(tool), "allowed", `${tool} should run unasked`);
  }
});

test("writing inside the workspace runs without asking", () => {
  assert.equal(tierOf("write_file", { path: "site/index.html", content: "x" }), "allowed");
  assert.equal(tierOf("edit_file", { path: "site/App.tsx" }), "allowed");
  assert.equal(tierOf("make_dir", { path: "site/src" }), "allowed");
  assert.equal(tierOf("move_path", { from: "a.txt", to: "b.txt" }), "allowed");
  assert.equal(tierOf("scaffold_project", { slug: "site", name: "Site" }), "allowed");
  assert.equal(tierOf("file_compress", { inputPath: "a", outputPath: "b" }), "allowed");
});

test("deleting one file is ordinary; deleting a tree is not (AC-17)", () => {
  assert.equal(tierOf("remove_path", { path: "site/stray.txt" }), "allowed");
  assert.equal(tierOf("remove_path", { path: "site/src", recursive: true }), "confirm");
});

test("the dev server is ordinary work in every action", () => {
  for (const action of ["start", "status", "stop"]) {
    assert.equal(tierOf("dev_server", { action, project: "site" }), "allowed");
  }
});

test("reading the environment is not a read like any other", () => {
  // It can put an API key or a token into the transcript.
  assert.equal(tierOf("get_env", { name: "OPENROUTER_API_KEY" }), "ask");
});

test("http_request: reading asks, changing something confirms (AC-19)", () => {
  assert.equal(tierOf("http_request", { url: "https://fonts.example/x.woff2" }), "ask");
  assert.equal(tierOf("http_request", { url: "https://x.example", method: "HEAD" }), "ask");
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    assert.equal(
      tierOf("http_request", { url: "https://api.example/things", method }),
      "confirm",
      `${method} changes something on someone else's system`,
    );
  }
});

test("other network tools ask", () => {
  for (const tool of ["dns_lookup", "ping", "port_check", "get_weather"]) {
    assert.equal(tierOf(tool, { hostname: "example.com" }), "ask");
  }
});

test("shell: building is ordinary, running code asks, pushing confirms (AC-18)", () => {
  for (const command of [
    "npm run build",
    "npm run typecheck",
    "npm run lint",
    "npm test",
    "npm install",
    "npm install @fontsource-variable/fraunces",
    "npm ci",
    "tsc --noEmit",
    "ls -la",
    "cat package.json",
    "grep -rn foo src",
    "git status",
    "git diff",
    "git log --oneline",
    "git add .",
    "git commit -m wip",
  ]) {
    assert.equal(shell(command), "allowed", `"${command}" should run unasked`);
  }

  for (const command of [
    "node script.js",
    "npx vite build",
    "python3 thing.py",
    "make all",
    "tsx run.ts",
    "npm run something-unknown",
    "git remote add origin https://example.com/x.git",
  ]) {
    assert.equal(shell(command), "ask", `"${command}" runs code or reaches out`);
  }

  for (const command of ["git push", "git push --force origin main", "npm publish", "npm run deploy"]) {
    assert.equal(shell(command), "confirm", `"${command}" leaves this machine`);
  }
});

test("shell: an unreadable command asks rather than running", () => {
  assert.equal(shell(""), "ask");
  assert.equal(shell('npm run "unclosed'), "ask");
  assert.equal(tierOf("shell", {}), "ask");
});

test("MCP: the read-only review tools are allowed, writes and deploys confirm", () => {
  for (const tool of [
    "playwright_browser_navigate",
    "playwright_browser_snapshot",
    "playwright_browser_evaluate",
    "playwright_browser_console_messages",
    "playwright_browser_resize",
    "chrome-devtools_take_snapshot",
    "chrome-devtools_lighthouse_audit",
    "a11y_check_color_contrast",
    "context7_query-docs",
  ]) {
    assert.equal(tierOf(tool), "allowed", `${tool} is how Review looks at the page`);
  }

  for (const tool of [
    "playwright_browser_click",
    "playwright_browser_type",
    "playwright_browser_file_upload",
    "github_search_repositories",
    "sentry_list_issues",
  ]) {
    assert.equal(tierOf(tool), "ask", `${tool} is outside the sandbox`);
  }

  for (const tool of [
    "vercel_deploy_project",
    "playwright_browser_run_code_unsafe",
    "github_create_pull_request",
    "github_push_files",
    "github_delete_file",
    "supabase_execute_sql",
    "linear_create_issue",
    "npm_publish_package",
  ]) {
    assert.equal(tierOf(tool), "confirm", `${tool} changes someone else's system`);
  }
});

test("an unknown tool asks, never runs unasked (AC-21)", () => {
  assert.equal(tierOf("some_new_tool"), "ask");
  assert.equal(tierOf("mystery_server_do_thing"), "ask");
});

test("config overrides win in both directions", () => {
  const policy = { allowTools: ["http_request"], confirmTools: ["write_file"] };
  assert.equal(classify("http_request", { url: "https://x" }, policy).tier, "allowed");
  assert.equal(classify("write_file", { path: "a" }, policy).tier, "confirm");
  // confirm wins when a tool is listed in both, since tightening must not be
  // undone by a stale allow entry.
  const both = { allowTools: ["shell"], confirmTools: ["shell"] };
  assert.equal(classify("shell", { command: "ls" }, both).tier, "confirm");
});

test("every ask and confirm explains itself in plain language (INV-22)", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["http_request", { url: "https://api.example/x", method: "POST" }],
    ["http_request", { url: "https://api.example/x" }],
    ["remove_path", { path: "site", recursive: true }],
    ["shell", { command: "node x.js" }],
    ["shell", { command: "git push" }],
    ["get_env", { name: "TOKEN" }],
    ["vercel_deploy_project", {}],
    ["some_new_tool", {}],
  ];
  for (const [tool, args] of cases) {
    const risk = classify(tool, args);
    assert.notEqual(risk.tier, "allowed", `${tool} should not be allowed`);
    assert.ok(risk.what.length > 15, `${tool}: "what" says something`);
    assert.ok(risk.undo.length > 10, `${tool}: "undo" says something`);
    assert.match(risk.what, /^Dulo wants to /, `${tool}: "what" reads as a sentence`);
    assert.doesNotMatch(
      `${risk.what} ${risk.undo}`,
      /undefined|\[object/,
      `${tool}: no leaked placeholders`,
    );
  }
});

test("the where field carries the thing being acted on", () => {
  assert.match(classify("remove_path", { path: "site/src", recursive: true }).where, /site\/src/);
  assert.match(classify("http_request", { url: "https://fonts.example/a.woff2" }).where, /fonts\.example/);
  assert.match(classify("shell", { command: "git push" }).where, /git push/);
});

test("every built-in tool has a deliberate rule, not the unknown default", () => {
  // A new tool must be classified on purpose. This fails loudly when one is
  // added without a decision, which is the point.
  for (const tool of builtinTools) {
    const risk = classify(tool.name, {});
    assert.ok(
      !risk.what.includes("no rule for"),
      `${tool.name} has no rule in src/risk.ts — add one`,
    );
  }
});

test("classifying is pure: no filesystem, no processes, no network (INV-21)", async () => {
  // Nothing in the module may import anything that acts. Checked structurally:
  // a rule that needed the disk would have to import fs.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./risk.ts", import.meta.url), "utf8");
  for (const forbidden of ["node:fs", "node:child_process", "node:net", "node:http", "fetch("]) {
    assert.ok(!source.includes(forbidden), `risk.ts must not use ${forbidden}`);
  }
});
