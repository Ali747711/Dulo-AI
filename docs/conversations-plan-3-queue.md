# Conversations — Plan 3 of 7: Queue

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "a turn is running" from a dropped message into a queue. Sending while
busy appends a `QueuedMessage` and returns `202`, never an error; the first queued
item is dequeued and sent automatically the instant a turn completes; the queue is
held (not auto-sent) after a cancel or failure, with `PATCH`/`DELETE`/`send` to act on
a held item by hand. The composer shows queued messages as chips with **Send now /
Edit / Remove**.

**Architecture:** Everything server-side lives in `src/session/runner.ts` and
`src/session/routes.ts` — no new module. `startTurn`'s "begin a turn" body is
extracted into a private `beginTurn` helper so both the public entry point and the
auto-continue-on-completion path (inside `execute()`) can reuse it without
duplicating turn-construction logic. The client needs no new store logic at all:
`queue.updated` already flows through `foldSessionEvent` from Plan 2 — only
`session-client.ts` gains three thin route wrappers and `Composer` gains a queue
prop and three callbacks.

**Tech Stack:** Unchanged from Plans 1-2 — Node/TypeScript/zod on the harness,
React 19/shadcn on the client, `node:test` and `vitest` respectively.

**Spec:** `docs/conversations-design.md` §8 (Queue, the primary spec for this plan),
§4 (`QueuedMessage`'s shape — already committed, unchanged here), §7 (the
`queue.updated` event — already committed, unchanged here), §13 (the three new
routes), §14 ("composer chips with Send now / Edit / Remove" — the entire UI spec;
there is no other mockup). All of this was written and agreed in Plan 1/2's design
pass; nothing here is a new product decision, only an implementation of what §8
already settled. Two implementation decisions made *while writing this plan*, not
present in the design doc, are called out inline where they occur (race-safety of
the auto-continue transition, and `awaitIdle` becoming chain-aware) — both are
mechanical consequences of the design, not new product behaviour.

**Read first:** `context.md` (mandatory per `CLAUDE.md`), `docs/conversations-design.md`
§8/§13/§14, `src/session/runner.ts` and `src/session/routes.ts` (read the committed
files fresh — this plan's diffs assume the exact current content quoted below;
if either file has moved on since, re-derive the diffs from the real file rather
than applying these as literal patches), `src/session/types.ts` (`QueuedMessage`,
`Session.queue` — already exist, unchanged by this plan), `src/session/runner.test.ts`
(the fixtures — `text()`, the module-level `stub`, `startStubLlm`/`useStubLlm` — this
plan's new tests reuse them), `client/src/components/chat/composer.tsx` and
`client/src/pages/chat.tsx` (the files Task 5 modifies).

**Conventions that apply to every task:**
- Conventional commits, **no attribution trailers** — the owner disables them
  globally. One commit per task.
- Root checks when a task touches `src/`: `npm run typecheck && npm test`.
- Client checks when a task touches `client/`: `npm run typecheck && npm run lint &&
  npm run build && npm test` — **`typecheck` here means `tsc -b`** (fixed in Plan 2;
  do not reintroduce a plain `tsc --noEmit` at the client root, which silently checks
  zero files there — see `context.md` §4/§5 if this needs re-deriving).
- Dev servers only inside tmux (a global hook blocks `npm run dev` outside it). Ports
  3001 and 5173 are usually the owner's; use 3099 and 5174 for anything you start,
  and check `lsof -iTCP:<port> -sTCP:LISTEN` first.
- Never call the real OpenRouter API. Point `OPENROUTER_URL` at a stub for anything
  live (Task 6 writes one).
- `context.md` is git-ignored: edit it on disk, never `git add` it.
- Do not reopen `QueuedMessage`'s shape, the route table, or the "auto-continue only
  on `completed`, held on `cancelled`/`failed`" rule — all three are settled in §4/§8
  and repeated in this plan's tasks only where a task needs the exact fields.

---

## File structure

| File | Responsibility | Status |
| --- | --- | --- |
| `src/session/runner.ts` | `beginTurn` extracted; `startTurn` enqueues instead of rejecting; auto-continue on completion; `patchQueueItem`/`removeQueueItem`/`sendQueueItem`; `awaitIdle` becomes chain-aware | modify |
| `src/session/runner.test.ts` | New tests for all of the above | modify |
| `src/session/routes.ts` | `startOrReject`'s `202` branch; three new `/queue/:msgId[/send]` routes; `PatchQueueItem` zod schema | modify |
| `client/src/lib/session-client.ts` | `SendOutcome` gains `"queued"`, drops `"running"`; `patchQueuedMessage`/`removeQueuedMessage`/`sendQueuedMessage` | modify |
| `client/src/lib/session-store.test.ts` | One new test: `queue.updated` actually replaces `session.queue` | modify |
| `client/src/components/chat/composer.tsx` | `QueuedMessageChip`; `Composer` gains `queue`/`onSendNow`/`onEdit`/`onRemove` | modify |
| `client/src/pages/chat.tsx` | Wires the queue prop and the three new handlers; `send()` no longer restores the draft on a busy session | modify |
| `README.md`, `docs/conversations-design.md`, `context.md` | Docs | modify |

---

### Task 1: Harness — enqueue instead of reject when a turn is running

Extracts the turn-starting logic out of `startTurn` so it can be reused (Task 2 needs
this), and changes what happens when a turn is already running: instead of a bare
409, the message is appended to `Session.queue` and the caller gets it back.

**Why validate `parentId` before checking busy, not after (a reordering from
today's code):** today `startTurn` checks `entry.turn` first, `parentId` second. If
that order carried over unchanged, a bad `parentId` sent while a turn happens to be
running would silently enqueue nonsense instead of failing fast — and since messages
are never deleted, a `parentId` invalid now is invalid forever, so there's no reason
to defer that check. This plan swaps the order: `parentId` is validated regardless of
whether a turn is running, *then* busy-vs-not is decided.

**Files:**
- Modify: `src/session/runner.ts`, `src/session/routes.ts`
- Modify: `src/session/runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("runner", …)` block of `src/session/runner.test.ts`,
right after the `"branches when parentId is an earlier message"` test (before the
`"cancel ends the turn…"` test — placement doesn't matter functionally, only keeps
related tests near each other):

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run (repo root): `npm test`
Expected: FAIL — `Property 'queued' does not exist` / `b.reason` is `"running"`, not
`"queued"` (the old behaviour).

- [ ] **Step 3: Extract `beginTurn` and change `startTurn`**

Read `src/session/runner.ts` first — the block below is the *only* part of the file
this step touches; the rest of the file (imports, `patchSession`, `execute`'s own
turn-execution body up to its final `patchSession`, `titleFrom`, everything in the
`runner` object other than `startTurn`) is unchanged.

Replace the `StartResult` type:

```ts
export type StartResult =
  | { started: true; turnId: string; userMessageId: string; assistantMessageId: string }
  | { started: false; reason: "bad-parent" }
  | { started: false; reason: "queued"; queued: QueuedMessage };
```

Immediately after the `execute` function's closing `};` (i.e. right before
`const runner: Runner = {`), add `beginTurn` — this is `startTurn`'s current body
from `const config = resolveRunConfig(…)` onward, unchanged except that `id` is now a
local derived from `entry.session.id` instead of a parameter, and the function is
named and typed for reuse:

```ts
  /**
   * Actually begin a turn on an already-validated entry: no busy check, no
   * parentId validation — callers (startTurn below, and the auto-dequeue path
   * Task 2 adds inside execute()) do both first. Always returns the
   * `started: true` variant; the other StartResult variants exist for
   * startTurn's own early returns, not for anything beginTurn itself can hit.
   */
  const beginTurn = async (entry: LiveSession, input: TurnInput): Promise<StartResult> => {
    const id = entry.session.id;
    const config = resolveRunConfig({
      model: input.model ?? entry.session.defaults.model,
      agent: input.agent ?? entry.session.defaults.agent,
      temperature: input.temperature ?? entry.session.defaults.temperature,
      maxSteps: input.maxSteps ?? entry.session.defaults.maxSteps,
    });
    const tools = input.enabledTools
      ? config.tools.filter((t) => input.enabledTools!.includes(t.name))
      : config.tools;

    const now = new Date().toISOString();
    const turnId = randomUUID();
    const parentId = input.parentId === undefined ? entry.session.headId : input.parentId;
    const userMessage: ChatMessage = {
      id: input.messageId ?? randomUUID(),
      sessionId: id,
      parentId,
      role: "user",
      parts: input.parts,
      turnId,
      createdAt: now,
    };
    const assistant: ChatMessage = {
      id: randomUUID(),
      sessionId: id,
      parentId: userMessage.id,
      role: "assistant",
      parts: [],
      turnId,
      createdAt: now,
    };

    entry.messages.push(userMessage);
    await store.appendMessage(userMessage);
    const firstMessage = entry.messages.length === 1;
    await patchSession(entry, {
      headId: userMessage.id,
      status: "running",
      ...(firstMessage && entry.session.title === DEFAULT_TITLE
        ? { title: titleFrom(input.parts) }
        : {}),
    });
    publish(entry, { type: "message.created", message: userMessage }, turnId);

    const turn: Turn = {
      id: turnId,
      sessionId: id,
      userMessageId: userMessage.id,
      assistantMessageId: assistant.id,
      model: config.model,
      agent: config.agent,
      temperature: config.temperature,
      maxSteps: config.maxSteps,
      status: "running",
      startedAt: now,
      durationMs: 0,
    };

    const controller = new AbortController();
    const liveTurn: LiveTurn = {
      turn,
      assistant,
      controller,
      step: 0,
      gate: createGate({
        gated: getRegistry().gatedTools,
        onAsk: (ask) =>
          publish(entry, {
            type: "permission.ask", step: liveTurn.step, id: ask.id, tool: ask.tool, args: ask.args,
          }, turnId),
        onSettled: (requestId, tool, decision) =>
          publish(entry, {
            type: "permission.resolved", step: liveTurn.step, id: requestId, tool, decision,
          }, turnId),
      }),
      done: Promise.resolve(),
    };
    controller.signal.addEventListener("abort", () => liveTurn.gate.abandon());
    entry.turn = liveTurn; // see execute()'s auto-continue branch (Task 2) for why
    // this line must *replace* entry.turn rather than run after it was cleared
    turnToSession.set(turnId, id);

    publish(entry, {
      type: "run.start",
      runId: turnId,
      query: textOf(input.parts),
      model: config.model,
      startedAt: now,
      sessionId: id,
      turnId,
      userMessageId: userMessage.id,
      assistantMessageId: assistant.id,
    }, turnId);

    liveTurn.done = execute(entry, liveTurn, config, tools).catch((error) => {
      console.error(`[session ${id.slice(0, 8)}] turn crashed:`, messageOf(error));
    });

    return { started: true, turnId, userMessageId: userMessage.id, assistantMessageId: assistant.id };
  };
```

Note on ordering: `beginTurn` is defined *after* `execute` but calls it, and Task 2
makes `execute` call `beginTurn` back — this mutual reference is safe because
neither function's *body* runs until the runner is actually used (both are plain
`const` closures assigned once, synchronously, while `createRunner` sets up; by the
time either is *called*, both names are already bound in the enclosing scope). No
hoisting trick is needed and none should be added.

Replace `startTurn` in the `runner` object with:

```ts
    async startTurn(id, input) {
      const entry = await load(id);
      if (!entry) return null;
      if (input.parentId && !entry.messages.some((m) => m.id === input.parentId)) {
        return { started: false, reason: "bad-parent" };
      }
      if (entry.turn) {
        const queued: QueuedMessage = {
          id: input.messageId ?? randomUUID(),
          parts: input.parts,
          ...(input.parentId ? { parentId: input.parentId } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.agent ? { agent: input.agent } : {}),
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
          queuedAt: new Date().toISOString(),
        };
        await patchSession(entry, { queue: [...entry.session.queue, queued] });
        return { started: false, reason: "queued", queued };
      }
      return beginTurn(entry, input);
    },
```

Known, deliberate limitation: `input.parentId === null` (an edit-and-resend of the
very first message) queued while a turn is running degrades to "head at send time"
instead of "force a new root" — `QueuedMessage.parentId` (already fixed by Plan 1) has
no way to represent an explicit new-root. Nothing in the app can produce this input
today (the composer only ever sends `parentId: undefined`; edit-and-resend is Plan
4, not built yet), so this is left as a documented gap for Plan 4 to close if it
turns out to matter, not something this task works around.

- [ ] **Step 4: Update `routes.ts`'s `202` branch**

In `src/session/routes.ts`, replace `startOrReject`'s middle branch:

```ts
  if (result === null) return json(res, 404, { error: `no session ${sessionId}` }, corsHeaders);
  if (!result.started) {
    if (result.reason === "queued") {
      return json(res, 202, { queued: result.queued }, corsHeaders);
    }
    return json(res, 400, { error: "parentId is not in this session" }, corsHeaders);
  }
```

(The old `const status = result.reason === "running" ? 409 : 400;` line and its
comment `// Plan 3 turns "running" into a 202 with a queued message.` are both gone —
this *is* that change landing.)

- [ ] **Step 5: Run to verify pass**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; `# pass 47`, `# fail 0` (45 from Plans 1-2 plus these two).

- [ ] **Step 6: Commit**

```bash
git add src/session/runner.ts src/session/routes.ts src/session/runner.test.ts
git commit -m "feat(session): queue a message instead of rejecting it while a turn is running"
```

---

### Task 2: Harness — auto-continue on completion, held on cancel/fail

**Files:**
- Modify: `src/session/runner.ts`
- Modify: `src/session/runner.test.ts`

**The race this task has to not introduce:** `startTurn`'s only busy check is
`if (entry.turn) …` — a truthy in-memory reference, nothing else. If the code that
finishes one turn and starts the next ever did `entry.turn = undefined` and *then*,
after an `await`, assigned the next turn to `entry.turn`, there would be a real
window — however small — where an externally-driven `startTurn` call could read
`entry.turn` as falsy and start a second, genuinely concurrent turn for the same
session. The fix is structural, not timing-based: the auto-continue branch below
never clears `entry.turn`; `beginTurn` (Task 1) only ever *replaces* it in one
synchronous assignment. At every point during the transition, `entry.turn` is either
the just-finished turn or the new one — never neither. This is why the task is
verified by reading the code (the diff below has no `entry.turn = undefined` on the
auto-continue path) rather than by a timing-based test — a test racing a real clock
against an event loop can't prove a structural absence of a gap, and a flaky test
purporting to would be worse than no test at all.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("runner", …)`:

```ts
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
```

The first test relies on the module-level `stub`'s existing behaviour (reply with
`seen N user messages`, already exercised by `"carries context across two turns"`) to
prove the three turns really ran in order with growing context, not just that
`turns.length === 3`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — the first test times out or asserts on stale state (nothing
dequeues today); the second test currently passes by accident (the queue is already
never auto-sent, since nothing dequeues at all yet) but keep it — it pins down the
*intended* behaviour, not just "nothing happens".

- [ ] **Step 3: Auto-continue in `execute()`, and a chain-aware `awaitIdle`**

Read `src/session/runner.ts`'s current `execute()` — the block below replaces
everything from `entry.turn = undefined;` (the line right before the final
`patchSession` call) through the end of the function, i.e. replaces:

```ts
    entry.turn = undefined;
    await patchSession(entry, {
      headId: assistant.id,
      status: "idle",
      defaults: {
        ...entry.session.defaults,
        model: config.model,
        ...(config.agent ? { agent: config.agent } : {}),
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        maxSteps: config.maxSteps,
      },
    });
    // Plan 3 adds: if completed and queue non-empty, dequeue and startTurn.
  };
```

with:

```ts
    const defaults = {
      ...entry.session.defaults,
      model: config.model,
      ...(config.agent ? { agent: config.agent } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      maxSteps: config.maxSteps,
    };

    const next = result.status === "completed" ? entry.session.queue[0] : undefined;
    if (next) {
      // Dequeue and begin the next turn without ever clearing entry.turn in
      // between — beginTurn() replaces it directly (Task 1). A session is
      // therefore never observably idle between an auto-continued turn and
      // the one before it; see this task's own note above for why that
      // matters and why it isn't proven by a timing-based test.
      // queue.updated (this patchSession call) is published before
      // beginTurn's own message.created, matching design §8's ordering.
      await patchSession(entry, { headId: assistant.id, queue: entry.session.queue.slice(1), defaults });
      await beginTurn(entry, {
        parts: next.parts,
        parentId: next.parentId,
        model: next.model,
        agent: next.agent,
        temperature: next.temperature,
        maxSteps: next.maxSteps,
        messageId: next.id,
      });
    } else {
      entry.turn = undefined;
      await patchSession(entry, { headId: assistant.id, status: "idle", defaults });
    }
  };
```

Then, in the `runner` object, replace `awaitIdle`:

```ts
    async awaitIdle(id) {
      for (;;) {
        const entry = live.get(id);
        if (!entry?.turn) return;
        const current = entry.turn;
        await current.done;
        if (entry.turn === current) return; // no auto-continued turn replaced it
        // else: an auto-continued turn took its place — wait for that one too.
      }
    },
```

Why this changes: `beginTurn` fires off `execute()` without awaiting it (unchanged
from today — `startTurn` never waited for a turn to finish either), so the *first*
turn's own `execute()` call returns as soon as it has kicked off the next one, not
once the whole chain is done. A caller — including these tests, and anything else
that calls `awaitIdle` expecting "nothing is running any more" — needs it to follow
the chain, which is exactly what looping while `entry.turn` keeps getting replaced
does. `deleteSession`'s own `await entry.turn.done` is unaffected: a cancelled turn's
`result.status` is `"cancelled"`, so the auto-continue branch above never triggers
for it, and a single await is still correct there.

- [ ] **Step 4: Run to verify pass**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; `# pass 49`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/session/runner.ts src/session/runner.test.ts
git commit -m "feat(session): auto-continue queued messages on completion, hold on cancel or failure"
```

---

### Task 3: Harness — act on a held queue item by hand

`PATCH`/`DELETE /api/sessions/:id/queue/:msgId` and
`POST /api/sessions/:id/queue/:msgId/send`, per design §13. These matter for the
queue *held* after a cancel/fail (§8) — a queue item still waiting behind a running
turn already gets sent automatically by Task 2 the moment that turn finishes, so
these three are exercised here against a held (idle, cancelled-turn) queue, not a
running one; a running one is covered indirectly by Tasks 1-2.

**Files:**
- Modify: `src/session/runner.ts`, `src/session/routes.ts`
- Modify: `src/session/runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("runner", …)`, as a new nested `describe`:

```ts
  describe("queue item mutations", () => {
    const heldQueue = async (): Promise<{ sessionId: string; queuedId: string }> => {
      const session = await runner.createSession();
      const a = await runner.startTurn(session.id, { parts: text("one") });
      assert.ok(a && a.started);
      const b = await runner.startTurn(session.id, { parts: text("two") });
      assert.ok(b && !b.started && b.reason === "queued");
      assert.equal(runner.cancel(session.id), true);
      await runner.awaitIdle(session.id);
      return { sessionId: session.id, queuedId: b.queued.id };
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `runner.patchQueueItem is not a function` (and similarly for the
other two).

- [ ] **Step 3: Implement the three methods**

Add to the `Runner` interface (`runner.ts`), after `resolvePermission`:

```ts
  /** null = no such session or no such queued message. */
  patchQueueItem(
    id: string,
    msgId: string,
    patch: Partial<Pick<QueuedMessage, "parts" | "parentId" | "model" | "agent">>,
  ): Promise<QueuedMessage | null>;
  /** true = removed. false = no such session or no such queued message. */
  removeQueueItem(id: string, msgId: string): Promise<boolean>;
  /** null = no such session or no such queued message. */
  sendQueueItem(id: string, msgId: string): Promise<SendQueuedResult | null>;
```

and export the result type next to `StartResult`:

```ts
export type SendQueuedResult =
  | { sent: true; turnId: string; userMessageId: string; assistantMessageId: string }
  | { sent: false; reason: "running" };
```

Add the three methods to the `runner` object, after `resolvePermission`:

```ts
    async patchQueueItem(id, msgId, patch) {
      const entry = await load(id);
      if (!entry) return null;
      const idx = entry.session.queue.findIndex((q) => q.id === msgId);
      if (idx === -1) return null;
      const updated: QueuedMessage = { ...entry.session.queue[idx], ...patch };
      const queue = entry.session.queue.slice();
      queue[idx] = updated;
      await patchSession(entry, { queue });
      return updated;
    },

    async removeQueueItem(id, msgId) {
      const entry = await load(id);
      if (!entry) return false;
      const queue = entry.session.queue.filter((q) => q.id !== msgId);
      if (queue.length === entry.session.queue.length) return false;
      await patchSession(entry, { queue });
      return true;
    },

    async sendQueueItem(id, msgId) {
      const entry = await load(id);
      if (!entry) return null;
      const item = entry.session.queue.find((q) => q.id === msgId);
      if (!item) return null;
      if (entry.turn) return { sent: false, reason: "running" };
      await patchSession(entry, { queue: entry.session.queue.filter((q) => q.id !== msgId) });
      const result = await beginTurn(entry, {
        parts: item.parts,
        parentId: item.parentId,
        model: item.model,
        agent: item.agent,
        temperature: item.temperature,
        maxSteps: item.maxSteps,
        messageId: item.id,
      });
      // beginTurn only ever returns started:true here — bad-parent and busy
      // are both already ruled out above — but the type checker doesn't know
      // that, so this narrows explicitly rather than asserting.
      return result.started
        ? { sent: true, turnId: result.turnId, userMessageId: result.userMessageId, assistantMessageId: result.assistantMessageId }
        : { sent: false, reason: "running" };
    },
```

- [ ] **Step 4: Add the HTTP routes**

In `src/session/routes.ts`, add the schema next to `PermissionReply`:

```ts
const PatchQueueItem = z
  .object({
    parts: z.array(UserPart).min(1).max(50).optional(),
    parentId: z.string().min(1).max(64).optional(),
    model: Settings.model,
    agent: Settings.agent,
  })
  .refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
```

In `handleSessionRoutes`, inside the session-id `if (m) { … }` block, right after the
existing `permission/:requestId` block and before `return false;`:

```ts
    const queueItem = rest.match(/^queue\/([\w-]{1,64})$/);
    if (queueItem && method === "PATCH") {
      const parsed = PatchQueueItem.safeParse(await readJsonBody(req).catch(() => null));
      if (!parsed.success) return json(res, 400, { error: "invalid body", issues: parsed.error.issues }, cors), true;
      const updated = await runner.patchQueueItem(id, queueItem[1], parsed.data);
      return updated ? (json(res, 200, updated, cors), true) : (json(res, 404, { error: `no queued message ${queueItem[1]}` }, cors), true);
    }
    if (queueItem && method === "DELETE") {
      const removed = await runner.removeQueueItem(id, queueItem[1]);
      return removed ? (json(res, 204, undefined, cors), true) : (json(res, 404, { error: `no queued message ${queueItem[1]}` }, cors), true);
    }
    const queueSend = rest.match(/^queue\/([\w-]{1,64})\/send$/);
    if (queueSend && method === "POST") {
      const result = await runner.sendQueueItem(id, queueSend[1]);
      if (!result) return json(res, 404, { error: `no queued message ${queueSend[1]}` }, cors), true;
      if (!result.sent) return json(res, 409, { error: "a turn is running" }, cors), true;
      return json(res, 200, { turnId: result.turnId, userMessageId: result.userMessageId, assistantMessageId: result.assistantMessageId }, cors), true;
    }
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; `# pass 53`, `# fail 0`.

- [ ] **Step 6: Verify the routes live, against a stub**

From the repo root, in a scratch tmux session (kill it when done; do not touch the
owner's own :3001/:5173):

```bash
lsof -iTCP:3099 -sTCP:LISTEN -t >/dev/null && echo "3099 taken — pick another" || echo "3099 free"
cat > /tmp/plan3-stub.cjs <<'EOF'
const http = require("node:http");
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
}).listen(4591);
EOF
tmux new-session -d -s plan3-verify "node /tmp/plan3-stub.cjs"
tmux new-window -t plan3-verify "PORT=3099 OPENROUTER_API_KEY=test OPENROUTER_URL=http://127.0.0.1:4591/x npx tsx src/server.ts"
sleep 2
SID=$(curl -s -X POST http://127.0.0.1:3099/api/sessions -H 'content-type: application/json' -d '{}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s -X POST http://127.0.0.1:3099/api/sessions/$SID/messages -H 'content-type: application/json' -d '{"text":"one"}'
QID=$(curl -s -X POST http://127.0.0.1:3099/api/sessions/$SID/messages -H 'content-type: application/json' -d '{"text":"two"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["queued"]["id"])')
echo "queued id: $QID (expect a 202 body above with this id, and this session's queue length 1 via GET)"
curl -s http://127.0.0.1:3099/api/sessions/$SID | python3 -c 'import json,sys;print(json.load(sys.stdin)["session"]["queue"])'
curl -s -X PATCH http://127.0.0.1:3099/api/sessions/$SID/queue/$QID -H 'content-type: application/json' -d '{"model":"test/model"}'
curl -s -X DELETE http://127.0.0.1:3099/api/sessions/$SID/queue/$QID -o /dev/null -w "DELETE status: %{http_code}\n"
tmux kill-session -t plan3-verify
rm -f /tmp/plan3-stub.cjs
rm -rf sessions
```

Expected: the `POST .../messages` for "two" returns `202` with a `queued` object; the
session's `queue` array has one entry matching that id; the `PATCH` returns the
updated item with `model: "test/model"`; the `DELETE` returns `204`.

- [ ] **Step 7: Commit**

```bash
git add src/session/runner.ts src/session/routes.ts src/session/runner.test.ts
git commit -m "feat(session): patch, remove, and send-on-demand a held queued message"
```

---

### Task 4: Client — mirror the queue API

**Files:**
- Modify: `client/src/lib/session-client.ts`
- Modify: `client/src/lib/session-store.test.ts`

- [ ] **Step 1: Write the failing test**

`foldSessionEvent`'s `queue.updated` case has existed since Plan 2 but was never
actually exercised by a test (it only ever ran as dead code before this plan). Add
one, in `client/src/lib/session-store.test.ts`'s `describe("foldSessionEvent", …)`
block:

```ts
  it("replaces the queue on queue.updated", () => {
    const queued = {
      id: "q1", parts: [{ type: "text" as const, text: "later" }], queuedAt: "x",
    }
    const next = foldSessionEvent(loaded(), ev(1, { type: "queue.updated", queue: [queued] }))
    expect(next.session.queue).toEqual([queued])
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `loaded()`'s `session.queue` starts `[]`; the test currently passes
trivially only if `foldSessionEvent` is buggy in a way that happens to still produce
`[]`, so run it and confirm it genuinely exercises the replace (temporarily change
the expected value to something wrong and confirm the test fails, then put the
correct expectation back) if there's any doubt — the existing `case "queue.updated"`
implementation already does the right thing, so this step is really "prove the test
itself is meaningful," not "find a bug to fix."

- [ ] **Step 3: Update `SendOutcome` and add the three wrappers**

In `client/src/lib/session-client.ts`, replace:

```ts
export type SendOutcome =
  | { status: "started"; turn: StartedTurn }
  /** A turn is already running. Plan 3 turns this into a queued message. */
  | { status: "running" }

export const sendMessage = async (
  base: string,
  sessionId: string,
  text: string
): Promise<SendOutcome> => {
  const res = await call(base, `/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ text }),
  })
  if (res.status === 409) return { status: "running" }
  await expectOk(res, "message send")
  return { status: "started", turn: (await res.json()) as StartedTurn }
}
```

with:

```ts
export type SendOutcome =
  | { status: "started"; turn: StartedTurn }
  | { status: "queued"; queued: QueuedMessage }

export const sendMessage = async (
  base: string,
  sessionId: string,
  text: string
): Promise<SendOutcome> => {
  const res = await call(base, `/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ text }),
  })
  if (res.status === 202) return { status: "queued", queued: (await res.json()).queued as QueuedMessage }
  await expectOk(res, "message send")
  return { status: "started", turn: (await res.json()) as StartedTurn }
}
```

Add `QueuedMessage` to the type-only import at the top of the file:

```ts
import type {
  QueuedMessage,
  Session,
  SessionEvent,
  SessionSnapshot,
  SessionSummary,
  StartedTurn,
} from "./session-types"
```

Add the three wrappers after `replySessionPermission`:

```ts
export const patchQueuedMessage = async (
  base: string,
  sessionId: string,
  msgId: string,
  patch: Partial<Pick<QueuedMessage, "parts" | "parentId" | "model" | "agent">>
): Promise<QueuedMessage> => {
  const res = await expectOk(
    await call(base, `/api/sessions/${sessionId}/queue/${msgId}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(patch),
    }),
    "queued message patch"
  )
  return (await res.json()) as QueuedMessage
}

export const removeQueuedMessage = async (
  base: string,
  sessionId: string,
  msgId: string
): Promise<void> => {
  await expectOk(
    await call(base, `/api/sessions/${sessionId}/queue/${msgId}`, { method: "DELETE" }),
    "queued message remove"
  )
}

export type SendQueuedOutcome =
  | { sent: true; turn: StartedTurn }
  | { sent: false }

export const sendQueuedMessage = async (
  base: string,
  sessionId: string,
  msgId: string
): Promise<SendQueuedOutcome> => {
  const res = await call(base, `/api/sessions/${sessionId}/queue/${msgId}/send`, { method: "POST" })
  if (res.status === 409) return { sent: false }
  await expectOk(res, "queued message send")
  return { sent: true, turn: (await res.json()) as StartedTurn }
}
```

`patchQueuedMessage` is not called by any UI in this plan yet — the composer's Edit
action (Task 5) removes and reloads into the draft rather than patching in place, a
deliberate simplification explained there. It is still added here because the
harness route exists (Task 3) and a thin, correct client wrapper for a committed
route is worth having regardless of which page calls it first.

- [ ] **Step 4: Run to verify pass**

Run: `npm run typecheck && npm run lint && npm run build && npm test`
Expected: all clean; `# Tests 25 passed` (24 from Plans 1-2 plus the new
`queue.updated` test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/session-client.ts src/lib/session-store.test.ts
git commit -m "feat(client): mirror the queue API — 202 on send, patch/remove/send-now wrappers"
```

---

### Task 5: Client — queued-message chips in the composer

Per design §14: "composer chips with Send now / Edit / Remove." There is no other
mockup or wireframe anywhere in the design docs — this task is the entire UI spec.

**Files:**
- Modify: `client/src/components/chat/composer.tsx`, `client/src/pages/chat.tsx`

- [ ] **Step 1: Confirm the icons exist**

This step exists because two of the three icons below haven't been used elsewhere in
this codebase yet (`Delete02Icon` has — `playground.tsx`'s "Clear history" button).
Before writing the component, check:

```bash
grep -n "declare const Edit02Icon\|declare const Delete02Icon" node_modules/@hugeicons/core-free-icons/dist/types/index.d.ts
```

If `Edit02Icon` isn't there, pick any edit/pencil-shaped icon that is (e.g.
`PencilEdit01Icon`) and use that name in Step 2 instead.

- [ ] **Step 2: Add `QueuedMessageChip` and the queue prop to `Composer`**

Replace `client/src/components/chat/composer.tsx` in full:

```tsx
// client/src/components/chat/composer.tsx
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Delete02Icon,
  Edit02Icon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import type { QueuedMessage } from "@/lib/session-types"

const textOf = (message: QueuedMessage): string =>
  message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ")

/**
 * One message waiting to send — queued behind a running turn (auto-sends the
 * instant that turn finishes) or held after a cancel/failure (stays until
 * acted on). "Send now" only succeeds while idle, so it's disabled while
 * `running` — clicking it during a running turn would just 409.
 */
function QueuedMessageChip({
  message,
  canSendNow,
  onSendNow,
  onEdit,
  onRemove,
}: {
  message: QueuedMessage
  canSendNow: boolean
  onSendNow: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
      <Badge variant="outline">queued</Badge>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {textOf(message)}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="ghost" disabled={!canSendNow} onClick={onSendNow}>
          Send now
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Edit queued message" onClick={onEdit}>
          <HugeiconsIcon icon={Edit02Icon} />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Remove queued message" onClick={onRemove}>
          <HugeiconsIcon icon={Delete02Icon} />
        </Button>
      </div>
    </div>
  )
}

interface ComposerProps {
  value: string
  onChange: (text: string) => void
  onSend: () => void
  onStop: () => void
  /** A turn is running: show Stop, keep the input live for the next message. */
  running: boolean
  /** Why sending is unavailable (offline, no session); disables Send. */
  disabledReason?: string
  /** Messages waiting to be sent — queued while running, held after cancel/fail. */
  queue: QueuedMessage[]
  onSendNow: (id: string) => void
  onEdit: (message: QueuedMessage) => void
  onRemove: (id: string) => void
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabledReason,
  queue,
  onSendNow,
  onEdit,
  onRemove,
}: ComposerProps) {
  const canSend = value.trim().length > 0 && !disabledReason

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend) onSend()
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      {queue.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5">
          {queue.map((message) => (
            <QueuedMessageChip
              key={message.id}
              message={message}
              canSendNow={!running}
              onSendNow={() => onSendNow(message.id)}
              onEdit={() => onEdit(message)}
              onRemove={() => onRemove(message.id)}
            />
          ))}
        </div>
      )}
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={disabledReason ?? "Message Dulo…"}
        rows={3}
        className="min-h-20 resize-none"
        aria-label="Message"
      />
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="hidden text-xs text-muted-foreground sm:flex sm:items-center sm:gap-1">
          <KbdGroup>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          to send ·
          <KbdGroup>
            <Kbd>Shift</Kbd>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          for a new line
        </span>
        <div className="ml-auto flex items-center gap-2">
          {running && (
            <Button variant="outline" size="sm" onClick={onStop}>
              <HugeiconsIcon icon={StopIcon} data-icon="inline-start" />
              Stop
            </Button>
          )}
          <Button size="sm" disabled={!canSend} onClick={onSend}>
            <HugeiconsIcon icon={SentIcon} data-icon="inline-start" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire it up in `chat.tsx`**

Add to the import from `@/lib/session-client`:

```ts
import {
  cancelSession,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  removeQueuedMessage,
  renameSession,
  replySessionPermission,
  sendMessage,
  sendQueuedMessage,
  streamSession,
} from "@/lib/session-client"
```

Add the type import:

```ts
import type { QueuedMessage } from "@/lib/session-types"
```

Replace `send()` — it no longer restores the draft when the harness responds
`queued`, because unlike the old `409`, a `202` means the message really was
captured, just deferred:

```ts
  const send = async () => {
    if (!selectedId || !draft.trim()) return
    const text = draft
    setDraft("")
    try {
      const outcome = await sendMessage(base, selectedId, text)
      if (outcome.status === "queued") {
        toast("Queued — it will send once the current turn finishes")
      }
    } catch (error) {
      setDraft(text)
      toast.error(describe(error))
    }
  }
```

Add three handlers, right after `send`:

```ts
  const queuedText = (message: QueuedMessage): string =>
    message.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join(" ")

  const sendQueuedNow = async (msgId: string) => {
    if (!selectedId) return
    try {
      const outcome = await sendQueuedMessage(base, selectedId, msgId)
      if (!outcome.sent) toast.error("A turn is running — it will send automatically once it finishes")
    } catch (error) {
      toast.error(describe(error))
    }
  }

  // Edit takes the item out of the queue and reloads its text into the
  // draft, rather than patching it in place — this reuses the normal
  // compose-and-send pipeline instead of a second "editing a queued item"
  // mode, at the cost of losing any parentId/model/agent override the item
  // had (a plain re-send from the composer never sets those).
  const editQueued = (message: QueuedMessage) => {
    if (!selectedId) return
    setDraft(queuedText(message))
    void removeQueuedMessage(base, selectedId, message.id).catch((error) => toast.error(describe(error)))
  }

  const removeQueued = (msgId: string) => {
    if (!selectedId) return
    void removeQueuedMessage(base, selectedId, msgId).catch((error) => toast.error(describe(error)))
  }
```

Update the `<Composer>` element:

```tsx
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          onStop={() => void stop()}
          running={Boolean(running)}
          disabledReason={disabledReason}
          queue={selected?.session.queue ?? []}
          onSendNow={(id) => void sendQueuedNow(id)}
          onEdit={editQueued}
          onRemove={removeQueued}
        />
```

No change to `session-store.tsx` is needed: `queue.updated` already flows into
`session.queue` (Plan 2, now finally exercised by a real test — Task 4), and none of
these three actions do an optimistic local update — the session's own event stream
is already open while its Chat page is visible, so the round trip back through
`queue.updated` is the only source of truth, consistent with how `cancelSession` and
`replySessionPermission` already work.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run build && npm test
git add src/components/chat/composer.tsx src/pages/chat.tsx
git commit -m "feat(client): queued-message chips in the composer — Send now / Edit / Remove"
```

---

### Task 6: Real-browser verification, docs and context

**Files:**
- Modify: `README.md`, `docs/conversations-design.md`, `context.md` (on disk only)

- [ ] **Step 1: Start a stub, the harness, and vite**

Same pattern as Plan 2's Task 9 — port 3001/5173 are usually the owner's; check
first and use 3099/5174.

```bash
lsof -iTCP:3001 -sTCP:LISTEN -t >/dev/null && echo "3001 taken — use 3099" || echo "3001 free"
cat > tmp-stub.cjs <<'EOF'
// Streams slowly (600ms/word) so a second message can be sent while the first
// is still running; replies with how many user messages it has seen.
const http = require("node:http");
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    const body = JSON.parse(b);
    const users = body.messages.filter((m) => m.role === "user").length;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const words = `You have sent ${users} messages in this chat.`.split(" ");
    let i = 0;
    const tick = setInterval(() => {
      if (i < words.length) { send({ choices: [{ delta: { content: (i ? " " : "") + words[i++] } }] }); return; }
      clearInterval(tick);
      send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
      res.write("data: [DONE]\n\n"); res.end();
    }, 600);
  });
}).listen(4592);
EOF
tmux kill-session -t dulo-plan3 2>/dev/null
tmux new-session -d -s dulo-plan3 "node tmp-stub.cjs"
tmux new-window -t dulo-plan3 "PORT=3099 OPENROUTER_API_KEY=test OPENROUTER_URL=http://127.0.0.1:4592/x npx tsx src/server.ts"
tmux new-window -t dulo-plan3 "cd client && npx vite --port 5174"
sleep 5
curl -s http://127.0.0.1:3099/api/health | head -c 60; echo
```

- [ ] **Step 2: Point the panel at the harness**

Open `http://localhost:5174`, go to **Settings**, set the API base URL to
`http://localhost:3099`, confirm **Online**.

- [ ] **Step 3: Walk the queue**

1. Open **Chat**, create a new session, send `one`. While it is streaming (the
   stub takes a few seconds), send `two`, then `three`. Expected: both `two` and
   `three` appear as queued chips above the composer immediately (no error, no
   draft left behind); the composer stays usable.
2. Wait for all three to finish. Expected: three separate assistant replies appear
   in order ("You have sent 1/2/3 messages…"), the chips are gone, the queue is
   empty, and this matches what Task 2's `runner.test.ts` proved server-side.
3. Send `four`, then immediately press **Stop**. Expected: the turn cancels; send
   `five` while `four`'s turn is still finishing up (if the queued-then-cancel
   timing is tricky to hit by hand, instead: send `four`, queue `five` behind it,
   then press Stop). Either way, end state expected: the cancelled turn shows no
   error alert (cancelled ≠ failed), and the queued item for `five` is **still
   there** as a chip — not auto-sent — proving the "held after cancel" behaviour.
4. On that held chip: click **Send now**. Expected: it sends immediately (idle, so
   this succeeds) and disappears from the queue once its turn starts.
5. Queue another message (send something while a turn is running), then click
   **Remove** on its chip. Expected: it disappears and never gets sent.
6. Queue another message, then click **Edit** on its chip. Expected: it disappears
   from the queue and its text appears in the composer's textarea, editable.
7. With a turn genuinely running, open the row menu (**Send now** button) on a
   queued chip. Expected: disabled (greyed out) — clicking sends nothing and
   returns nothing, matching that `sendQueueItem` only succeeds while idle.

- [ ] **Step 4: Clean up**

```bash
tmux kill-session -t dulo-plan3
rm -f tmp-stub.cjs
rm -rf sessions
```

Reset Settings' API URL to `http://localhost:3001` if changed.

- [ ] **Step 5: Design status and context.md**

In `docs/conversations-design.md`, change the status line to:

`Status: approved 2026-09-13. Plans 1-3 (session core, chat page, queue) implemented <date>. Owner: Ali. Author: Claude.`

Per `CLAUDE.md`: update `context.md` — §3 add the queue-related `runner.ts`
additions (`beginTurn`, chain-aware `awaitIdle`, `patchQueueItem`/`removeQueueItem`/
`sendQueueItem`) and the client's three new wrappers; §4 decision rows for the
race-safety approach (never clear `entry.turn` before its replacement is ready) and
for "Edit removes + reloads into the draft, rather than patching in place"; §6
timeline row; §7 mark Plan 3 done, Plans 4-7 remaining. §8 log line. Bump **Last
updated**.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm test
cd client && npm run typecheck && npm run lint && npm run build && npm test && cd ..
git add README.md docs/conversations-design.md
git commit -m "docs: queue in the design doc, mark plan 3 done"
```

(README isn't otherwise touched — Plan 2's Chat section already describes the
control panel at the right level of detail for a queue implementation detail like
this one; nothing there is now wrong, just slightly incomplete, which is fine for a
README.)

---

## Self-review against the spec

- **§8 Queue, all four bullets:** enqueue-on-running → Task 1; auto-continue on
  completion → Task 2; held on cancel/fail → Task 2's second test; branch-via-stale-
  parentId → Task 1's known-limitation note (the one edge case genuinely not fully
  representable, explicitly scoped to Plan 4).
- **§13 API table, the three queue rows:** `PATCH`/`DELETE`/`send` → Task 3, exact
  paths and response shapes matched.
- **§14 "composer chips with Send now / Edit / Remove":** the entirety of the UI
  spec, implemented literally as three actions per chip in Task 5.
- **Race safety:** the one genuinely new engineering decision this plan makes
  (beyond implementing already-settled design) — documented inline in Task 2 with
  the reasoning for why it's proven by code structure, not by a test.
- **Type consistency:** `SendOutcome`'s `"running"` variant is fully retired (not
  left dangling) — the only two call sites (`session-client.ts` itself and
  `chat.tsx`'s `send()`) are both updated in the same task pass they're touched.
- **Placeholders:** one, deliberate — Step 1 of Task 5 asks the implementer to
  confirm `Edit02Icon` exists before using it, with a named fallback, because it
  hasn't been used elsewhere in this codebase to date and the design doc doesn't
  pin an icon (it only specifies the label "Edit").

## What comes after this plan

| Plan | Scope | Depends on |
| --- | --- | --- |
| 4 — Branching UI | Edit → resend as sibling (also serves as Retry), `BranchSwitcher` `‹ k/n ›` using `siblingsOf`, `PATCH { headId }` via `latestLeaf`; revisit whether `QueuedMessage.parentId` needs to represent an explicit new-root now that edit-and-resend actually exists | 2 |
| 5 — Per-turn model/agent + attachments | Pickers in the composer from `/api/agents` and the model list; `PUT /files`, `GET /files/:id`; `@shadcn/attachment` chips on user messages; read text-like files into the `attachments` map before projection | 1, 2 |
| 6 — Memory | Threshold check, summarisation call, extend-not-replace, `GET/PATCH /memory`, `MemoryPanel` in a Sheet | 1, 2 |
| 7 — Switch-over | Chat as the default page; remove `runs/` from `.gitignore`; README; `context.md` | all |
