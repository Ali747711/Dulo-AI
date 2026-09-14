// src/loop/gate-integration.test.ts
// The whole chain in one real session turn: the runner builds the gate for the
// turn, the frontend-engineer profile is allowed to call it, a claim with no
// evidence is rejected, and a complete claim runs the real frontend-reviewer
// role, whose verdict decides. The model is the stub, so what is proven here is
// the wiring, not the model's judgment.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const scratch = await mkdtemp(path.join(tmpdir(), "dulo-gate-"));
// No MCP servers: the turn must not spawn the owner's real ones.
const configFile = path.join(scratch, "dulo.config.json");
await writeFile(configFile, JSON.stringify({ mcpServers: {}, approval: { mode: "auto" } }));
process.env.DULO_CONFIG = configFile;
process.env.DULO_WORKSPACE_DIR = path.join(scratch, "workspace");

const { initRegistry, closeRegistry } = await import("../registry.js");
const { createRunner } = await import("../session/runner.js");
const { FileSessionStore } = await import("../session/store/files.js");
const { startStubLlm, useStubLlm } = await import("../session/testing/stub-llm.js");

const CHECKLIST = ["DOD-1", "DOD-2", "DOD-3", "DOD-4", "DOD-5", "DOD-6"];
const claim = (evidence: (id: string) => string) => ({
  projectPath: "northwind-coffee",
  runCommand: "npm run dev",
  summary: "A one-page site for Northwind Coffee.",
  checklist: CHECKLIST.map((id) => ({ id, status: "pass", evidence: evidence(id) })),
});

/** Which role a request belongs to: the reviewer's prompt is unmistakable. */
const isReviewer = (req: { messages: { role: string; content: string | null }[] }) =>
  (req.messages[0]?.content ?? "").includes("You check a finished frontend build");

/** A tool result in the history means this role already acted once. */
const hasActed = (req: { messages: { role: string }[] }) =>
  req.messages.some((m) => m.role === "tool");

let stub: Awaited<ReturnType<typeof startStubLlm>>;
let runner: ReturnType<typeof createRunner>;
let builderCalls = 0;
let reviewerVerdict: "pass" | "fail" = "pass";

before(async () => {
  stub = await startStubLlm((req) => {
    if (isReviewer(req)) {
      // A real reviewer gives its verdict once, then finishes.
      return hasActed(req)
        ? { text: "Reviewed." }
        : { toolCall: { name: "review_verdict", args: { verdict: reviewerVerdict, findings: [] } } };
    }
    builderCalls += 1;
    if (builderCalls === 1) {
      // First attempt: DOD-4 has no evidence at all.
      return {
        toolCall: {
          name: "report_done",
          args: claim((id) => (id === "DOD-4" ? "" : `${id}: checked`)),
        },
      };
    }
    if (builderCalls === 2) {
      return { toolCall: { name: "report_done", args: claim((id) => `${id}: checked, output quoted`) } };
    }
    return { text: "Your page is ready." };
  });
  useStubLlm(stub);
  await initRegistry();
  runner = createRunner(new FileSessionStore(path.join(scratch, "sessions")));
});

after(async () => {
  await closeRegistry();
  await stub.close();
  await rm(scratch, { recursive: true, force: true });
});

const partsOf = async (sessionId: string) => {
  const snap = await runner.getSnapshot(sessionId);
  const assistant = (snap?.messages ?? []).filter((m) => m.role === "assistant").at(-1);
  return assistant?.parts ?? [];
};

test("the gate rejects an unproven claim, then accepts once the reviewer passes (AC-13, AC-15)", async () => {
  const session = await runner.createSession();
  const started = await runner.startTurn(session.id, {
    parts: [{ type: "text", text: "Build the Northwind Coffee page." }],
    agent: "frontend-engineer",
  });
  assert.ok(started && started.started);
  await runner.awaitIdle(session.id);

  const parts = await partsOf(session.id);
  const results = parts.filter((p) => p.type === "tool_result");
  assert.equal(results.length, 2, "two report_done calls were made");

  const [first, second] = results as { result: string; isError?: boolean }[];
  assert.equal(first.isError, true, "the claim with no evidence was rejected");
  assert.match(first.result, /DOD-4: no evidence quoted/);

  assert.notEqual(second.isError, true, "the complete claim was accepted");
  assert.match(second.result, /Accepted/);
  assert.match(second.result, /reviewer agreed/);

  // The reviewer really ran, as its own role, inside this turn.
  assert.ok(
    stub.calls.some(isReviewer),
    "the frontend-reviewer profile was used for the nested review",
  );
});

test("a reviewer that fails keeps the claim rejected", async () => {
  builderCalls = 1; // so the next builder reply is the complete claim
  reviewerVerdict = "fail";
  const session = await runner.createSession();
  await runner.startTurn(session.id, {
    parts: [{ type: "text", text: "Build it again." }],
    agent: "frontend-engineer",
  });
  await runner.awaitIdle(session.id);

  const results = (await partsOf(session.id)).filter((p) => p.type === "tool_result") as {
    result: string;
    isError?: boolean;
  }[];
  assert.equal(results[0]?.isError, true);
  assert.match(results[0].result, /Rejected by review/);
});

test("the builder can claim done; nothing else can call the reviewer's tool", async () => {
  const { getRegistry } = await import("../registry.js");
  const registry = getRegistry();
  assert.ok(
    registry.agents.some((a) => a.name === "frontend-reviewer"),
    "the reviewer role is installed",
  );
  // review_verdict is per-review, never a registry tool anyone could reach.
  assert.equal(
    registry.tools.find((t) => t.name === "review_verdict"),
    undefined,
  );
  assert.equal(
    registry.tools.find((t) => t.name === "report_done"),
    undefined,
    "report_done is built per turn, not registered globally",
  );
});
