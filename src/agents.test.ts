// src/agents.test.ts
// The roles that ship with the harness must parse, and the reviewer's
// allow-list must not contain anything that can change the world (INV-16):
// a reviewer that could edit the work it is judging is not a reviewer.
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyToolPolicy, loadAgents } from "./agents.js";
import { loadSkills } from "./skills.js";
import { builtinTools } from "./tools/index.js";
import type { Tool } from "./types.js";

const agents = await loadAgents();
const byName = new Map(agents.map((a) => [a.name, a]));

/** Anything that writes, deletes, runs a process, or reaches the network. */
const CHANGES_THE_WORLD = [
  /^write_file$/,
  /^edit_file$/,
  /^make_dir$/,
  /^move_path$/,
  /^remove_path$/,
  /^shell$/,
  /^scaffold_project$/,
  /^dev_server$/,
  /^http_request$/,
  /^file_compress$/,
  /^file_extract$/,
  /^report_done$/,
  // Browser tools that type, click or upload change the page's state, not the
  // project; navigating and reading are what a reviewer needs.
  /_(click|type|type_text|fill|fill_form|upload_file|drag|press_key|select_option|handle_dialog|run_code_unsafe)$/,
];

test("the shipped roles parse, with a prompt and a description", () => {
  for (const name of ["frontend-engineer", "frontend-reviewer"]) {
    const agent = byName.get(name);
    assert.ok(agent, `${name} loaded`);
    assert.ok(agent.prompt.length > 200, `${name} has a real prompt`);
    assert.ok(agent.description.length > 10, `${name} has a description`);
    assert.equal(agent.tools?.["*"], false, `${name} denies tools it does not name`);
  }
});

test("the reviewer cannot change anything it reviews (INV-16)", () => {
  const reviewer = byName.get("frontend-reviewer");
  assert.ok(reviewer);
  const allowed = Object.entries(reviewer.tools ?? {})
    .filter(([name, on]) => on && name !== "*")
    .map(([name]) => name);

  assert.ok(allowed.includes("review_verdict"), "it can answer");
  assert.ok(allowed.includes("read_file"), "it can read the project");

  for (const name of allowed) {
    const forbidden = CHANGES_THE_WORLD.find((pattern) => pattern.test(name));
    assert.equal(forbidden, undefined, `reviewer must not be allowed "${name}"`);
  }
});

test("the builder may claim done; the reviewer may not", () => {
  const fake = (name: string): Tool => ({ name, description: "", parameters: {}, execute: async () => "" });
  const loopTools = [fake("report_done"), fake("review_verdict")];

  const builder = applyToolPolicy(loopTools, byName.get("frontend-engineer")?.tools);
  assert.deepEqual(builder.map((t) => t.name), ["report_done"]);

  const reviewer = applyToolPolicy(loopTools, byName.get("frontend-reviewer")?.tools);
  assert.deepEqual(reviewer.map((t) => t.name), ["review_verdict"]);
});

test("every built-in tool a role names actually exists", () => {
  const builtin = new Set(builtinTools.map((t) => t.name));
  // Tools that come from elsewhere: MCP servers, skills, and the per-turn loop.
  const external = /^(playwright_|chrome-devtools_|a11y_|context7_|load_skill$|report_done$|review_verdict$)/;
  for (const agent of agents) {
    for (const [name, on] of Object.entries(agent.tools ?? {})) {
      if (!on || name === "*" || external.test(name)) continue;
      assert.ok(builtin.has(name), `${agent.name} allows "${name}", which is not a built-in tool`);
    }
  }
});

test("every shipped skill parses and has a description", async () => {
  const skills = await loadSkills();
  // A colon in an unquoted YAML description silently drops the whole file, so
  // assert the ones that must exist are really there.
  for (const name of ["frontend-definition-of-done", "frontend-greenfield-scaffold"]) {
    const skill = skills.find((s) => s.name === name);
    assert.ok(skill, `${name} loaded (check its YAML frontmatter if not)`);
    assert.ok(skill.description.length > 10, `${name} has a description`);
    assert.ok(skill.body.length > 200, `${name} has a body`);
  }
});
