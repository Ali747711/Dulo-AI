import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import { createRunner, titleFrom, type Runner } from "./runner.js";
import { FileSessionStore } from "./store/files.js";
import { startStubLlm, useStubLlm, type StubLlm } from "./testing/stub-llm.js";
import type { SessionEvent } from "./types.js";

let dir: string;
let runner: Runner;
let stub: StubLlm;

const userCount = (req: { messages: { role: string }[] }) =>
  req.messages.filter((m) => m.role === "user").length;

before(async () => {
  // Reply with how many user messages the harness sent; proves history carries.
  stub = await startStubLlm((req) => ({ text: `seen ${userCount(req)} user messages` }));
  useStubLlm(stub);
});
after(() => stub.close());

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dulo-runner-"));
  runner = createRunner(new FileSessionStore(dir));
  stub.calls.length = 0;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const text = (t: string) => [{ type: "text" as const, text: t }];

describe("titleFrom", () => {
  it("uses the text, collapsed and trimmed to 60 characters", () => {
    assert.equal(titleFrom(text("  hello\n  world ")), "hello world");
    assert.equal(titleFrom(text("x".repeat(80))).length, 60);
    assert.ok(titleFrom(text("x".repeat(80))).endsWith("…"));
  });
  it("falls back to an attachment name, then a default", () => {
    assert.equal(
      titleFrom([{ type: "attachment", fileId: "f", name: "notes.md", mime: "text/markdown", size: 1 }]),
      "notes.md",
    );
    assert.equal(titleFrom([]), "New chat");
  });
});

describe("runner", () => {
  it("carries context across two turns", async () => {
    const session = await runner.createSession();
    const first = await runner.startTurn(session.id, { parts: text("hi") });
    assert.ok(first && first.started);
    await runner.awaitIdle(session.id);

    const second = await runner.startTurn(session.id, { parts: text("again") });
    assert.ok(second && second.started);
    await runner.awaitIdle(session.id);

    const snap = await runner.getSnapshot(session.id);
    assert.ok(snap);
    const answers = snap.messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
    assert.deepEqual(answers, ["seen 1 user messages", "seen 2 user messages"]);

    // The second request really contained the first answer.
    assert.ok(JSON.stringify(stub.calls[1].messages).includes("seen 1 user messages"));
  });

  it("titles the session from the first message and moves head to the answer", async () => {
    const session = await runner.createSession();
    assert.equal(session.title, "New chat");
    const r = await runner.startTurn(session.id, { parts: text("What is Dulo?") });
    assert.ok(r && r.started);
    await runner.awaitIdle(session.id);
    const snap = await runner.getSnapshot(session.id);
    assert.equal(snap?.session.title, "What is Dulo?");
    assert.equal(snap?.session.headId, r.assistantMessageId);
    assert.equal(snap?.session.status, "idle");
    assert.equal(snap?.turns[0].status, "completed");
    assert.equal(snap?.turns[0].usage?.totalTokens, 15);
  });

  it("queues (rather than refuses) a second turn while one is running", async () => {
    const slow = await startStubLlm(() => ({ text: "slow", delayMs: 300 }));
    useStubLlm(slow);
    try {
      const session = await runner.createSession();
      const a = await runner.startTurn(session.id, { parts: text("one") });
      assert.ok(a && a.started);
      const b = await runner.startTurn(session.id, { parts: text("two") });
      assert.ok(b && !b.started && b.reason === "queued");
      await runner.awaitIdle(session.id);
    } finally {
      await slow.close();
      useStubLlm(stub);
    }
  });

  it("rejects a parentId that is not in the session", async () => {
    const session = await runner.createSession();
    const r = await runner.startTurn(session.id, { parts: text("x"), parentId: "ghost" });
    assert.deepEqual(r, { started: false, reason: "bad-parent" });
  });

  it("branches when parentId is an earlier message", async () => {
    const session = await runner.createSession();
    const first = await runner.startTurn(session.id, { parts: text("v1") });
    assert.ok(first && first.started);
    await runner.awaitIdle(session.id);

    // Edit-and-resend: a sibling of the first user message.
    const edited = await runner.startTurn(session.id, { parts: text("v2"), parentId: null });
    assert.ok(edited && edited.started);
    await runner.awaitIdle(session.id);

    const snap = await runner.getSnapshot(session.id);
    const roots = snap!.messages.filter((m) => m.parentId === null);
    assert.equal(roots.length, 2);
    assert.equal(snap!.session.headId, edited.assistantMessageId);
    // Only the v2 branch was sent to the model on the second turn.
    assert.equal(userCount(stub.calls[1]), 1);
  });

  it("queues a message instead of rejecting it while a turn is running", async () => {
    const slow = await startStubLlm(() => ({ text: "slow", delayMs: 300 }));
    useStubLlm(slow);
    try {
      const session = await runner.createSession();
      const a = await runner.startTurn(session.id, { parts: text("one") });
      assert.ok(a && a.started);
      const b = await runner.startTurn(session.id, { parts: text("two") });
      assert.ok(b && !b.started && b.reason === "queued");
      assert.equal(b.queued.parts.length, 1);
      assert.equal((b.queued.parts[0] as { type: "text"; text: string }).text, "two");

      const snap = await runner.getSnapshot(session.id);
      assert.equal(snap?.session.status, "running"); // the first turn, not idle
      assert.equal(snap?.session.queue.length, 1);
      assert.equal(snap?.session.queue[0].id, b.queued.id);

      await runner.awaitIdle(session.id); // lets both turns finish before the next test
    } finally {
      await slow.close();
      useStubLlm(stub);
    }
  });

  it("rejects a bad parentId even while a turn is running, without queuing it", async () => {
    const slow = await startStubLlm(() => ({ text: "slow", delayMs: 300 }));
    useStubLlm(slow);
    try {
      const session = await runner.createSession();
      const a = await runner.startTurn(session.id, { parts: text("one") });
      assert.ok(a && a.started);
      const b = await runner.startTurn(session.id, { parts: text("two"), parentId: "ghost" });
      assert.deepEqual(b, { started: false, reason: "bad-parent" });
      const snap = await runner.getSnapshot(session.id);
      assert.equal(snap?.session.queue.length, 0);
      await runner.awaitIdle(session.id);
    } finally {
      await slow.close();
      useStubLlm(stub);
    }
  });

  it("auto-continues queued messages one at a time after each completed turn", async () => {
    const session = await runner.createSession();
    const a = await runner.startTurn(session.id, { parts: text("one") });
    assert.ok(a && a.started);
    const b = await runner.startTurn(session.id, { parts: text("two") });
    assert.ok(b && !b.started && b.reason === "queued");
    const c = await runner.startTurn(session.id, { parts: text("three") });
    assert.ok(c && !c.started && c.reason === "queued");

    await runner.awaitIdle(session.id); // must wait through the whole chain, not just turn 1

    const snap = await runner.getSnapshot(session.id);
    assert.equal(snap?.session.status, "idle");
    assert.equal(snap?.session.queue.length, 0);
    const answers = snap!.messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
    assert.deepEqual(answers, [
      "seen 1 user messages",
      "seen 2 user messages",
      "seen 3 user messages",
    ]);
    assert.deepEqual(snap?.turns.map((t) => t.status), ["completed", "completed", "completed"]);
  });

  it("holds the queue after a cancelled turn instead of auto-continuing", async () => {
    const slow = await startStubLlm(() => ({ text: "slow", delayMs: 5_000 }));
    useStubLlm(slow);
    try {
      const session = await runner.createSession();
      const a = await runner.startTurn(session.id, { parts: text("one") });
      assert.ok(a && a.started);
      const b = await runner.startTurn(session.id, { parts: text("two") });
      assert.ok(b && !b.started && b.reason === "queued");

      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(runner.cancel(session.id), true);
      await runner.awaitIdle(session.id);

      const snap = await runner.getSnapshot(session.id);
      assert.equal(snap?.turns[0].status, "cancelled");
      assert.equal(snap?.session.status, "idle");
      assert.equal(snap?.session.queue.length, 1); // held, not auto-sent
      assert.equal(snap?.session.queue[0].id, b.queued.id);
    } finally {
      await slow.close();
      useStubLlm(stub);
    }
  });

  it("cancel ends the turn, fills dangling tool results and keeps the session usable", async () => {
    const slow = await startStubLlm((_req, i) =>
      i === 0
        ? { toolCall: { name: "get_current_time", args: {} } }
        : { text: "never", delayMs: 5_000 },
    );
    useStubLlm(slow);
    try {
      const session = await runner.createSession();
      const r = await runner.startTurn(session.id, { parts: text("time?") });
      assert.ok(r && r.started);
      // Wait for the tool to have run (second LLM call is the slow one).
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(runner.cancel(session.id), true);
      await runner.awaitIdle(session.id);

      const snap = await runner.getSnapshot(session.id);
      assert.equal(snap?.turns[0].status, "cancelled");
      assert.equal(snap?.session.status, "idle");
      const assistant = snap!.messages.find((m) => m.id === r.assistantMessageId)!;
      const calls = assistant.parts.filter((p) => p.type === "tool_call").length;
      const results = assistant.parts.filter((p) => p.type === "tool_result").length;
      assert.equal(calls, results);
      assert.equal(runner.cancel(session.id), false);
    } finally {
      await slow.close();
      useStubLlm(stub);
    }
  });

  it("publishes seq-numbered events and serves them after a seq", async () => {
    const session = await runner.createSession();
    const r = await runner.startTurn(session.id, { parts: text("hi") });
    assert.ok(r && r.started);
    await runner.awaitIdle(session.id);

    const all = await runner.eventsAfter(session.id, 0);
    const seqs = all.map((e) => e.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    assert.equal(new Set(seqs).size, seqs.length);
    const types = all.map((e) => e.type);
    assert.ok(types.includes("message.created"));
    assert.ok(types.includes("run.start"));
    assert.ok(types.includes("run.end"));
    assert.ok(types.includes("message.completed"));
    assert.ok(types.indexOf("run.end") < types.indexOf("message.completed"));

    const tail = await runner.eventsAfter(session.id, all[all.length - 3].seq);
    assert.equal(tail.length, 2);

    const runStart = all.find((e) => e.type === "run.start") as SessionEvent & { type: "run.start" };
    assert.equal(runStart.turnId, r.turnId);
    assert.equal(runStart.runId, r.turnId);
    assert.equal(runStart.sessionId, session.id);
  });

  it("maps a turn id back to its session", async () => {
    const session = await runner.createSession();
    const r = await runner.startTurn(session.id, { parts: text("hi") });
    assert.ok(r && r.started);
    assert.equal(runner.sessionForTurn(r.turnId), session.id);
    await runner.awaitIdle(session.id);
  });

  it("setHead resolves to the latest leaf and refuses while running", async () => {
    const session = await runner.createSession();
    const r = await runner.startTurn(session.id, { parts: text("hi") });
    assert.ok(r && r.started);
    await runner.awaitIdle(session.id);
    // Pointing at the user message lands on its answer.
    const moved = await runner.setHead(session.id, r.userMessageId);
    assert.equal(moved?.headId, r.assistantMessageId);
    assert.equal(await runner.setHead(session.id, "ghost"), null);
  });

  it("deleteSession removes it even mid-turn", async () => {
    const slow = await startStubLlm(() => ({ text: "slow", delayMs: 400 }));
    useStubLlm(slow);
    try {
      const session = await runner.createSession();
      const r = await runner.startTurn(session.id, { parts: text("x") });
      assert.ok(r && r.started);
      await runner.deleteSession(session.id);
      assert.equal(await runner.getSnapshot(session.id), null);
      assert.deepEqual(await runner.listSessions(), []);
    } finally {
      await slow.close();
      useStubLlm(stub);
    }
  });

  it("reports pending permissions in the snapshot while a gated tool waits", async () => {
    // "shell" is in DEFAULT_GATED_TOOLS, so the loop parks on the gate.
    const gated = await startStubLlm((_req, i) =>
      i === 0
        ? { toolCall: { name: "shell", args: { command: "echo hi" } } }
        : { text: "done" },
    );
    useStubLlm(gated);
    try {
      const session = await runner.createSession();
      const r = await runner.startTurn(session.id, { parts: text("run it") });
      assert.ok(r && r.started);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const waiting = await runner.getSnapshot(session.id);
      assert.equal(waiting?.liveTurn?.pendingPermissions.length, 1);
      assert.equal(waiting?.liveTurn?.pendingPermissions[0].tool, "shell");
      assert.equal(waiting?.liveTurn?.pendingPermissions[0].step, 1);

      const requestId = waiting!.liveTurn!.pendingPermissions[0].id;
      assert.equal(runner.resolvePermission(session.id, requestId, "deny"), true);
      await runner.awaitIdle(session.id);

      const done = await runner.getSnapshot(session.id);
      assert.equal(done?.liveTurn, undefined);
      const assistant = done!.messages.find((m) => m.id === r.assistantMessageId)!;
      const denied = assistant.parts.find((p) => p.type === "tool_result");
      assert.ok(denied && denied.type === "tool_result" && denied.isError);
    } finally {
      await gated.close();
      useStubLlm(stub);
    }
  });

  describe("queue item mutations", () => {
    // A slow stub (matching the pattern used above for cancellation tests) so
    // "one" is genuinely still running when cancel() fires — with the shared
    // fast stub, "one" can complete before cancel() ever reaches the turn,
    // which auto-continues into "two" (Task 2) and leaves the queue empty
    // instead of held.
    const heldQueue = async (): Promise<{ sessionId: string; queuedId: string }> => {
      const slow = await startStubLlm(() => ({ text: "slow", delayMs: 5_000 }));
      useStubLlm(slow);
      try {
        const session = await runner.createSession();
        const a = await runner.startTurn(session.id, { parts: text("one") });
        assert.ok(a && a.started);
        const b = await runner.startTurn(session.id, { parts: text("two") });
        assert.ok(b && !b.started && b.reason === "queued");
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(runner.cancel(session.id), true);
        await runner.awaitIdle(session.id);
        return { sessionId: session.id, queuedId: b.queued.id };
      } finally {
        await slow.close();
        useStubLlm(stub);
      }
    };

    it("patches a queued message's fields and rejects an unknown id", async () => {
      const { sessionId, queuedId } = await heldQueue();
      const patched = await runner.patchQueueItem(sessionId, queuedId, { model: "some/model" });
      assert.equal(patched?.model, "some/model");
      assert.equal((await runner.getSnapshot(sessionId))?.session.queue[0].model, "some/model");
      assert.equal(await runner.patchQueueItem(sessionId, "ghost", { model: "x" }), null);
    });

    it("removes a queued message and reports false for an unknown id", async () => {
      const { sessionId, queuedId } = await heldQueue();
      assert.equal(await runner.removeQueueItem(sessionId, "ghost"), false);
      assert.equal(await runner.removeQueueItem(sessionId, queuedId), true);
      assert.equal((await runner.getSnapshot(sessionId))?.session.queue.length, 0);
    });

    it("sends a held queued message on demand, and refuses while a turn is running", async () => {
      const { sessionId, queuedId } = await heldQueue();

      const sent = await runner.sendQueueItem(sessionId, queuedId);
      assert.ok(sent?.sent);
      assert.equal((await runner.getSnapshot(sessionId))?.session.queue.length, 0);
      await runner.awaitIdle(sessionId);

      const c = await runner.startTurn(sessionId, { parts: text("three") });
      assert.ok(c && c.started);
      const d = await runner.startTurn(sessionId, { parts: text("four") });
      assert.ok(d && !d.started && d.reason === "queued");
      const busy = await runner.sendQueueItem(sessionId, d.queued.id);
      assert.deepEqual(busy, { sent: false, reason: "running" });
      await runner.awaitIdle(sessionId);
    });

    it("returns null/false for a queue action on an unknown session", async () => {
      assert.equal(await runner.patchQueueItem("ghost-session", "x", {}), null);
      assert.equal(await runner.removeQueueItem("ghost-session", "x"), false);
      assert.equal(await runner.sendQueueItem("ghost-session", "x"), null);
    });
  });
});
