# Conversations — Plan 1 of 7: Session Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the harness a real conversation model — sessions with a message tree, turns that run the existing agent loop over the session's history, a seq-numbered event stream per session, and a file-backed store behind an interface — while every existing client keeps working unchanged.

**Architecture:** A `Session` owns a tree of `ChatMessage`s and a `headId`. A turn projects the root→head path into the OpenAI-shaped `Message[]` the loop already consumes (`projectHistory`), runs it through the existing loop (`runTurn`, which is today's `runAgent` minus the `[system, user]` construction), and folds the resulting events into one assistant message's ordered parts (`foldTurnEvent`). `src/session/runner.ts` owns live state the way `src/runs.ts` does today, re-keyed by session. `POST /api/run` becomes "new session, one turn", so the Go TUI and the CLI are untouched.

**Tech Stack:** Node 20+ (26 installed), TypeScript via `tsx`, `zod` (already a dependency), Node's built-in `node:test` for the first test suite. No new runtime dependencies.

**Spec:** `docs/conversations-design.md`. This plan implements its §17 phase 1. Phases 2–7 get their own plan files once this lands, because their code depends on the shapes this plan produces.

**Read first:** `context.md` (mandatory per `CLAUDE.md`), then `src/agent.ts`, `src/runs.ts`, `src/server.ts`, `src/events.ts`, `src/permissions.ts`. The runner in this plan replaces `src/runs.ts`; read it to see the patterns (serialised writes, seq, subscribers, gate on the handle) that carry over.

**Conventions that apply to every task:**
- Commits are conventional (`feat|fix|refactor|test|docs|chore: …`) with **no attribution trailers** — the owner has them disabled globally.
- Run the harness only inside tmux (`tmux new-session -d -s dulo "npx tsx watch src/server.ts"`); a global hook blocks `npm run dev` outside tmux. Port 3001 is usually taken by the owner; use `PORT=3099`.
- Never call the real OpenRouter API in tests. Set `OPENROUTER_URL` to a local stub (the helper in Task 2) and `OPENROUTER_API_KEY=test`. `src/llm.ts` reads the URL per call, so setting the env var after import works.
- Before every commit: `npm run typecheck` and `npm test` pass in the root.
- After the final task, update `context.md` (§3, §4, §6, §7, §8) as `CLAUDE.md` requires.

---

## File structure

| File | Responsibility | Status |
| --- | --- | --- |
| `src/session/types.ts` | Session, ChatMessage, Part, Turn, QueuedMessage, Memory, SessionSummary, SessionEvent | create |
| `src/session/store.ts` | `SessionStore` interface only | create |
| `src/session/store/files.ts` | JSON Lines implementation under `sessions/` | create |
| `src/session/tree.ts` | `pathToHead`, `siblingsOf`, `latestLeaf` — pure | create |
| `src/session/fold.ts` | `foldTurnEvent`, `fillDangling` — pure | create |
| `src/session/history.ts` | `projectHistory` — pure | create |
| `src/session/runner.ts` | Live sessions: start/cancel turns, publish events, subscribe, snapshots | create |
| `src/session/routes.ts` | HTTP handlers for `/api/sessions/*` and the legacy `/api/run*` shims | create |
| `src/session/testing/stub-llm.ts` | Local OpenAI-compatible SSE stub for tests | create |
| `src/agent.ts` | Add `resolveRunConfig` + `runTurn`; `runAgent` becomes a wrapper | modify |
| `src/events.ts` | Optional session fields on `run.start` / `run.end` | modify |
| `src/server.ts` | Mount session routes; remove run handling | modify |
| `src/runs.ts` | Delete — superseded by the runner | delete |
| `client/src/lib/types.ts` | Mirror the optional fields (mirror rule) | modify |
| `package.json` | `test` script | modify |
| `.gitignore` | `sessions/` | modify |
| `src/session/*.test.ts`, `src/session/store/files.test.ts` | Tests | create |

---

### Task 1: Test runner and the session types

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `src/session/types.ts`

- [ ] **Step 1: Add the test script**

In `package.json`, replace the `"test"` line:

```json
"test": "node --import tsx --test 'src/**/*.test.ts'",
```

- [ ] **Step 2: Ignore the sessions data directory**

Append to `.gitignore`:

```
# Per-session data written by src/session/store/files.ts
sessions/
```

- [ ] **Step 3: Write the types**

Create `src/session/types.ts`:

```ts
// src/session/types.ts
// The conversation model. A Session owns a tree of ChatMessages and a head; a
// Turn is one execution of the agent loop over the root→head path. These are
// NOT the LLM wire types in src/types.ts — projectHistory (history.ts) maps
// from one to the other. Mirrored by hand in client/src/lib/session-types.ts.
import type { RunEvent, RunUsage } from "../events.js";

/** Per-turn overrides. A session keeps the last used set as its defaults. */
export interface TurnSettings {
  model?: string;
  agent?: string;
  temperature?: number;
  maxSteps?: number;
}

export interface Memory {
  summary: string;
  /** Id of the last message on the path that the summary replaces. */
  coversUpTo: string;
  updatedAt: string;
  editedByUser: boolean;
}

export type TextPart = { type: "text"; text: string };
export type AttachmentPart = {
  type: "attachment";
  fileId: string;
  name: string;
  mime: string;
  size: number;
};
export type ToolCallPart = {
  type: "tool_call";
  callId: string;
  tool: string;
  args: Record<string, unknown>;
};
export type ToolResultPart = {
  type: "tool_result";
  callId: string;
  tool: string;
  result: string;
  isError: boolean;
  durationMs: number;
  error?: { message: string };
};
export type Part = TextPart | AttachmentPart | ToolCallPart | ToolResultPart;

export interface ChatMessage {
  id: string;
  sessionId: string;
  /** null only for a root user message. */
  parentId: string | null;
  role: "user" | "assistant";
  parts: Part[];
  /** The turn this message belongs to (both the user and assistant message). */
  turnId?: string;
  createdAt: string;
}

export interface QueuedMessage extends TurnSettings {
  /** Becomes the ChatMessage id when the message is sent. */
  id: string;
  parts: Part[];
  /** Omitted means "head at send time". */
  parentId?: string;
  queuedAt: string;
}

export type SessionStatus = "idle" | "running";

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  /** Tip of the current branch; null for an empty session. */
  headId: string | null;
  memory?: Memory;
  queue: QueuedMessage[];
  defaults: TurnSettings;
}

export type TurnStatus = "running" | "completed" | "failed" | "cancelled";

export interface Turn extends TurnSettings {
  id: string;
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  /** Always resolved, never undefined, on a Turn. */
  model: string;
  status: TurnStatus;
  reason?: "answered" | "step-limit";
  error?: string;
  usage?: RunUsage;
  startedAt: string;
  durationMs: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  messageCount: number;
  lastModel?: string;
}

export type SessionPatch = Partial<
  Pick<Session, "title" | "headId" | "status" | "memory" | "defaults">
>;

/** Events that are about the session rather than one turn. */
export type SessionOnlyEvent =
  | { type: "message.created"; message: ChatMessage }
  | { type: "message.completed"; message: ChatMessage }
  | { type: "queue.updated"; queue: QueuedMessage[] }
  | { type: "session.updated"; patch: SessionPatch };

/**
 * Everything on a session's stream. Turn events keep their RunEvent names and
 * shapes; run.start/run.end mean turn start/end. One seq counter per session.
 */
export type SessionEvent = (RunEvent | SessionOnlyEvent) & {
  sessionId: string;
  seq: number;
  turnId?: string;
};
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore src/session/types.ts
git commit -m "feat(session): conversation types and a test runner"
```

---

### Task 2: Stub LLM test helper

A local OpenAI-compatible server the tests point `OPENROUTER_URL` at. It replies from a function of the request so a test can assert what history the harness sent.

**Files:**
- Create: `src/session/testing/stub-llm.ts`

- [ ] **Step 1: Write the helper**

```ts
// src/session/testing/stub-llm.ts
// A minimal OpenAI-compatible /chat/completions stub for tests. Replies are
// chosen by a function of the request, so a test can prove what history the
// harness actually sent. Streams SSE exactly the way src/llm.ts expects.
import { createServer } from "node:http";

import type { Message } from "../../types.js";

export interface StubRequest {
  messages: Message[];
  tools?: unknown[];
  model: string;
}

export type StubReply =
  | { text: string; delayMs?: number }
  | { toolCall: { name: string; args: Record<string, unknown> }; delayMs?: number };

export interface StubLlm {
  url: string;
  /** Every request received, in order. */
  calls: StubRequest[];
  close: () => Promise<void>;
}

export const startStubLlm = async (
  reply: (request: StubRequest, callIndex: number) => StubReply,
): Promise<StubLlm> => {
  const calls: StubRequest[] = [];

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      const request = JSON.parse(body) as StubRequest;
      calls.push(request);
      const chosen = reply(request, calls.length - 1);

      const respond = () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (payload: unknown) =>
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if ("text" in chosen) {
          // Split into small chunks so delta accumulation is exercised.
          for (const piece of chosen.text.match(/.{1,6}/gs) ?? []) {
            send({ choices: [{ delta: { content: piece } }] });
          }
        } else {
          send({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_${calls.length}`,
                      function: {
                        name: chosen.toolCall.name,
                        arguments: JSON.stringify(chosen.toolCall.args),
                      },
                    },
                  ],
                },
              },
            ],
          });
        }
        send({
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
        res.write("data: [DONE]\n\n");
        res.end();
      };

      if (chosen.delayMs) setTimeout(respond, chosen.delayMs);
      else respond();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}/chat/completions`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

/** Point src/llm.ts at the stub for the rest of the process. */
export const useStubLlm = (stub: StubLlm): void => {
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_URL = stub.url;
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/session/testing/stub-llm.ts
git commit -m "test(session): local OpenAI-compatible stub for harness tests"
```

---

### Task 3: Tree helpers

**Files:**
- Create: `src/session/tree.test.ts`
- Create: `src/session/tree.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/session/tree.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { latestLeaf, pathToHead, siblingsOf } from "./tree.js";
import type { ChatMessage } from "./types.js";

const msg = (
  id: string,
  parentId: string | null,
  createdAt: string,
  role: "user" | "assistant" = "user",
): ChatMessage => ({
  id,
  sessionId: "s",
  parentId,
  role,
  parts: [{ type: "text", text: id }],
  createdAt,
});

//   u1 ─ a1 ─ u2 ─ a2
//             └─ u2b ─ a2b        (u2b is an edited sibling of u2)
const tree: ChatMessage[] = [
  msg("u1", null, "2026-01-01T00:00:01Z"),
  msg("a1", "u1", "2026-01-01T00:00:02Z", "assistant"),
  msg("u2", "a1", "2026-01-01T00:00:03Z"),
  msg("a2", "u2", "2026-01-01T00:00:04Z", "assistant"),
  msg("u2b", "a1", "2026-01-01T00:00:05Z"),
  msg("a2b", "u2b", "2026-01-01T00:00:06Z", "assistant"),
];

describe("pathToHead", () => {
  it("walks parent pointers from head to root, returned root first", () => {
    assert.deepEqual(
      pathToHead(tree, "a2b").map((m) => m.id),
      ["u1", "a1", "u2b", "a2b"],
    );
  });
  it("returns [] for a null head", () => {
    assert.deepEqual(pathToHead(tree, null), []);
  });
  it("returns [] for an unknown head", () => {
    assert.deepEqual(pathToHead(tree, "nope"), []);
  });
});

describe("siblingsOf", () => {
  it("orders siblings by createdAt and reports the index", () => {
    assert.deepEqual(siblingsOf(tree, "u2b"), { index: 1, total: 2, ids: ["u2", "u2b"] });
    assert.deepEqual(siblingsOf(tree, "u2"), { index: 0, total: 2, ids: ["u2", "u2b"] });
  });
  it("treats roots as siblings of each other", () => {
    const withTwoRoots = [...tree, msg("u0", null, "2026-01-01T00:00:00Z")];
    assert.deepEqual(siblingsOf(withTwoRoots, "u1"), { index: 1, total: 2, ids: ["u0", "u1"] });
  });
  it("is a singleton for a message with no siblings", () => {
    assert.deepEqual(siblingsOf(tree, "a1"), { index: 0, total: 1, ids: ["a1"] });
  });
});

describe("latestLeaf", () => {
  it("follows the newest child until a message has none", () => {
    assert.equal(latestLeaf(tree, "a1"), "a2b");
    assert.equal(latestLeaf(tree, "u2"), "a2");
  });
  it("returns the message itself when it is a leaf", () => {
    assert.equal(latestLeaf(tree, "a2"), "a2");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/session/tree.test.ts`
Expected: FAIL — `Cannot find module './tree.js'`.

- [ ] **Step 3: Implement**

```ts
// src/session/tree.ts
// Pure helpers over the message tree. Mirrored in client/src/lib/tree.ts.
import type { ChatMessage } from "./types.js";

const byCreated = (a: ChatMessage, b: ChatMessage): number =>
  a.createdAt.localeCompare(b.createdAt);

/** Root → head. Empty when head is null or unknown. */
export const pathToHead = (
  messages: readonly ChatMessage[],
  headId: string | null,
): ChatMessage[] => {
  if (!headId) return [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  const path: ChatMessage[] = [];
  let current = byId.get(headId);
  while (current) {
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
};

/** Messages sharing this one's parent (roots share `null`), oldest first. */
export const siblingsOf = (
  messages: readonly ChatMessage[],
  id: string,
): { index: number; total: number; ids: string[] } => {
  const self = messages.find((m) => m.id === id);
  if (!self) return { index: 0, total: 0, ids: [] };
  const ids = messages
    .filter((m) => m.parentId === self.parentId)
    .sort(byCreated)
    .map((m) => m.id);
  return { index: ids.indexOf(id), total: ids.length, ids };
};

/** From `id`, step to the newest child repeatedly; the leaf reached. */
export const latestLeaf = (messages: readonly ChatMessage[], id: string): string => {
  let current = id;
  for (;;) {
    const children = messages.filter((m) => m.parentId === current).sort(byCreated);
    if (children.length === 0) return current;
    current = children[children.length - 1].id;
  }
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/session/tree.test.ts`
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/session/tree.ts src/session/tree.test.ts
git commit -m "feat(session): tree helpers — path, siblings, latest leaf"
```

---

### Task 4: Fold — turn events into assistant parts

**Files:**
- Create: `src/session/fold.test.ts`
- Create: `src/session/fold.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/session/fold.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fillDangling, foldTurnEvent } from "./fold.js";
import type { ChatMessage } from "./types.js";

const shell = (): ChatMessage => ({
  id: "a",
  sessionId: "s",
  parentId: "u",
  role: "assistant",
  parts: [],
  turnId: "t",
  createdAt: "2026-01-01T00:00:00Z",
});

describe("foldTurnEvent", () => {
  it("accumulates deltas into one text part", () => {
    let m = shell();
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Hel" });
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "lo" });
    assert.deepEqual(m.parts, [{ type: "text", text: "Hello" }]);
  });

  it("lets the final assistant event replace the accumulated text", () => {
    let m = shell();
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Hel" });
    m = foldTurnEvent(m, { type: "assistant", step: 1, text: "Hello, world" });
    assert.deepEqual(m.parts, [{ type: "text", text: "Hello, world" }]);
  });

  it("starts a new text part after a tool result", () => {
    let m = shell();
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Checking" });
    m = foldTurnEvent(m, {
      type: "tool.call", step: 1, callId: "c1", tool: "get_current_time", args: {},
    });
    m = foldTurnEvent(m, {
      type: "tool.result", step: 1, callId: "c1", tool: "get_current_time",
      result: "10:00", durationMs: 3, isError: false,
    });
    m = foldTurnEvent(m, { type: "assistant.delta", step: 2, text: "It is 10:00" });
    assert.deepEqual(
      m.parts.map((p) => p.type),
      ["text", "tool_call", "tool_result", "text"],
    );
    assert.deepEqual(m.parts[3], { type: "text", text: "It is 10:00" });
  });

  it("carries the tool error object through", () => {
    const m = foldTurnEvent(shell(), {
      type: "tool.result", step: 1, callId: "c1", tool: "shell", result: "Error: denied",
      durationMs: 0, isError: true, error: { message: "denied" },
    });
    assert.deepEqual(m.parts[0], {
      type: "tool_result", callId: "c1", tool: "shell", result: "Error: denied",
      isError: true, durationMs: 0, error: { message: "denied" },
    });
  });

  it("ignores events that are not about the message", () => {
    const m = shell();
    assert.equal(foldTurnEvent(m, { type: "step.start", step: 1 }), m);
    assert.equal(
      foldTurnEvent(m, { type: "queue.updated", queue: [] }),
      m,
    );
  });

  it("never mutates its input", () => {
    const m = shell();
    foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "x" });
    assert.deepEqual(m.parts, []);
  });
});

describe("fillDangling", () => {
  it("adds a cancelled result for every unanswered tool call", () => {
    const m: ChatMessage = {
      ...shell(),
      parts: [
        { type: "tool_call", callId: "c1", tool: "shell", args: { command: "ls" } },
        { type: "tool_call", callId: "c2", tool: "read_file", args: { path: "x" } },
        { type: "tool_result", callId: "c1", tool: "shell", result: "ok", isError: false, durationMs: 1 },
      ],
    };
    const filled = fillDangling(m);
    assert.equal(filled.parts.length, 4);
    assert.deepEqual(filled.parts[3], {
      type: "tool_result", callId: "c2", tool: "read_file", result: "Error: cancelled",
      isError: true, durationMs: 0, error: { message: "cancelled" },
    });
  });
  it("returns the same message when nothing dangles", () => {
    const m = shell();
    assert.equal(fillDangling(m), m);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/session/fold.test.ts`
Expected: FAIL — `Cannot find module './fold.js'`.

- [ ] **Step 3: Implement**

```ts
// src/session/fold.ts
// Turn events → the assistant message's ordered parts. One pure function used
// by the server (to persist the message and to serve a live partial) and by
// the client (to render a live turn). Mirrored in client/src/lib/fold.ts.
import type { RunEvent } from "../events.js";
import type { ChatMessage, Part, SessionOnlyEvent, ToolCallPart } from "./types.js";

const lastTextIndex = (parts: readonly Part[]): number => {
  const last = parts[parts.length - 1];
  return last?.type === "text" ? parts.length - 1 : -1;
};

export const foldTurnEvent = (
  assistant: ChatMessage,
  event: RunEvent | SessionOnlyEvent,
): ChatMessage => {
  switch (event.type) {
    case "assistant.delta": {
      const at = lastTextIndex(assistant.parts);
      if (at === -1) {
        return { ...assistant, parts: [...assistant.parts, { type: "text", text: event.text }] };
      }
      const parts = assistant.parts.slice();
      const current = parts[at] as { type: "text"; text: string };
      parts[at] = { type: "text", text: current.text + event.text };
      return { ...assistant, parts };
    }
    case "assistant": {
      // The final text for this step wins over whatever the deltas built, so a
      // dropped chunk cannot leave a permanent gap.
      const at = lastTextIndex(assistant.parts);
      const parts = at === -1 ? [...assistant.parts] : assistant.parts.slice(0, at);
      return { ...assistant, parts: [...parts, { type: "text", text: event.text }] };
    }
    case "tool.call":
      return {
        ...assistant,
        parts: [
          ...assistant.parts,
          { type: "tool_call", callId: event.callId, tool: event.tool, args: event.args },
        ],
      };
    case "tool.result":
      return {
        ...assistant,
        parts: [
          ...assistant.parts,
          {
            type: "tool_result",
            callId: event.callId,
            tool: event.tool,
            result: event.result,
            isError: event.isError,
            durationMs: event.durationMs,
            ...(event.error ? { error: event.error } : {}),
          },
        ],
      };
    default:
      return assistant;
  }
};

/**
 * A cancelled turn can leave a tool_call with no tool_result. The projection
 * must never send the model a dangling call, so give each one a result.
 */
export const fillDangling = (assistant: ChatMessage): ChatMessage => {
  const answered = new Set(
    assistant.parts.filter((p) => p.type === "tool_result").map((p) => p.callId),
  );
  const missing = assistant.parts.filter(
    (p): p is ToolCallPart => p.type === "tool_call" && !answered.has(p.callId),
  );
  if (missing.length === 0) return assistant;
  return {
    ...assistant,
    parts: [
      ...assistant.parts,
      ...missing.map((call): Part => ({
        type: "tool_result",
        callId: call.callId,
        tool: call.tool,
        result: "Error: cancelled",
        isError: true,
        durationMs: 0,
        error: { message: "cancelled" },
      })),
    ],
  };
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/session/fold.test.ts`
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/session/fold.ts src/session/fold.test.ts
git commit -m "feat(session): fold turn events into assistant parts"
```

---

### Task 5: History projection — tree to LLM messages

**Files:**
- Create: `src/session/history.test.ts`
- Create: `src/session/history.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/session/history.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectHistory, renderAttachment } from "./history.js";
import type { ChatMessage, Session } from "./types.js";

const session = (over: Partial<Session> = {}): Session => ({
  id: "s",
  title: "t",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "idle",
  headId: "u2",
  queue: [],
  defaults: {},
  ...over,
});

const messages: ChatMessage[] = [
  {
    id: "u1", sessionId: "s", parentId: null, role: "user", createdAt: "2026-01-01T00:00:01Z",
    parts: [{ type: "text", text: "What time is it?" }],
  },
  {
    id: "a1", sessionId: "s", parentId: "u1", role: "assistant", createdAt: "2026-01-01T00:00:02Z",
    parts: [
      { type: "text", text: "Let me check." },
      { type: "tool_call", callId: "c1", tool: "get_current_time", args: {} },
      { type: "tool_result", callId: "c1", tool: "get_current_time", result: "10:00", isError: false, durationMs: 2 },
      { type: "text", text: "It is 10:00." },
    ],
  },
  {
    id: "u2", sessionId: "s", parentId: "a1", role: "user", createdAt: "2026-01-01T00:00:03Z",
    parts: [{ type: "text", text: "And in Seoul?" }],
  },
  // a branch not on the path — must be ignored
  {
    id: "u2b", sessionId: "s", parentId: "a1", role: "user", createdAt: "2026-01-01T00:00:04Z",
    parts: [{ type: "text", text: "ignored branch" }],
  },
];

describe("projectHistory", () => {
  it("starts with the system prompt and ends with the head user message", () => {
    const out = projectHistory({ session: session(), messages, systemPrompt: "SYS", attachments: new Map() });
    assert.deepEqual(out[0], { role: "system", content: "SYS" });
    assert.deepEqual(out[out.length - 1], { role: "user", content: "And in Seoul?" });
  });

  it("unfolds assistant parts into assistant/tool wire messages in order", () => {
    const out = projectHistory({ session: session(), messages, systemPrompt: "SYS", attachments: new Map() });
    assert.deepEqual(out.slice(1, 6), [
      { role: "user", content: "What time is it?" },
      { role: "assistant", content: "Let me check." },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "get_current_time", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", name: "get_current_time", content: "10:00" },
      { role: "assistant", content: "It is 10:00." },
    ]);
  });

  it("does not include messages off the current branch", () => {
    const out = projectHistory({ session: session(), messages, systemPrompt: "SYS", attachments: new Map() });
    assert.ok(!JSON.stringify(out).includes("ignored branch"));
  });

  it("replaces covered messages with the memory summary", () => {
    const out = projectHistory({
      session: session({
        memory: { summary: "User asked the time; it was 10:00.", coversUpTo: "a1", updatedAt: "x", editedByUser: false },
      }),
      messages, systemPrompt: "SYS", attachments: new Map(),
    });
    assert.deepEqual(out, [
      { role: "system", content: "SYS" },
      { role: "user", content: "[Memory of earlier conversation]\nUser asked the time; it was 10:00." },
      { role: "assistant", content: "Understood." },
      { role: "user", content: "And in Seoul?" },
    ]);
  });

  it("ignores memory whose coversUpTo is not on the current path", () => {
    const out = projectHistory({
      session: session({
        memory: { summary: "other branch", coversUpTo: "u2b", updatedAt: "x", editedByUser: false },
      }),
      messages, systemPrompt: "SYS", attachments: new Map(),
    });
    assert.ok(!JSON.stringify(out).includes("other branch"));
    assert.equal(out.length, 7);
  });

  it("renders attachments after the text", () => {
    const withFile: ChatMessage[] = [
      {
        id: "u1", sessionId: "s", parentId: null, role: "user", createdAt: "2026-01-01T00:00:01Z",
        parts: [
          { type: "text", text: "Review this" },
          { type: "attachment", fileId: "f1", name: "a.ts", mime: "application/typescript", size: 12 },
          { type: "attachment", fileId: "f2", name: "logo.png", mime: "image/png", size: 5000 },
        ],
      },
    ];
    const out = projectHistory({
      session: session({ headId: "u1" }), messages: withFile, systemPrompt: "SYS",
      attachments: new Map([["f1", "const x = 1"]]),
    });
    assert.equal(
      out[1].content,
      "Review this\n\n--- a.ts ---\nconst x = 1\n--- end a.ts ---" +
        "\n\n[attached file: logo.png, image/png, 5000 bytes — binary, not shown]",
    );
  });
});

describe("renderAttachment", () => {
  it("truncates inline text at the cap with a marker", () => {
    const part = { type: "attachment" as const, fileId: "f", name: "big.txt", mime: "text/plain", size: 100 };
    const out = renderAttachment(part, "x".repeat(50), 10);
    assert.equal(out, "\n\n--- big.txt ---\nxxxxxxxxxx\n[truncated: 10 of 50 characters]\n--- end big.txt ---");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/session/history.test.ts`
Expected: FAIL — `Cannot find module './history.js'`.

- [ ] **Step 3: Implement**

```ts
// src/session/history.ts
// Project the root→head path of a session into the OpenAI-shaped Message[] the
// agent loop already consumes. Pure: attachment contents are passed in already
// read, so this needs no store and is trivially testable.
import type { Message } from "../types.js";
import { pathToHead } from "./tree.js";
import type { AttachmentPart, ChatMessage, Part, Session } from "./types.js";

export const DEFAULT_MAX_INLINE_CHARS = 20_000;

const TEXT_LIKE_MIME = /^(text\/|application\/(json|xml|javascript|typescript))/;
const TEXT_LIKE_EXT =
  /\.(md|txt|json|ya?ml|toml|csv|tsx?|[mc]?jsx?|py|go|rs|java|kt|c|h|cpp|cs|rb|php|sh|sql|html|css|xml|env\.example)$/i;

export const isTextLike = (part: AttachmentPart): boolean =>
  TEXT_LIKE_MIME.test(part.mime) || TEXT_LIKE_EXT.test(part.name);

/**
 * How one attachment appears in the prompt. `content` is the file's text when
 * it is text-like and was read; null renders the binary marker instead.
 */
export const renderAttachment = (
  part: AttachmentPart,
  content: string | null,
  maxInlineChars = DEFAULT_MAX_INLINE_CHARS,
): string => {
  if (content === null || !isTextLike(part)) {
    return `\n\n[attached file: ${part.name}, ${part.mime}, ${part.size} bytes — binary, not shown]`;
  }
  const clipped = content.length > maxInlineChars;
  const body = clipped
    ? `${content.slice(0, maxInlineChars)}\n[truncated: ${maxInlineChars} of ${content.length} characters]`
    : content;
  return `\n\n--- ${part.name} ---\n${body}\n--- end ${part.name} ---`;
};

const userContent = (
  parts: readonly Part[],
  attachments: ReadonlyMap<string, string>,
  maxInlineChars: number,
): string => {
  const text = parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  const files = parts
    .filter((p): p is AttachmentPart => p.type === "attachment")
    .map((p) => renderAttachment(p, attachments.get(p.fileId) ?? null, maxInlineChars))
    .join("");
  return text + files;
};

/** Assistant parts → wire messages: text runs, tool_calls batches, tool results. */
const assistantMessages = (parts: readonly Part[]): Message[] => {
  const out: Message[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part.type === "text") {
      out.push({ role: "assistant", content: part.text });
      i++;
    } else if (part.type === "tool_call") {
      const batch: Message["tool_calls"] = [];
      while (i < parts.length && parts[i].type === "tool_call") {
        const call = parts[i] as Extract<Part, { type: "tool_call" }>;
        batch.push({
          id: call.callId,
          type: "function",
          function: { name: call.tool, arguments: JSON.stringify(call.args) },
        });
        i++;
      }
      out.push({ role: "assistant", content: null, tool_calls: batch });
    } else if (part.type === "tool_result") {
      out.push({
        role: "tool",
        tool_call_id: part.callId,
        name: part.tool,
        content: part.result,
      });
      i++;
    } else {
      i++; // attachments never appear on assistant messages
    }
  }
  return out;
};

export interface ProjectInput {
  session: Session;
  messages: readonly ChatMessage[];
  systemPrompt: string;
  /** fileId → text, for attachments already read by the caller. */
  attachments: ReadonlyMap<string, string>;
  maxInlineChars?: number;
}

export const projectHistory = ({
  session,
  messages,
  systemPrompt,
  attachments,
  maxInlineChars = DEFAULT_MAX_INLINE_CHARS,
}: ProjectInput): Message[] => {
  const path = pathToHead(messages, session.headId);
  const out: Message[] = [{ role: "system", content: systemPrompt }];

  // Memory only applies when what it summarised is actually on this branch.
  let start = 0;
  const memory = session.memory;
  if (memory) {
    const covered = path.findIndex((m) => m.id === memory.coversUpTo);
    if (covered !== -1) {
      out.push(
        { role: "user", content: `[Memory of earlier conversation]\n${memory.summary}` },
        { role: "assistant", content: "Understood." },
      );
      start = covered + 1;
    }
  }

  for (const message of path.slice(start)) {
    if (message.role === "user") {
      out.push({ role: "user", content: userContent(message.parts, attachments, maxInlineChars) });
    } else {
      out.push(...assistantMessages(message.parts));
    }
  }
  return out;
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/session/history.test.ts`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/session/history.ts src/session/history.test.ts
git commit -m "feat(session): project the current branch into LLM messages"
```

---

### Task 6: The store interface and the file implementation

**Files:**
- Create: `src/session/store.ts`
- Create: `src/session/store/files.test.ts`
- Create: `src/session/store/files.ts`

- [ ] **Step 1: Write the interface**

```ts
// src/session/store.ts
// The only way session data reaches disk (or, later, Postgres). Session logic
// depends on this interface and nothing else; the file implementation is the
// default and a database implementation may be added behind DULO_DATABASE_URL.
import type {
  ChatMessage,
  Session,
  SessionEvent,
  SessionSummary,
  Turn,
  TurnSettings,
} from "./types.js";

export interface StoredFile {
  fileId: string;
  name: string;
  mime: string;
  size: number;
}

export interface SessionStore {
  createSession(input: { title: string; defaults?: TurnSettings }): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  /** Newest first. */
  listSessions(): Promise<SessionSummary[]>;
  updateSession(
    id: string,
    patch: Partial<Pick<Session, "title" | "headId" | "status" | "memory" | "queue" | "defaults">>,
  ): Promise<Session>;
  deleteSession(id: string): Promise<void>;

  appendMessage(message: ChatMessage): Promise<void>;
  /** The whole tree, in creation order. */
  getMessages(sessionId: string): Promise<ChatMessage[]>;

  /** Written once, when the turn ends. */
  appendTurn(turn: Turn): Promise<void>;
  getTurns(sessionId: string): Promise<Turn[]>;

  appendEvent(sessionId: string, event: SessionEvent): Promise<void>;
  readEvents(sessionId: string, after: number): Promise<SessionEvent[]>;

  putFile(
    sessionId: string,
    file: { name: string; mime: string; bytes: Buffer },
  ): Promise<StoredFile>;
  getFile(
    sessionId: string,
    fileId: string,
  ): Promise<{ name: string; mime: string; bytes: Buffer } | null>;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/session/store/files.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { FileSessionStore } from "./files.js";
import type { ChatMessage, SessionEvent, Turn } from "../types.js";

let dir: string;
let store: FileSessionStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dulo-store-"));
  store = new FileSessionStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const message = (sessionId: string, id: string, parentId: string | null): ChatMessage => ({
  id, sessionId, parentId, role: "user", parts: [{ type: "text", text: id }],
  createdAt: new Date().toISOString(),
});

describe("FileSessionStore", () => {
  it("creates, reads, lists and updates a session", async () => {
    const s = await store.createSession({ title: "First", defaults: { model: "m" } });
    assert.equal(s.status, "idle");
    assert.equal(s.headId, null);
    assert.deepEqual(s.queue, []);

    const again = await store.getSession(s.id);
    assert.deepEqual(again, s);

    const updated = await store.updateSession(s.id, { title: "Renamed", headId: "x" });
    assert.equal(updated.title, "Renamed");
    assert.equal(updated.headId, "x");
    assert.ok(updated.updatedAt >= s.updatedAt);

    const list = await store.listSessions();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Renamed");
    assert.equal(list[0].messageCount, 0);
  });

  it("lists newest first", async () => {
    const a = await store.createSession({ title: "a" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.createSession({ title: "b" });
    const list = await store.listSessions();
    assert.deepEqual(list.map((s) => s.id), [b.id, a.id]);
  });

  it("returns null for an unknown session", async () => {
    assert.equal(await store.getSession("nope"), null);
  });

  it("appends and reads messages in order, and counts them", async () => {
    const s = await store.createSession({ title: "t" });
    await store.appendMessage(message(s.id, "u1", null));
    await store.appendMessage(message(s.id, "a1", "u1"));
    const got = await store.getMessages(s.id);
    assert.deepEqual(got.map((m) => m.id), ["u1", "a1"]);
    assert.equal((await store.listSessions())[0].messageCount, 2);
  });

  it("appends and reads turns, recording the last model", async () => {
    const s = await store.createSession({ title: "t" });
    const turn: Turn = {
      id: "t1", sessionId: s.id, userMessageId: "u1", assistantMessageId: "a1", model: "gpt-x",
      status: "completed", startedAt: new Date().toISOString(), durationMs: 10,
    };
    await store.appendTurn(turn);
    assert.deepEqual(await store.getTurns(s.id), [turn]);
    assert.equal((await store.listSessions())[0].lastModel, "gpt-x");
  });

  it("appends events and reads them after a seq", async () => {
    const s = await store.createSession({ title: "t" });
    const ev = (seq: number): SessionEvent => ({ type: "step.start", step: seq, sessionId: s.id, seq });
    await Promise.all([store.appendEvent(s.id, ev(1)), store.appendEvent(s.id, ev(2)), store.appendEvent(s.id, ev(3))]);
    assert.deepEqual((await store.readEvents(s.id, 1)).map((e) => e.seq), [2, 3]);
    assert.deepEqual(await store.readEvents(s.id, 3), []);
  });

  it("stores and returns files", async () => {
    const s = await store.createSession({ title: "t" });
    const put = await store.putFile(s.id, { name: "a.txt", mime: "text/plain", bytes: Buffer.from("hello") });
    assert.equal(put.size, 5);
    const got = await store.getFile(s.id, put.fileId);
    assert.equal(got?.name, "a.txt");
    assert.equal(got?.bytes.toString("utf8"), "hello");
    assert.equal(await store.getFile(s.id, "missing"), null);
  });

  it("deletes a session and everything under it", async () => {
    const s = await store.createSession({ title: "t" });
    await store.appendMessage(message(s.id, "u1", null));
    await store.deleteSession(s.id);
    assert.equal(await store.getSession(s.id), null);
    assert.deepEqual(await store.getMessages(s.id), []);
    assert.deepEqual(await store.listSessions(), []);
  });

  it("survives a fresh instance reading the same directory", async () => {
    const s = await store.createSession({ title: "persist" });
    await store.appendMessage(message(s.id, "u1", null));
    const reopened = new FileSessionStore(dir);
    assert.equal((await reopened.getSession(s.id))?.title, "persist");
    assert.equal((await reopened.listSessions())[0].messageCount, 1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/session/store/files.test.ts`
Expected: FAIL — `Cannot find module './files.js'`.

- [ ] **Step 4: Implement**

```ts
// src/session/store/files.ts
// JSON Lines under sessions/. Append-only logs for messages, turns and events;
// session.json and index.json are rewritten on change. Writes for one session
// are serialised through a promise chain so two lines cannot interleave, the
// same way src/runs.ts did.
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SessionStore, StoredFile } from "../store.js";
import type {
  ChatMessage,
  Session,
  SessionEvent,
  SessionSummary,
  Turn,
  TurnSettings,
} from "../types.js";

const MAX_INDEXED = 500;

const readJsonLines = async <T>(file: string): Promise<T[]> => {
  try {
    const raw = await readFile(file, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
};

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
};

export class FileSessionStore implements SessionStore {
  private readonly chains = new Map<string, Promise<void>>();
  private indexChain: Promise<void> = Promise.resolve();

  constructor(private readonly root = path.join(process.cwd(), "sessions")) {}

  private dir(id: string): string {
    return path.join(this.root, id);
  }
  private file(id: string, name: string): string {
    return path.join(this.dir(id), name);
  }

  /** Run `fn` after every earlier write to this session has finished. */
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(id, next.then(() => undefined, () => undefined));
    return next;
  }

  private async readIndex(): Promise<SessionSummary[]> {
    return (await readJson<SessionSummary[]>(path.join(this.root, "index.json"))) ?? [];
  }

  private updateIndex(
    id: string,
    change: (entry: SessionSummary | undefined) => SessionSummary | null,
  ): Promise<void> {
    this.indexChain = this.indexChain
      .then(async () => {
        const existing = await this.readIndex();
        const current = existing.find((s) => s.id === id);
        const next = change(current);
        const rest = existing.filter((s) => s.id !== id);
        const merged = (next ? [next, ...rest] : rest)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, MAX_INDEXED);
        await mkdir(this.root, { recursive: true });
        await writeFile(path.join(this.root, "index.json"), JSON.stringify(merged, null, 2), "utf8");
      })
      .catch(() => {
        // The index is a listing convenience; never fail a write over it.
      });
    return this.indexChain;
  }

  private async writeSession(session: Session): Promise<void> {
    await mkdir(this.dir(session.id), { recursive: true });
    await writeFile(this.file(session.id, "session.json"), JSON.stringify(session, null, 2), "utf8");
  }

  async createSession(input: { title: string; defaults?: TurnSettings }): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      title: input.title,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      headId: null,
      queue: [],
      defaults: input.defaults ?? {},
    };
    await this.serial(session.id, () => this.writeSession(session));
    await this.updateIndex(session.id, () => ({
      id: session.id,
      title: session.title,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      messageCount: 0,
    }));
    return session;
  }

  getSession(id: string): Promise<Session | null> {
    return readJson<Session>(this.file(id, "session.json"));
  }

  async listSessions(): Promise<SessionSummary[]> {
    return (await this.readIndex()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateSession(
    id: string,
    patch: Partial<Pick<Session, "title" | "headId" | "status" | "memory" | "queue" | "defaults">>,
  ): Promise<Session> {
    const updated = await this.serial(id, async () => {
      const current = await this.getSession(id);
      if (!current) throw new Error(`no session ${id}`);
      const next: Session = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await this.writeSession(next);
      return next;
    });
    await this.updateIndex(id, (entry) => ({
      id,
      title: updated.title,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      status: updated.status,
      messageCount: entry?.messageCount ?? 0,
      ...(entry?.lastModel ? { lastModel: entry.lastModel } : {}),
    }));
    return updated;
  }

  async deleteSession(id: string): Promise<void> {
    await this.serial(id, () => rm(this.dir(id), { recursive: true, force: true }));
    await this.updateIndex(id, () => null);
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    await this.serial(message.sessionId, () =>
      appendFile(this.file(message.sessionId, "messages.jsonl"), `${JSON.stringify(message)}\n`, "utf8"),
    );
    await this.updateIndex(message.sessionId, (entry) =>
      entry ? { ...entry, messageCount: entry.messageCount + 1, updatedAt: message.createdAt } : entry ?? null,
    );
  }

  getMessages(sessionId: string): Promise<ChatMessage[]> {
    return readJsonLines<ChatMessage>(this.file(sessionId, "messages.jsonl"));
  }

  async appendTurn(turn: Turn): Promise<void> {
    await this.serial(turn.sessionId, () =>
      appendFile(this.file(turn.sessionId, "turns.jsonl"), `${JSON.stringify(turn)}\n`, "utf8"),
    );
    await this.updateIndex(turn.sessionId, (entry) =>
      entry ? { ...entry, lastModel: turn.model } : entry ?? null,
    );
  }

  getTurns(sessionId: string): Promise<Turn[]> {
    return readJsonLines<Turn>(this.file(sessionId, "turns.jsonl"));
  }

  appendEvent(sessionId: string, event: SessionEvent): Promise<void> {
    return this.serial(sessionId, () =>
      appendFile(this.file(sessionId, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8"),
    );
  }

  async readEvents(sessionId: string, after: number): Promise<SessionEvent[]> {
    const all = await readJsonLines<SessionEvent>(this.file(sessionId, "events.jsonl"));
    return all.filter((e) => e.seq > after);
  }

  async putFile(
    sessionId: string,
    file: { name: string; mime: string; bytes: Buffer },
  ): Promise<StoredFile> {
    const fileId = randomUUID();
    const meta: StoredFile & { uploadedAt: string } = {
      fileId,
      name: file.name,
      mime: file.mime,
      size: file.bytes.length,
      uploadedAt: new Date().toISOString(),
    };
    await this.serial(sessionId, async () => {
      const dir = this.file(sessionId, "files");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, fileId), file.bytes);
      await writeFile(path.join(dir, `${fileId}.json`), JSON.stringify(meta), "utf8");
    });
    const { uploadedAt: _ignored, ...stored } = meta;
    return stored;
  }

  async getFile(
    sessionId: string,
    fileId: string,
  ): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
    if (!/^[\w-]{1,64}$/.test(fileId)) return null; // never let an id walk the tree
    const dir = this.file(sessionId, "files");
    const meta = await readJson<StoredFile>(path.join(dir, `${fileId}.json`));
    if (!meta) return null;
    try {
      const bytes = await readFile(path.join(dir, fileId));
      return { name: meta.name, mime: meta.mime, bytes };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- src/session/store/files.test.ts`
Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/session/store.ts src/session/store/files.ts src/session/store/files.test.ts
git commit -m "feat(session): SessionStore interface and JSON Lines implementation"
```

---

### Task 7: `runTurn` — the loop over a given history

Today `runAgent` builds `[system, user]` itself and resolves the agent profile inline. Split that so a session can hand the loop a projected history.

**Files:**
- Modify: `src/agent.ts`
- Modify: `src/events.ts`
- Modify: `client/src/lib/types.ts`

- [ ] **Step 1: Add the optional session fields to the events**

In `src/events.ts`, change the `run.start` and `run.end` variants of `RunEvent`:

```ts
  | {
      type: "run.start";
      runId: string;
      query: string;
      model: string;
      startedAt: string;
      /** Set when the run is a turn inside a session. runId === turnId. */
      sessionId?: string;
      turnId?: string;
      userMessageId?: string;
      assistantMessageId?: string;
    }
```

and

```ts
  | {
      type: "run.end";
      status: RunStatus;
      finalAnswer?: string;
      error?: string;
      reason?: RunEndReason;
      usage?: RunUsage;
      durationMs: number;
      steps: number;
      sessionId?: string;
      turnId?: string;
    };
```

Mirror the same optional fields in `client/src/lib/types.ts` on its `run.start` and `run.end` variants (the mirror rule in `CLAUDE.md`).

- [ ] **Step 2: Add `resolveRunConfig` and `runTurn` to `src/agent.ts`**

Replace the block inside `runAgent` that begins `const registry = getRegistry();` and ends with `const systemPrompt = ...` — plus the `messages` construction and the function signature — with the following. The step loop that follows (`for (let step = 1; ...)`) and everything after it stay exactly as they are, but now live inside `runTurn`.

First, add the import of `MODEL`:

```ts
import { callLLM, MODEL } from "./llm.js";
```

Then add, above `runAgent`:

```ts
/** Everything a turn needs decided before the loop starts. */
export interface RunConfig {
  model: string;
  agent?: string;
  temperature?: number;
  maxSteps: number;
  tools: Tool[];
  systemPrompt: string;
}

/**
 * Explicit options win over the agent profile, which wins over the defaults.
 * Throws for an unknown agent name so callers can turn it into a 400.
 */
export const resolveRunConfig = (
  options: Pick<RunOptions, "tools" | "agent" | "model" | "temperature" | "maxSteps">,
): RunConfig => {
  const registry = getRegistry();
  const profile = options.agent ? getAgent(options.agent) : undefined;
  if (options.agent && !profile) {
    throw new Error(
      `No agent named "${options.agent}". Available: ${
        registry.agents.map((a) => a.name).join(", ") || "(none)"
      }`,
    );
  }
  return {
    model: options.model ?? profile?.model ?? MODEL,
    agent: profile?.name,
    temperature: options.temperature ?? profile?.temperature,
    maxSteps: options.maxSteps ?? profile?.maxSteps ?? DEFAULT_MAX_STEPS,
    tools: applyToolPolicy(options.tools ?? registry.tools, profile?.tools),
    // A profile's body replaces the prompt entirely; the skills catalogue is
    // appended either way so load_skill is discoverable.
    systemPrompt: (profile?.prompt ?? SYSTEM_PROMPT) + registry.skillsPrompt,
  };
};

/**
 * Run the agent loop over an already-built history. `history[0]` must be the
 * system message; the last entry is the message the model should respond to.
 * This is the primitive; runAgent below is the one-shot convenience.
 */
export async function runTurn(
  history: Message[],
  options: RunOptions = {},
): Promise<RunResult> {
  const config = resolveRunConfig(options);
  const { model, temperature, maxSteps, tools } = config;
  const { onEvent = () => {}, signal, requestPermission } = options;

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const usage: RunUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const addUsage = (u?: RunUsage) => {
    if (!u) return;
    usage.promptTokens += u.promptTokens;
    usage.completionTokens += u.completionTokens;
    usage.totalTokens += u.totalTokens;
  };
  const seen = () => (usage.totalTokens > 0 ? usage : undefined);

  const messages: Message[] = [...history];

  // ---- the existing step loop continues here, unchanged ----
```

Then change the old `runAgent` into the wrapper:

```ts
/** One-shot: a fresh conversation with a single user message. Used by the CLI. */
export async function runAgent(
  userQuery: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const config = resolveRunConfig(options);
  return runTurn(
    [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: userQuery },
    ],
    { ...options, agent: undefined, tools: config.tools, model: config.model,
      temperature: config.temperature, maxSteps: config.maxSteps },
  );
}
```

Delete the now-unused `let` bindings the old body had for `model`, `temperature`, `maxSteps`, `tools`, `systemPrompt`, `profile` and `registry` — `runTurn` gets them from `config`. `DEFAULT_MAX_STEPS`, `SYSTEM_PROMPT`, `WRAP_UP_PROMPT`, the condense guard, `executeTool` and the loop body do not change.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. If it reports an unused variable or a missing name, the split in Step 2 left something behind — the loop must only reference `model`, `temperature`, `maxSteps`, `tools`, `onEvent`, `signal`, `requestPermission`, `messages`, `usage`/`addUsage`/`seen`, `elapsed`.

- [ ] **Step 4: Prove the CLI still works against the stub**

Create `tmp-stub.cjs` (not committed) with the same shape as the stub in Task 2 but as plain Node: reply `{"choices":[{"delta":{"content":"pong"}}]}` then `[DONE]`. Then:

```bash
node tmp-stub.cjs &  # prints its port; assume 4590 below
OPENROUTER_API_KEY=test OPENROUTER_URL=http://127.0.0.1:4590/x npx tsx src/index.ts "ping" < /dev/null
kill %1; rm tmp-stub.cjs
```

Expected output ends with `pong` and a tokens line. (`< /dev/null` makes stdin non-TTY so no permission prompt can block.)

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all prior tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/agent.ts src/events.ts client/src/lib/types.ts
git commit -m "refactor(agent): split runTurn from runAgent, add session fields to run events"
```

---

### Task 8: The session runner

Replaces `src/runs.ts`. Owns live sessions, starts and cancels turns, publishes seq-numbered events, serves subscribers and snapshots.

**Files:**
- Create: `src/session/runner.test.ts`
- Create: `src/session/runner.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/session/runner.test.ts
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

  it("refuses a second turn while one is running", async () => {
    const slow = await startStubLlm(() => ({ text: "slow", delayMs: 300 }));
    useStubLlm(slow);
    try {
      const session = await runner.createSession();
      const a = await runner.startTurn(session.id, { parts: text("one") });
      assert.ok(a && a.started);
      const b = await runner.startTurn(session.id, { parts: text("two") });
      assert.deepEqual(b, { started: false, reason: "running" });
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/session/runner.test.ts`
Expected: FAIL — `Cannot find module './runner.js'`.

- [ ] **Step 3: Implement**

```ts
// src/session/runner.ts
// Live conversation state. A session's life is owned here, not by any HTTP
// response: the response is a viewer that can drop and reattach. This is
// src/runs.ts re-keyed by session — same seq counter, same subscriber set,
// same gate-on-the-handle, plus the message tree and turn bookkeeping.
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

import { resolveRunConfig, runTurn, type RunConfig } from "../agent.js";
import type { PermissionDecision, RunEvent, RunResult } from "../events.js";
import { createGate, type Gate } from "../permissions.js";
import { getRegistry } from "../registry.js";
import type { Tool } from "../types.js";
import { fillDangling, foldTurnEvent } from "./fold.js";
import { projectHistory } from "./history.js";
import type { SessionStore } from "./store.js";
import { latestLeaf } from "./tree.js";
import type {
  ChatMessage,
  Part,
  QueuedMessage,
  Session,
  SessionEvent,
  SessionOnlyEvent,
  SessionPatch,
  SessionSummary,
  Turn,
  TurnSettings,
} from "./types.js";

/** Events kept in memory per live session for fast reattach. */
const RECENT_LIMIT = 2000;
const TITLE_MAX = 60;
const DEFAULT_TITLE = "New chat";

export interface TurnInput extends TurnSettings {
  parts: Part[];
  /** undefined = current head; null = start a new root (edit the first message). */
  parentId?: string | null;
  /** Legacy /api/run: restrict tools by name for this turn only. */
  enabledTools?: string[];
  /** Reuse an id, so a dequeued QueuedMessage keeps the id the client saw. */
  messageId?: string;
}

export type StartResult =
  | { started: true; turnId: string; userMessageId: string; assistantMessageId: string }
  | { started: false; reason: "running" | "bad-parent" };

export interface Snapshot {
  session: Session;
  messages: ChatMessage[];
  turns: Turn[];
  /** Current seq at snapshot time; subscribe with `after=seq`. */
  seq: number;
  liveTurn?: { turnId: string; assistant: ChatMessage };
}

interface Subscriber {
  res: ServerResponse;
  /** Legacy run streams close when this turn ends; session streams stay open. */
  untilTurnEnd?: string;
}

interface LiveTurn {
  turn: Turn;
  assistant: ChatMessage;
  controller: AbortController;
  gate: Gate;
  done: Promise<void>;
  step: number;
}

interface LiveSession {
  session: Session;
  messages: ChatMessage[];
  turns: Turn[];
  seq: number;
  recent: SessionEvent[];
  subscribers: Set<Subscriber>;
  turn?: LiveTurn;
}

export const titleFrom = (parts: readonly Part[]): string => {
  const text = parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const attachment = parts.find((p): p is Extract<Part, { type: "attachment" }> => p.type === "attachment");
  const base = text || attachment?.name || DEFAULT_TITLE;
  return base.length > TITLE_MAX ? `${base.slice(0, TITLE_MAX - 1)}…` : base;
};

const textOf = (parts: readonly Part[]): string =>
  parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text").map((p) => p.text).join("\n\n");

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const writeEvent = (res: ServerResponse, event: SessionEvent): void => {
  if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
};

export interface Runner {
  createSession(input?: { title?: string; defaults?: TurnSettings }): Promise<Session>;
  listSessions(): Promise<SessionSummary[]>;
  getSnapshot(id: string): Promise<Snapshot | null>;
  rename(id: string, title: string): Promise<Session | null>;
  /** Resolves to the latest leaf under `messageId`; null if unknown or running. */
  setHead(id: string, messageId: string): Promise<Session | null>;
  deleteSession(id: string): Promise<boolean>;
  /** null = no such session. Throws for an unknown agent name. */
  startTurn(id: string, input: TurnInput): Promise<StartResult | null>;
  cancel(id: string): boolean;
  resolvePermission(id: string, requestId: string, decision: PermissionDecision): boolean;
  /** Attach an SSE response. Backlog after `after`, then live. */
  subscribe(id: string, res: ServerResponse, after: number, untilTurnEnd?: string): Promise<boolean>;
  eventsAfter(id: string, after: number): Promise<SessionEvent[]>;
  sessionForTurn(turnId: string): string | undefined;
  /** Resolves when no turn is running (immediately if idle). */
  awaitIdle(id: string): Promise<void>;
  /** On startup: any session left "running" by a crash is marked idle. */
  recover(): Promise<void>;
}

export const createRunner = (store: SessionStore): Runner => {
  const live = new Map<string, LiveSession>();
  const turnToSession = new Map<string, string>();

  const load = async (id: string): Promise<LiveSession | null> => {
    const cached = live.get(id);
    if (cached) return cached;
    const session = await store.getSession(id);
    if (!session) return null;
    const [messages, turns, events] = await Promise.all([
      store.getMessages(id),
      store.getTurns(id),
      store.readEvents(id, 0),
    ]);
    for (const turn of turns) turnToSession.set(turn.id, id);
    const entry: LiveSession = {
      session,
      messages,
      turns,
      seq: events[events.length - 1]?.seq ?? 0,
      recent: events.slice(-RECENT_LIMIT),
      subscribers: new Set(),
    };
    live.set(id, entry);
    return entry;
  };

  const publish = (
    entry: LiveSession,
    event: RunEvent | SessionOnlyEvent,
    turnId?: string,
  ): void => {
    const stored = {
      ...event,
      sessionId: entry.session.id,
      seq: ++entry.seq,
      ...(turnId ? { turnId } : {}),
    } as SessionEvent;

    entry.recent.push(stored);
    if (entry.recent.length > RECENT_LIMIT) entry.recent.splice(0, entry.recent.length - RECENT_LIMIT);

    if (entry.turn && turnId === entry.turn.turn.id) {
      entry.turn.assistant = foldTurnEvent(entry.turn.assistant, event);
      if (event.type === "step.start") entry.turn.step = event.step;
    }

    for (const sub of entry.subscribers) {
      writeEvent(sub.res, stored);
      if (sub.untilTurnEnd && event.type === "run.end" && turnId === sub.untilTurnEnd) {
        if (!sub.res.writableEnded) sub.res.end();
        entry.subscribers.delete(sub);
      }
    }

    // Deltas are never persisted: thousands per turn, and `assistant` carries
    // the full text. Their seq numbers are still spent; readers filter seq > N.
    if (event.type !== "assistant.delta") {
      void store.appendEvent(entry.session.id, stored).catch(() => {});
    }
  };

  const patchSession = async (
    entry: LiveSession,
    patch: SessionPatch & { queue?: QueuedMessage[] },
  ): Promise<void> => {
    entry.session = await store.updateSession(entry.session.id, patch);
    const { queue, ...rest } = patch;
    if (Object.keys(rest).length > 0) publish(entry, { type: "session.updated", patch: rest });
    if (queue) publish(entry, { type: "queue.updated", queue });
  };

  const execute = async (
    entry: LiveSession,
    liveTurn: LiveTurn,
    config: RunConfig,
    tools: Tool[],
  ): Promise<void> => {
    const { turn, controller, gate } = liveTurn;
    const turnId = turn.id;

    const history = projectHistory({
      session: entry.session,
      messages: entry.messages,
      systemPrompt: config.systemPrompt,
      attachments: new Map(), // attachments are inlined from Plan 5 onwards
    });

    let result: RunResult;
    try {
      result = await runTurn(history, {
        tools,
        model: config.model,
        temperature: config.temperature,
        maxSteps: config.maxSteps,
        signal: controller.signal,
        onEvent: (event) => publish(entry, event, turnId),
        requestPermission: (call) => gate.request(call),
      });
    } catch (error) {
      result = { status: "failed", error: messageOf(error), steps: 0, durationMs: 0 };
    }
    gate.abandon();

    const assistant = fillDangling(liveTurn.assistant);
    const finished: Turn = {
      ...turn,
      status: result.status,
      reason: result.reason,
      error: result.error,
      usage: result.usage,
      durationMs: result.durationMs,
    };

    entry.messages.push(assistant);
    entry.turns.push(finished);
    await store.appendMessage(assistant);
    await store.appendTurn(finished);

    publish(entry, { type: "run.end", ...result, sessionId: entry.session.id, turnId }, turnId);
    publish(entry, { type: "message.completed", message: assistant }, turnId);

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

  const runner: Runner = {
    async createSession(input = {}) {
      const session = await store.createSession({
        title: input.title?.trim() || DEFAULT_TITLE,
        defaults: input.defaults ?? {},
      });
      live.set(session.id, {
        session, messages: [], turns: [], seq: 0, recent: [], subscribers: new Set(),
      });
      return session;
    },

    async listSessions() {
      const stored = await store.listSessions();
      // A session that is live in memory knows its status better than the index.
      return stored.map((s) => {
        const entry = live.get(s.id);
        return entry ? { ...s, status: entry.session.status } : s;
      });
    },

    async getSnapshot(id) {
      const entry = await load(id);
      if (!entry) return null;
      return {
        session: entry.session,
        messages: entry.messages,
        turns: entry.turns,
        seq: entry.seq,
        ...(entry.turn
          ? { liveTurn: { turnId: entry.turn.turn.id, assistant: entry.turn.assistant } }
          : {}),
      };
    },

    async rename(id, title) {
      const entry = await load(id);
      if (!entry) return null;
      await patchSession(entry, { title: title.trim() || DEFAULT_TITLE });
      return entry.session;
    },

    async setHead(id, messageId) {
      const entry = await load(id);
      if (!entry || entry.turn) return null;
      if (!entry.messages.some((m) => m.id === messageId)) return null;
      await patchSession(entry, { headId: latestLeaf(entry.messages, messageId) });
      return entry.session;
    },

    async deleteSession(id) {
      const entry = await load(id);
      if (!entry) return false;
      if (entry.turn) {
        entry.turn.controller.abort();
        await entry.turn.done;
      }
      for (const sub of entry.subscribers) if (!sub.res.writableEnded) sub.res.end();
      entry.subscribers.clear();
      live.delete(id);
      for (const turn of entry.turns) turnToSession.delete(turn.id);
      await store.deleteSession(id);
      return true;
    },

    async startTurn(id, input) {
      const entry = await load(id);
      if (!entry) return null;
      if (entry.turn) return { started: false, reason: "running" };
      if (input.parentId && !entry.messages.some((m) => m.id === input.parentId)) {
        return { started: false, reason: "bad-parent" };
      }

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
      entry.turn = liveTurn;
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
    },

    cancel(id) {
      const entry = live.get(id);
      if (!entry?.turn) return false;
      entry.turn.controller.abort();
      return true;
    },

    resolvePermission(id, requestId, decision) {
      const entry = live.get(id);
      return entry?.turn ? entry.turn.gate.resolve(requestId, decision) : false;
    },

    async subscribe(id, res, after, untilTurnEnd) {
      const entry = await load(id);
      if (!entry) return false;

      // Backlog older than the in-memory window comes from the store. Nothing
      // else runs between the await resolving and the subscriber being added,
      // so no event can slip through the gap.
      const oldestRecent = entry.recent[0]?.seq ?? Number.POSITIVE_INFINITY;
      const fromStore = after + 1 < oldestRecent ? await store.readEvents(id, after) : [];
      const lastSent = fromStore[fromStore.length - 1]?.seq ?? after;
      for (const event of fromStore) writeEvent(res, event);
      for (const event of entry.recent) if (event.seq > lastSent) writeEvent(res, event);

      if (untilTurnEnd && (!entry.turn || entry.turn.turn.id !== untilTurnEnd)) {
        res.end(); // that turn is already over; the backlog was the whole story
        return true;
      }
      const sub: Subscriber = { res, untilTurnEnd };
      entry.subscribers.add(sub);
      res.on("close", () => entry.subscribers.delete(sub));
      return true;
    },

    async eventsAfter(id, after) {
      const entry = await load(id);
      if (!entry) return [];
      const oldestRecent = entry.recent[0]?.seq ?? Number.POSITIVE_INFINITY;
      if (after + 1 < oldestRecent) return store.readEvents(id, after);
      return entry.recent.filter((e) => e.seq > after);
    },

    sessionForTurn(turnId) {
      return turnToSession.get(turnId);
    },

    async awaitIdle(id) {
      const entry = live.get(id);
      if (entry?.turn) await entry.turn.done;
    },

    async recover() {
      for (const summary of await store.listSessions()) {
        if (summary.status !== "running") continue;
        const entry = await load(summary.id);
        if (!entry) continue;
        const turns = entry.turns;
        const lastRunning = [...turns].reverse().find((t) => t.status === "running");
        if (lastRunning) {
          const failed: Turn = { ...lastRunning, status: "failed", error: "harness restarted" };
          entry.turns.push(failed);
          await store.appendTurn(failed);
        }
        await patchSession(entry, { status: "idle" });
      }
    },
  };

  return runner;
};
```

Note the `recover()` branch: turns are only written at turn end, so a crash mid-turn normally leaves no `running` turn on disk — `status: "running"` on the session is the signal. The synthetic failed turn is appended only when a running one is found, per the spec's §15.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/session/runner.test.ts`
Expected: `# pass 12`, `# fail 0`. The cancel test takes ~0.3 s; the whole file well under 5 s.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: everything passes.

- [ ] **Step 6: Commit**

```bash
git add src/session/runner.ts src/session/runner.test.ts
git commit -m "feat(session): runner — turns over a session's history with seq events"
```

---

### Task 9: Routes — `/api/sessions/*` and the legacy shims

**Files:**
- Create: `src/session/routes.ts`
- Modify: `src/server.ts`
- Delete: `src/runs.ts`

- [ ] **Step 1: Write the routes module**

```ts
// src/session/routes.ts
// HTTP surface for sessions, plus the legacy /api/run* routes expressed as
// "a session with one turn" so the Go TUI and any older client keep working.
// Returns true when it handled the request.
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import type { Runner } from "./runner.js";
import type { Part } from "./types.js";

const MAX_BODY_BYTES = 256_000;
const SSE_HEARTBEAT_MS = 15_000;

export interface RouteContext {
  runner: Runner;
  corsHeaders: Record<string, string>;
  /** MODEL from src/llm.ts, for the legacy run.start model field. */
  defaultModel: string;
}

const TextPart = z.object({ type: z.literal("text"), text: z.string().max(200_000) });
const AttachmentPart = z.object({
  type: z.literal("attachment"),
  fileId: z.string().regex(/^[\w-]{1,64}$/),
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(100),
  size: z.number().int().min(0),
});
const UserPart = z.discriminatedUnion("type", [TextPart, AttachmentPart]);

const Settings = {
  model: z.string().min(1).max(200).optional(),
  agent: z.string().min(1).max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxSteps: z.number().int().min(1).max(50).optional(),
};

const CreateSession = z.object({
  title: z.string().max(200).optional(),
  defaults: z.object(Settings).optional(),
});

const PatchSession = z.object({
  title: z.string().min(1).max(200).optional(),
  headId: z.string().min(1).max(64).optional(),
});

const SendMessage = z
  .object({
    text: z.string().trim().min(1).max(200_000).optional(),
    parts: z.array(UserPart).min(1).max(50).optional(),
    parentId: z.string().min(1).max(64).nullable().optional(),
    enabledTools: z.array(z.string()).max(200).optional(),
    ...Settings,
  })
  .refine((b) => Boolean(b.text) !== Boolean(b.parts), {
    message: "send exactly one of `text` or `parts`",
  });

const PermissionReply = z.object({ decision: z.enum(["allow", "deny", "always"]) });

/** The pre-session RunRequest, unchanged, so old clients are not broken. */
const LegacyRun = z.object({
  query: z.string().trim().min(1).max(4000),
  enabledTools: z.array(z.string()).max(200).optional(),
  ...Settings,
});

const json = (res: ServerResponse, status: number, body: unknown, cors: Record<string, string>): void => {
  res.writeHead(status, { "Content-Type": "application/json", ...cors });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};

const readJsonBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });

const openSse = (res: ServerResponse, cors: Record<string, string>): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...cors,
  });
  const timer = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
  }, SSE_HEARTBEAT_MS);
  res.on("close", () => clearInterval(timer));
};

const partsOf = (body: z.infer<typeof SendMessage>): Part[] =>
  body.parts ?? [{ type: "text", text: body.text as string }];

const startOrReject = async (
  ctx: RouteContext,
  res: ServerResponse,
  sessionId: string,
  body: z.infer<typeof SendMessage>,
): Promise<void> => {
  const { runner, corsHeaders } = ctx;
  let result;
  try {
    result = await runner.startTurn(sessionId, {
      parts: partsOf(body),
      parentId: body.parentId,
      model: body.model,
      agent: body.agent,
      temperature: body.temperature,
      maxSteps: body.maxSteps,
      enabledTools: body.enabledTools,
    });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) }, corsHeaders);
    return;
  }
  if (result === null) return json(res, 404, { error: `no session ${sessionId}` }, corsHeaders);
  if (!result.started) {
    // Plan 3 turns "running" into a 202 with a queued message.
    const status = result.reason === "running" ? 409 : 400;
    return json(res, status, { error: result.reason === "running" ? "a turn is running" : "parentId is not in this session" }, corsHeaders);
  }
  json(res, 200, {
    turnId: result.turnId,
    userMessageId: result.userMessageId,
    assistantMessageId: result.assistantMessageId,
  }, corsHeaders);
};

export const handleSessionRoutes = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: RouteContext,
): Promise<boolean> => {
  const { runner, corsHeaders: cors } = ctx;
  const method = req.method ?? "GET";
  const p = url.pathname;

  // ---- sessions ----------------------------------------------------------
  if (p === "/api/sessions" && method === "GET") {
    json(res, 200, await runner.listSessions(), cors);
    return true;
  }
  if (p === "/api/sessions" && method === "POST") {
    const parsed = CreateSession.safeParse(await readJsonBody(req).catch(() => null));
    if (!parsed.success) return json(res, 400, { error: "invalid body", issues: parsed.error.issues }, cors), true;
    json(res, 201, await runner.createSession(parsed.data), cors);
    return true;
  }

  const m = p.match(/^\/api\/sessions\/([\w-]{1,64})(?:\/(.*))?$/);
  if (m) {
    const [, id, rest = ""] = m;

    if (rest === "" && method === "GET") {
      const snap = await runner.getSnapshot(id);
      return snap ? (json(res, 200, snap, cors), true) : (json(res, 404, { error: `no session ${id}` }, cors), true);
    }
    if (rest === "" && method === "PATCH") {
      const parsed = PatchSession.safeParse(await readJsonBody(req).catch(() => null));
      if (!parsed.success) return json(res, 400, { error: "invalid body", issues: parsed.error.issues }, cors), true;
      let session = null;
      if (parsed.data.title !== undefined) session = await runner.rename(id, parsed.data.title);
      if (parsed.data.headId !== undefined) {
        session = await runner.setHead(id, parsed.data.headId);
        if (!session) return json(res, 409, { error: "headId unknown, or a turn is running" }, cors), true;
      }
      if (!session) session = (await runner.getSnapshot(id))?.session ?? null;
      return session ? (json(res, 200, session, cors), true) : (json(res, 404, { error: `no session ${id}` }, cors), true);
    }
    if (rest === "" && method === "DELETE") {
      const ok = await runner.deleteSession(id);
      return ok ? (json(res, 204, undefined, cors), true) : (json(res, 404, { error: `no session ${id}` }, cors), true);
    }
    if (rest === "messages" && method === "POST") {
      const parsed = SendMessage.safeParse(await readJsonBody(req).catch(() => null));
      if (!parsed.success) return json(res, 400, { error: "invalid body", issues: parsed.error.issues }, cors), true;
      await startOrReject(ctx, res, id, parsed.data);
      return true;
    }
    if (rest === "events" && method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0);
      openSse(res, cors);
      const ok = await runner.subscribe(id, res, Number.isFinite(after) ? after : 0);
      if (!ok) res.end();
      return true;
    }
    if (rest === "cancel" && method === "POST") {
      json(res, 200, { cancelled: runner.cancel(id) }, cors);
      return true;
    }
    const perm = rest.match(/^permission\/([\w-]{1,64})$/);
    if (perm && method === "POST") {
      const parsed = PermissionReply.safeParse(await readJsonBody(req).catch(() => null));
      if (!parsed.success) return json(res, 400, { error: "decision must be allow, deny or always" }, cors), true;
      const settled = runner.resolvePermission(id, perm[1], parsed.data.decision);
      json(res, settled ? 200 : 409, { settled }, cors);
      return true;
    }
    return false;
  }

  // ---- legacy: a run is a one-turn session --------------------------------
  if (p === "/api/run" && method === "POST") {
    const parsed = LegacyRun.safeParse(await readJsonBody(req).catch(() => null));
    if (!parsed.success) return json(res, 400, { error: "invalid request", issues: parsed.error.issues }, cors), true;
    const { query, ...settings } = parsed.data;
    const session = await runner.createSession({ title: query.slice(0, 60) });
    openSse(res, cors);
    // Order matters: start the turn, then subscribe from seq 0. The backlog
    // replay delivers run.start and message.created even though they were
    // published before the subscription existed, and untilTurnEnd closes the
    // stream at run.end the way the old one-run endpoint did.
    let result;
    try {
      result = await runner.startTurn(session.id, {
        parts: [{ type: "text", text: query }],
        ...settings,
      });
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: "run.end", status: "failed", error: error instanceof Error ? error.message : String(error), durationMs: 0, steps: 0 })}\n\n`);
      res.end();
      return true;
    }
    if (!result || !result.started) {
      res.end();
      return true;
    }
    await runner.subscribe(session.id, res, 0, result.turnId);
    console.log(`[run ${result.turnId.slice(0, 8)}] ${query}`);
    return true;
  }
  if (p === "/api/runs" && method === "GET") {
    // Legacy shape for the old web client's history list.
    const sessions = await runner.listSessions();
    json(res, 200, sessions.map((s) => ({
      id: s.id,
      query: s.title,
      model: s.lastModel ?? ctx.defaultModel,
      startedAt: s.createdAt,
      status: s.status === "running" ? "running" : "completed",
      steps: s.messageCount,
      durationMs: 0,
    })), cors);
    return true;
  }
  const legacy = p.match(/^\/api\/run\/([\w-]{1,64})\/(stream|cancel|permission\/([\w-]{1,64}))$/);
  if (legacy) {
    const [, rawId, action, requestId] = legacy;
    // The id may be a turn id (from run.start) or a session id (from /api/runs).
    const sessionId = runner.sessionForTurn(rawId) ?? rawId;
    if (action === "stream" && method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0);
      openSse(res, cors);
      const turnId = runner.sessionForTurn(rawId) ? rawId : undefined;
      const ok = await runner.subscribe(sessionId, res, Number.isFinite(after) ? after : 0, turnId);
      if (!ok) res.end();
      return true;
    }
    if (action === "cancel" && method === "POST") {
      const cancelled = runner.cancel(sessionId);
      json(res, cancelled ? 200 : 409, { cancelled, ...(cancelled ? {} : { error: "run is not running" }) }, cors);
      return true;
    }
    if (action.startsWith("permission/") && method === "POST" && requestId) {
      const parsed = PermissionReply.safeParse(await readJsonBody(req).catch(() => null));
      if (!parsed.success) return json(res, 400, { error: "decision must be allow, deny or always" }, cors), true;
      const settled = runner.resolvePermission(sessionId, requestId, parsed.data.decision);
      json(res, settled ? 200 : 409, { settled }, cors);
      return true;
    }
  }

  return false;
};
```

- [ ] **Step 2: Rewire `src/server.ts`**

Replace the imports of `./runs.js` and the `handleRun`, `handleReattach`, `handlePermissionReply`, `PermissionReply`, `openSseStream`, `startHeartbeat`, `readJsonBody`, `RunRequest` definitions and the `/api/run*` and `/api/runs` route branches with the following. Keep `/api/health`, `/api/tools`, `/api/agents`, `/api/skills`, CORS, the shutdown handling and `start()`.

```ts
import { runAgent } from "./agent.js";   // no longer used here; delete this import
```

New imports:

```ts
import { FALLBACK_MODELS, MODEL } from "./llm.js";
import { closeRegistry, getRegistry, initRegistry } from "./registry.js";
import { createRunner } from "./session/runner.js";
import { handleSessionRoutes } from "./session/routes.js";
import { FileSessionStore } from "./session/store/files.js";
import type { Tool } from "./types.js";
```

Runner construction (module level, after `corsHeaders`):

```ts
const runner = createRunner(new FileSessionStore());
```

Inside the `createServer` callback, after the `/api/skills` branch and before the final 404:

```ts
  void handleSessionRoutes(req, res, url, {
    runner,
    corsHeaders,
    defaultModel: MODEL,
  }).then((handled) => {
    if (!handled) json(res, 404, { error: "not found" });
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dulo] route error:", message);
    if (!res.headersSent) json(res, 500, { error: message });
    else if (!res.writableEnded) res.end();
  });
  return;
```

and delete the existing `json(res, 404, ...)` line that followed the routes.

In `start()`, replace `await ensureRunsDir();` with `await runner.recover();` after `initRegistry()`:

```ts
const start = async () => {
  await initRegistry();
  await runner.recover();
  server.listen(PORT, () => { /* unchanged */ });
};
```

- [ ] **Step 3: Delete the old run registry**

```bash
git rm src/runs.ts
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean. Any remaining reference to `./runs.js` or to `handleRun` means Step 2 missed a line.

- [ ] **Step 5: Verify the API end to end**

Start a stub and the harness in tmux (port 3099; the owner's harness holds 3001):

```bash
cat > tmp-stub.cjs <<'EOF'
const http = require("node:http");
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    const users = JSON.parse(b).messages.filter((m) => m.role === "user").length;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `seen ${users}` } }] })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
}).listen(4590);
EOF
tmux new-session -d -s duloplan "node tmp-stub.cjs"
tmux new-window -t duloplan "PORT=3099 OPENROUTER_API_KEY=test OPENROUTER_URL=http://127.0.0.1:4590/x npx tsx src/server.ts"
sleep 4
```

Create a session and send two messages:

```bash
SID=$(curl -s -X POST http://127.0.0.1:3099/api/sessions -H 'content-type: application/json' -d '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -s -X POST http://127.0.0.1:3099/api/sessions/$SID/messages -H 'content-type: application/json' -d '{"text":"hello"}'; echo
sleep 1
curl -s -X POST http://127.0.0.1:3099/api/sessions/$SID/messages -H 'content-type: application/json' -d '{"text":"again"}'; echo
sleep 1
curl -s http://127.0.0.1:3099/api/sessions/$SID | python3 -c '
import json,sys; s=json.load(sys.stdin)
print("title:", s["session"]["title"], "| status:", s["session"]["status"], "| seq:", s["seq"])
for m in s["messages"]:
    print(" ", m["role"], "->", "".join(p.get("text","") for p in m["parts"]))'
```

Expected:

```
{"turnId":"…","userMessageId":"…","assistantMessageId":"…"}
{"turnId":"…","userMessageId":"…","assistantMessageId":"…"}
title: hello | status: idle | seq: 14
  user -> hello
  assistant -> seen 1
  user -> again
  assistant -> seen 2
```

`seen 2` on the second turn is the whole point: the second request carried the first exchange.

Replay the event log and check ordering:

```bash
curl -sN --max-time 2 "http://127.0.0.1:3099/api/sessions/$SID/events?after=0" | grep -o '"type":"[a-z.]*"\|"seq":[0-9]*' | paste - - | head -20
```

Expected: seq strictly increasing; `message.created`, `run.start`, `step.start`, `assistant.delta`…, `assistant`, `run.end`, `message.completed`, `session.updated` per turn.

Legacy path — exactly what the Go TUI sends:

```bash
curl -sN --max-time 3 -X POST http://127.0.0.1:3099/api/run -H 'content-type: application/json' -d '{"query":"legacy","maxSteps":4,"temperature":0.2}' | grep -o '"type":"[a-z.]*"' | tr '\n' ' '; echo
```

Expected: includes `"type":"run.start"` and `"type":"run.end"`, and the connection **closes** after `run.end` (the command returns before the 3 s timeout).

Branch and head:

```bash
FIRST_USER=$(curl -s http://127.0.0.1:3099/api/sessions/$SID | python3 -c 'import json,sys; print(json.load(sys.stdin)["messages"][0]["id"])')
curl -s -X POST http://127.0.0.1:3099/api/sessions/$SID/messages -H 'content-type: application/json' -d '{"text":"edited first message","parentId":null}'; echo
sleep 1
curl -s -X PATCH http://127.0.0.1:3099/api/sessions/$SID -H 'content-type: application/json' -d "{\"headId\":\"$FIRST_USER\"}" | python3 -c 'import json,sys; print("head is now:", json.load(sys.stdin)["headId"])'
```

Expected: the edited message becomes a second root (parentId null); the PATCH moves head to the **assistant reply of the original first message** (latest leaf under it), and prints its id.

Sessions list:

```bash
curl -s http://127.0.0.1:3099/api/sessions | python3 -c 'import json,sys; [print(s["title"], s["messageCount"], s["status"]) for s in json.load(sys.stdin)]'
```

Expected: two sessions (`hello` with 6 messages, `legacy` with 2), newest first, both `idle`.

Clean up:

```bash
tmux kill-session -t duloplan; rm -f tmp-stub.cjs; rm -rf sessions
```

- [ ] **Step 6: Confirm the web client still builds and the TUI still compiles**

```bash
cd client && npm run typecheck && npm run lint && npm run build && cd ..
cd tui && go build ./... && go test ./... && cd ..
```

Expected: all clean. Neither client changed except the optional-field mirror in Task 7.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm run typecheck && npm test
git add src/server.ts src/session/routes.ts
git commit -m "feat(session): HTTP routes for sessions, legacy /api/run as a one-turn session"
```

---

### Task 10: Docs and context

**Files:**
- Modify: `README.md`
- Modify: `context.md` (git-ignored; still mandatory)
- Modify: `docs/conversations-design.md` (status line only)

- [ ] **Step 1: README — API reference**

In the API Reference table, add rows for `GET/POST /api/sessions`, `GET/PATCH/DELETE /api/sessions/:id`, `POST /api/sessions/:id/messages`, `GET /api/sessions/:id/events?after=N`, `POST /api/sessions/:id/cancel`, `POST /api/sessions/:id/permission/:requestId`. Under `POST /api/run`, add one sentence: "Creates a session and runs one turn; kept for the TUI and older clients." Replace the "Runs outlive their connection" subsection's `runs/<id>.jsonl` with `sessions/<id>/events.jsonl` and note that a session's event stream stays open across turns.

- [ ] **Step 2: context.md**

Per `CLAUDE.md`: §3 add the `src/session/` module and its files; §4 add rows for — one user + one assistant message per turn; `run.start`/`run.end` kept as turn boundaries (why: the TUI); events per session with one seq; deltas not persisted; `SessionStore` interface with files default and Postgres as a future option; legacy stream closes at `run.end`, session streams stay open; `runTurn` vs `runAgent`. §6 timeline row. §7 open work: Plans 2–7 of `docs/conversations-design.md` §17 remain; note that send-while-running is a 409 until Plan 3 lands. §8 log line with date and what was verified in Task 9 Step 5. Bump **Last updated**.

- [ ] **Step 3: Design status**

In `docs/conversations-design.md`, change the status line to:
`Status: approved 2026-09-13. Plan 1 (session core) implemented <date>. Owner: Ali. Author: Claude.`

- [ ] **Step 4: Commit**

```bash
git add README.md docs/conversations-design.md
git commit -m "docs: session API in README, mark plan 1 done"
```

---

## Self-review against the spec

- **§4 data model** → Task 1. **§5 store** → Task 6. **§6.1 projection** → Task 5. **§6.2 runTurn** → Task 7. **§6.3 runner / §6.4 fold** → Tasks 4, 8. **§7 events, one seq per session, deltas not persisted** → Task 8 `publish`. **§10 branching (head, latest leaf, parentId)** → Tasks 3, 8, 9. **§12 permissions and cancel** → Task 8, 9. **§13 routes** (except queue, files, memory — Plans 3, 5, 6) → Task 9. **§13.1 shims** → Task 9. **§15 harness restart recovery** → `recover()` in Task 8. **§16 tests** → Tasks 3–8 (`history`, `tree`, `fold`, `runner`, `store.files`; `memory.test.ts` is Plan 6).
- **Deliberately deferred to later plans, called out where it shows:** send-while-running returns 409 (Plan 3 → 202 + queue); attachments render as the binary marker because `projectHistory` receives an empty map (Plan 5 reads files); no compaction call (Plan 6); the web client is untouched beyond the type mirror (Plan 2).
- **Type consistency check:** `StartResult`, `TurnInput`, `Snapshot`, `Runner` are defined in Task 8 and used identically in Task 9. `projectHistory`'s `attachments: ReadonlyMap<string,string>` is passed `new Map()` in Task 8. `foldTurnEvent(assistant, RunEvent | SessionOnlyEvent)` matches its call in `publish`. `Turn.model` is required and `resolveRunConfig` always returns a string. `SessionEvent.turnId` is optional and set only by `publish`'s third argument.

## What comes after this plan

Plans 2–7 follow the design's §17 in order, each written when its predecessor has landed:

| Plan | Scope | Depends on |
| --- | --- | --- |
| 2 — Chat page MVP | `session-types.ts`, `fold.ts`, `tree.ts` mirrors; `session-client.ts` with reconnect; `session-store.tsx`; `chat.tsx` with `SessionList`, `MessageThread`, `UserMessage`, `AssistantMessage` (Markdown), `ToolActivity`, `Composer` (send, Stop), inline `PermissionPrompt`; `"chat"` in `Page` | this plan |
| 3 — Queue | 202 + `QueuedMessage` on send-while-running, auto-run after completion, hold after cancel/fail, `queue/:id` PATCH/DELETE/send, composer chips | 1, 2 |
| 4 — Branching UI | Edit → resend as sibling, `BranchSwitcher`, `PATCH { headId }` | 2 |
| 5 — Per-turn model/agent + attachments | Pickers in composer; `PUT /files`, `GET /files/:id`; read text-like files into the `attachments` map before projection; drop/paste upload | 1, 2 |
| 6 — Memory | Threshold check before projection, summarisation call, extend-not-replace, `GET/PATCH /memory`, `MemoryPanel` | 1, 2 |
| 7 — Switch-over | Chat as default page; remove `runs/` from `.gitignore`; README; `context.md` | all |
