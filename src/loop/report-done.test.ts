// src/loop/report-done.test.ts
// The gate: an unproven claim is rejected (INV-14), the cap ends the loop
// (INV-15), and the reviewer's verdict decides (AC-13). The reviewer is
// injected, so no model is involved.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLoopTools, type LoopConfig } from "./report-done.js";
import type { Message, Tool } from "../types.js";
import type { RunOptions } from "../agent.js";

const LOOP: LoopConfig = { maxIterations: 3, independentReview: true, reviewer: "frontend-reviewer" };

interface Item {
  id: string;
  status: "pass" | "fail";
  evidence: string;
}

const goodChecklist = (): Item[] =>
  ["DOD-1", "DOD-2", "DOD-3", "DOD-4", "DOD-5", "DOD-6"].map((id) => ({
    id,
    status: "pass",
    evidence: `${id}: checked, output quoted here`,
  }));

/** The reviewer profile the gate looks up; only its name and tool map matter here. */
const reviewerProfile = {
  name: "frontend-reviewer",
  description: "test double",
  prompt: "review it",
  tools: { "*": false, read_file: true, review_verdict: true },
  file: "src/agents/frontend-reviewer.md",
};

const claim = (overrides: Record<string, unknown> = {}) => ({
  projectPath: "northwind-coffee",
  runCommand: "npm run dev",
  summary: "A one-page site for Northwind Coffee.",
  checklist: goodChecklist(),
  ...overrides,
});

/** A stand-in for the nested reviewer run: calls review_verdict as told. */
const reviewerThatSays = (
  verdict: "pass" | "fail",
  findings: Record<string, unknown>[] = [],
): { runTurn: (h: Message[], o: RunOptions) => Promise<{ status: string }>; seen: RunOptions[] } => {
  const seen: RunOptions[] = [];
  return {
    seen,
    runTurn: async (history, options) => {
      seen.push(options);
      assert.equal(history[0]?.role, "system", "the reviewer runs with its own role prompt");
      assert.match(String(history[0]?.content), /review it/);
      const tool = (options.tools ?? []).find((t: Tool) => t.name === "review_verdict");
      assert.ok(tool, "the nested run is given review_verdict");
      await tool.execute({ verdict, findings });
      return { status: "completed" };
    },
  };
};

const gate = (deps: Partial<Parameters<typeof createLoopTools>[0]> = {}) => {
  const tools = createLoopTools({
    loop: LOOP,
    runTurn: async () => ({ status: "completed" }),
    getProfile: (name) => (name === reviewerProfile.name ? reviewerProfile : undefined),
    availableTools: () => [],
    ...deps,
  });
  assert.deepEqual(tools.map((t) => t.name), ["report_done"], "the builder gets only report_done");
  return tools[0];
};

test("accepts a complete claim once the reviewer passes", async () => {
  const reviewer = reviewerThatSays("pass");
  const out = await gate({ runTurn: reviewer.runTurn }).execute(claim());
  assert.match(out as string, /Accepted/);
  assert.equal(reviewer.seen.length, 1);
  assert.equal(reviewer.seen[0].agent, "frontend-reviewer");
});

test("rejects an item with empty evidence, naming it (INV-14)", async () => {
  const checklist = goodChecklist();
  checklist[3] = { ...checklist[3], evidence: "   " };
  await assert.rejects(gate().execute(claim({ checklist })), (error: unknown) => {
    assert.match(String(error), /Rejected/);
    assert.match(String(error), /DOD-4: no evidence quoted/);
    return true;
  });
});

test("rejects a missing id and a failing status", async () => {
  const missing = goodChecklist().filter((i) => i.id !== "DOD-5");
  await assert.rejects(gate().execute(claim({ checklist: missing })), /DOD-5: missing/);

  const failing = goodChecklist();
  failing[0] = { ...failing[0], status: "fail" };
  await assert.rejects(gate().execute(claim({ checklist: failing })), /DOD-1: status is "fail"/);
});

test("a reviewer verdict of fail rejects the claim and carries the findings (AC-13)", async () => {
  const reviewer = reviewerThatSays("fail", [
    { id: "DOD-4", severity: "must-fix", what: 'the "Visit us" section is missing', where: "App.tsx", fix: "add it" },
  ]);
  await assert.rejects(
    gate({ runTurn: reviewer.runTurn }).execute(claim()),
    (error: unknown) => {
      assert.match(String(error), /Rejected by review/);
      assert.match(String(error), /DOD-4 \(must-fix\): the "Visit us" section is missing/);
      assert.match(String(error), /App\.tsx/);
      return true;
    },
  );
});

test("a reviewer that never gives a verdict is a rejection, not an acceptance", async () => {
  const silent = gate({ runTurn: async () => ({ status: "completed" }) });
  await assert.rejects(silent.execute(claim()), /without giving a verdict/);
});

test("a failed or cancelled review is a rejection that says which", async () => {
  await assert.rejects(
    gate({ runTurn: async () => ({ status: "failed", error: "model stream stalled" }) }).execute(claim()),
    /failed before reaching a verdict: model stream stalled/,
  );
  await assert.rejects(
    gate({ runTurn: async () => ({ status: "cancelled" }) }).execute(claim()),
    /cancelled/,
  );
});

test("after maxIterations rejections the tool stops accepting anything (INV-15)", async () => {
  const reviewer = reviewerThatSays("fail");
  const tool = gate({ runTurn: reviewer.runTurn });

  for (let i = 1; i <= LOOP.maxIterations; i++) {
    await assert.rejects(tool.execute(claim()), new RegExp(`\\(${i}/${LOOP.maxIterations}\\)`));
  }
  // The next call must not run a review or accept, whatever it contains.
  const callsBefore = reviewer.seen.length;
  const out = await tool.execute(claim());
  assert.match(out as string, /Cap reached \(3\/3\)/);
  assert.match(out as string, /not finished/);
  assert.equal(reviewer.seen.length, callsBefore, "no further review was run");

  const perfect = reviewerThatSays("pass");
  const again = await tool.execute(claim());
  assert.match(again as string, /Cap reached/);
  assert.equal(perfect.seen.length, 0);
});

test("independentReview off accepts a complete checklist without a reviewer", async () => {
  const tools = createLoopTools({
    loop: { ...LOOP, independentReview: false },
    runTurn: async () => {
      throw new Error("no review should run");
    },
  });
  assert.match((await tools[0].execute(claim())) as string, /Accepted/);
});

test("a malformed claim is rejected and counts against the cap", async () => {
  const tool = gate();
  await assert.rejects(tool.execute({ projectPath: "x" }), /not in the expected shape/);
  await assert.rejects(tool.execute(claim({ checklist: [] })), /not in the expected shape/);
});

test("a reviewer role that is not installed is a rejection, not a silent pass", async () => {
  const tools = createLoopTools({
    loop: LOOP,
    runTurn: async () => ({ status: "completed" }),
    getProfile: () => undefined,
    availableTools: () => [],
  });
  await assert.rejects(tools[0].execute(claim()), /not installed/);
});
