# Conversations — Plan 2 of 7: Chat Page MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web client a real chat page on top of the session API from Plan 1 — a session list, a streaming message thread that renders Markdown and tool activity, inline permission prompts, a composer with Stop, and a stream that reconnects on its own — without touching the Playground, the TUI or the CLI.

**Architecture:** The harness already owns conversations (`/api/sessions/*`, Plan 1). This plan adds a second client store (`session-store.tsx`) that holds session snapshots and folds `SessionEvent`s into them with the same pure `foldTurnEvent` the server uses (mirrored). The thread is built from shadcn's chat primitives (`MessageScroller`, `Message`, `Bubble`), which own scrolling, streaming follow and jump-to-latest, so no scroll code is written here. Assistant text renders through `react-markdown`; code blocks reuse the existing `CodeBlock`.

**Tech Stack:** React 19, Vite, shadcn/ui on Base UI (`base-mira`, HugeIcons), Tailwind v4, `react-markdown@10` + `remark-gfm@4` (new), `vitest@5` (new, dev). Harness side: one small addition to `src/session/runner.ts`, tested with `node:test`.

**Spec:** `docs/conversations-design.md` §14 (Web client), §7 (Events), §13 (API). **Two deliberate deviations from §14, decided while planning and recorded in the design's status line by Task 9:**
1. Thread, rows and bubbles use the shadcn chat primitives instead of the hand-written `MessageThread`/autoscroll the design sketched. Verified in the registry: `@shadcn/message-scroller`, `@shadcn/message`, `@shadcn/bubble`, `@shadcn/marker`; `@shadcn/attachment` waits for Plan 5.
2. No `rehype-highlight`. Fenced code renders through the existing `CodeBlock` — zero extra dependencies, consistent with the rest of the panel, and syntax colouring is visual polish the owner has said they want to shape themselves.

**Read first:** `context.md` (mandatory per `CLAUDE.md`), `docs/conversations-design.md` §4–§7 and §13–§14, `client/src/lib/store.tsx` (the reducer/persistence pattern this plan copies), `client/src/lib/agent-client.ts` (the reconnect loop this plan generalises), `client/src/pages/playground.tsx` (composer, toast and permission patterns to stay consistent with), and `src/session/types.ts` / `src/session/fold.ts` / `src/session/tree.ts` (the files mirrored here — mirror **the committed code**, not memory).

**Conventions that apply to every task:**
- Conventional commits, **no attribution trailers** — the owner disables them globally. One commit per task.
- Client checks before every commit: `cd client && npm run typecheck && npm run lint && npm run build` (and `npm test` once Task 1 adds it). Root checks when a task touches `src/`: `npm run typecheck && npm test`.
- shadcn rules are enforced (`client/.claude/skills/shadcn`): compose installed components, `className` for layout only, semantic colours only (`bg-muted`, `text-muted-foreground`, never a raw palette), `gap-*` not `space-*`, icons via `<HugeiconsIcon icon={X} />` with `data-icon` inside buttons and no sizing classes, `render` prop (Base UI) not `asChild`, every Dialog/Sheet has a Title.
- React 19 lint: never call `dispatch`/`setState` synchronously in an effect body — only inside `.then`, event handlers or callbacks. Where an effect must kick off an async fetch, follow `health-provider.tsx`: `// eslint-disable-next-line react-hooks/set-state-in-effect` with the one-line reason.
- Dev servers only inside tmux (a global hook blocks `npm run dev` outside it). Ports 3001 and 5173 are often the owner's; use 3099 and 5174 for anything you start, and check `lsof -iTCP:<port> -sTCP:LISTEN` first.
- Never call the real OpenRouter API. Point `OPENROUTER_URL` at the stub described in Task 9.
- `context.md` is git-ignored: edit it on disk, never `git add` it.

---

## File structure

| File | Responsibility | Status |
| --- | --- | --- |
| `client/src/components/ui/{message-scroller,message,bubble,marker,collapsible}.tsx` | shadcn primitives, installed by the CLI | add via CLI |
| `client/vitest.config.ts` | Test runner config with the `@` alias | create |
| `client/src/lib/session-types.ts` | Mirror of `src/session/types.ts` + API response shapes | create |
| `client/src/lib/fold.ts` | Mirror of `foldTurnEvent` | create |
| `client/src/lib/tree.ts` | Mirror of `pathToHead`, `siblingsOf`, `latestLeaf` | create |
| `client/src/lib/session-client.ts` | Fetch wrappers for `/api/sessions/*`; `streamSession` with reconnect | create |
| `client/src/lib/session-store.tsx` | Reducer over `SessionEvent` + selection/drafts; provider + hook | create |
| `client/src/lib/agent-client.ts` | Export `endpoint`, `describeFailure`, `wait`, generic `drain` | modify |
| `client/src/components/permission-prompt.tsx` | `PermissionPrompt`, moved out of the Playground | create (move) |
| `client/src/components/todo-list.tsx` | `TodoList`, moved out of the Playground | create (move) |
| `client/src/components/markdown.tsx` | `MarkdownContent` — react-markdown with GFM, code via `CodeBlock` | create |
| `client/src/components/chat/tool-activity.tsx` | One tool call + its result, collapsible | create |
| `client/src/components/chat/assistant-message.tsx` | Parts → segments → Markdown + ToolActivity, ghost bubble | create |
| `client/src/components/chat/user-message.tsx` | Text in an end-aligned bubble | create |
| `client/src/components/chat/message-thread.tsx` | `MessageScroller` over the current path + live turn + prompts | create |
| `client/src/components/chat/session-list.tsx` | List, new, rename, delete | create |
| `client/src/components/chat/composer.tsx` | Textarea, Enter/Shift+Enter, Send, Stop | create |
| `client/src/pages/chat.tsx` | Wires store + client + stream; layout; Sheet for the list on small screens | create |
| `client/src/pages/playground.tsx` | Import the two moved components | modify |
| `client/src/lib/types.ts`, `App.tsx`, `components/app-sidebar.tsx`, `components/site-header.tsx`, `main.tsx` | `"chat"` page, nav item, title, provider | modify |
| `src/session/runner.ts`, `src/session/runner.test.ts` | `pendingPermissions` on the live-turn snapshot | modify |
| `client/src/lib/{fold,tree,session-store}.test.ts` | vitest suites | create |
| `README.md`, `docs/conversations-design.md`, `context.md` | Docs | modify |

---

### Task 1: Install the chat primitives, the test runner, and a Chat page skeleton

**Files:**
- Add (CLI): `client/src/components/ui/message-scroller.tsx`, `message.tsx`, `bubble.tsx`, `marker.tsx`, `collapsible.tsx`
- Create: `client/vitest.config.ts`, `client/src/pages/chat.tsx` (placeholder)
- Modify: `client/package.json`, `client/src/lib/types.ts`, `client/src/App.tsx`, `client/src/components/app-sidebar.tsx`, `client/src/components/site-header.tsx`

- [ ] **Step 1: Install the shadcn primitives**

```bash
cd client
npx shadcn@latest add message-scroller message bubble marker collapsible
```

Expected: five new files under `src/components/ui/`, and `@shadcn/react` added to `dependencies` in `package.json` (`message-scroller` depends on it). If the CLI asks about overwriting `button.tsx` (a registry dependency), answer **no** — keep the local file.

- [ ] **Step 2: Review the installed files**

Open `src/components/ui/message-scroller.tsx`. The registry source uses an `IconPlaceholder` from a path that does not exist in this project. The CLI should have rewritten it for HugeIcons; confirm the file contains

```tsx
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown02Icon } from "@hugeicons/core-free-icons"
```

and, inside `MessageScrollerButton`, `<HugeiconsIcon icon={ArrowDown02Icon} />`. If instead any line still imports from `@/app/(create)/...` or references `IconPlaceholder`, replace that import with the two lines above and the `<IconPlaceholder … />` element with `<HugeiconsIcon icon={ArrowDown02Icon} />`. Also confirm every file imports `cn` from `"cn"` and `Button` from `"@/components/ui/button"`. Open `src/components/ui/collapsible.tsx` and confirm it exports exactly `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`.

Check `git status --short`: if the CLI edited `src/index.css`, read the diff — it is fine to keep, but nothing else outside `src/components/ui/` and `package.json` should have changed.

- [ ] **Step 3: Add the runtime and test dependencies**

```bash
npm install react-markdown@^10.1.0 remark-gfm@^4.0.1
npm install -D vitest@^5.0.0
```

- [ ] **Step 4: Add test scripts**

In `client/package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Create the vitest config**

```ts
// client/vitest.config.ts
import path from "path"
import { defineConfig } from "vitest/config"

// Kept separate from vite.config.ts so the app build does not depend on
// vitest types. Only the alias is shared; tests are pure TypeScript.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
```

- [ ] **Step 6: Register the page**

In `client/src/lib/types.ts`, change the first line to:

```ts
export type Page = "dashboard" | "chat" | "playground" | "tools" | "settings"
```

In `client/src/components/site-header.tsx`, add to `PAGE_TITLES`:

```ts
  chat: "Chat",
```

In `client/src/components/app-sidebar.tsx`, add `BubbleChatIcon` to the `@hugeicons/core-free-icons` import and insert as the second nav item:

```ts
  { page: "chat", label: "Chat", icon: BubbleChatIcon },
```

In `client/src/App.tsx`, add the import and the branch:

```tsx
import { ChatPage } from "@/pages/chat"
```

```tsx
          {page === "chat" && <ChatPage />}
```

- [ ] **Step 7: Create the placeholder page**

```tsx
// client/src/pages/chat.tsx
import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatIcon } from "@hugeicons/core-free-icons"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

// Replaced by the real page in Task 8. Exists so the app compiles with the
// new "chat" page registered.
export function ChatPage() {
  return (
    <Empty className="min-h-72 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={BubbleChatIcon} />
        </EmptyMedia>
        <EmptyTitle>Chat is being built</EmptyTitle>
        <EmptyDescription>
          Sessions, streaming and Markdown arrive in the next tasks.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
```

- [ ] **Step 8: Verify**

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

Expected: typecheck/lint/build clean; `npm test` reports no test files yet (vitest prints "No test files found" and exits 0 with `passWithNoTests` unset — if it exits 1, add `"passWithNoTests": true` under `test` in `vitest.config.ts`; Task 3 adds the first tests and you can remove it then, or leave it).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/components/ui src/lib/types.ts src/App.tsx src/components/app-sidebar.tsx src/components/site-header.tsx src/pages/chat.tsx
git add src/index.css 2>/dev/null || true
git commit -m "feat(client): install chat primitives, vitest, and register the Chat page"
```

---

### Task 2: Harness — expose pending permissions on the live-turn snapshot

Without this, a user who refreshes while a gated tool is waiting never sees the prompt: the `permission.ask` event is in the past and `events?after=seq` will not replay it. The gate already knows what is pending (`Gate.pending()`), so this is a three-line addition plus a test.

**Files:**
- Modify: `src/session/runner.ts`
- Modify: `src/session/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("runner", …)` block of `src/session/runner.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run (repo root): `npm test`
Expected: FAIL — `Property 'pendingPermissions' does not exist` (typecheck runs first under tsx) or an assertion on `pendingPermissions.length`.

- [ ] **Step 3: Extend the snapshot**

In `src/session/runner.ts`, replace the `Snapshot` interface:

```ts
export interface Snapshot {
  session: Session;
  messages: ChatMessage[];
  turns: Turn[];
  /** Current seq at snapshot time; subscribe with `after=seq`. */
  seq: number;
  liveTurn?: {
    turnId: string;
    assistant: ChatMessage;
    /** Gated tool calls waiting on a human right now. Empty when none. */
    pendingPermissions: {
      id: string;
      step: number;
      tool: string;
      args: Record<string, unknown>;
    }[];
  };
}
```

and replace the `getSnapshot` method body. Read the file first; the current implementation is:

```ts
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
```

Replace it with:

```ts
    async getSnapshot(id) {
      const entry = await load(id);
      if (!entry) return null;
      // A local binding keeps the narrowing inside the map callback.
      const live = entry.turn;
      return {
        session: entry.session,
        messages: entry.messages,
        turns: entry.turns,
        seq: entry.seq,
        ...(live
          ? {
              liveTurn: {
                turnId: live.turn.id,
                assistant: live.assistant,
                pendingPermissions: live.gate.pending().map((ask) => ({
                  id: ask.id,
                  step: live.step,
                  tool: ask.tool,
                  args: ask.args,
                })),
              },
            }
          : {}),
      };
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; `# pass 45`, `# fail 0` (44 from Plan 1 plus this one).

- [ ] **Step 5: Commit**

```bash
git add src/session/runner.ts src/session/runner.test.ts
git commit -m "feat(session): include pending permissions in the live-turn snapshot"
```

---

### Task 3: Client mirrors of the session types, fold and tree — with tests

**Files:**
- Create: `client/src/lib/session-types.ts`, `client/src/lib/fold.ts`, `client/src/lib/tree.ts`
- Create: `client/src/lib/fold.test.ts`, `client/src/lib/tree.test.ts`

- [ ] **Step 1: Write the types mirror**

Mirror `src/session/types.ts` exactly (read the committed file; the shapes below match it), plus the two API response shapes the client needs.

```ts
// client/src/lib/session-types.ts
// Mirror of src/session/types.ts in the harness — keep the two in sync the way
// types.ts mirrors src/events.ts. Plus the response shapes of the session API.
import type { RunEvent, RunUsage } from "./types"

/** Per-turn overrides. A session keeps the last used set as its defaults. */
export interface TurnSettings {
  model?: string
  agent?: string
  temperature?: number
  maxSteps?: number
}

export interface Memory {
  summary: string
  /** Id of the last message on the path that the summary replaces. */
  coversUpTo: string
  updatedAt: string
  editedByUser: boolean
}

export type TextPart = { type: "text"; text: string }
export type AttachmentPart = {
  type: "attachment"
  fileId: string
  name: string
  mime: string
  size: number
}
export type ToolCallPart = {
  type: "tool_call"
  callId: string
  tool: string
  args: Record<string, unknown>
}
export type ToolResultPart = {
  type: "tool_result"
  callId: string
  tool: string
  result: string
  isError: boolean
  durationMs: number
  error?: { message: string }
}
export type Part = TextPart | AttachmentPart | ToolCallPart | ToolResultPart

export interface ChatMessage {
  id: string
  sessionId: string
  /** null only for a root user message. */
  parentId: string | null
  role: "user" | "assistant"
  parts: Part[]
  /** The turn this message belongs to (both the user and assistant message). */
  turnId?: string
  createdAt: string
}

export interface QueuedMessage extends TurnSettings {
  id: string
  parts: Part[]
  parentId?: string
  queuedAt: string
}

export type SessionStatus = "idle" | "running"

export interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: SessionStatus
  /** Tip of the current branch; null for an empty session. */
  headId: string | null
  memory?: Memory
  queue: QueuedMessage[]
  defaults: TurnSettings
}

export type TurnStatus = "running" | "completed" | "failed" | "cancelled"

export interface Turn extends TurnSettings {
  id: string
  sessionId: string
  userMessageId: string
  assistantMessageId: string
  /** Always resolved, never undefined, on a Turn. */
  model: string
  status: TurnStatus
  reason?: "answered" | "step-limit"
  error?: string
  usage?: RunUsage
  startedAt: string
  durationMs: number
}

export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: SessionStatus
  messageCount: number
  lastModel?: string
}

export type SessionPatch = Partial<
  Pick<Session, "title" | "headId" | "status" | "memory" | "defaults">
>

/** Events that are about the session rather than one turn. */
export type SessionOnlyEvent =
  | { type: "message.created"; message: ChatMessage }
  | { type: "message.completed"; message: ChatMessage }
  | { type: "queue.updated"; queue: QueuedMessage[] }
  | { type: "session.updated"; patch: SessionPatch }

/**
 * Everything on a session's stream. Turn events keep their RunEvent names and
 * shapes; run.start/run.end mean turn start/end. One seq counter per session.
 */
export type SessionEvent = (RunEvent | SessionOnlyEvent) & {
  sessionId: string
  seq: number
  turnId?: string
}

/** A gated tool call waiting on the user, as the snapshot reports it. */
export interface PendingToolPermission {
  id: string
  step: number
  tool: string
  args: Record<string, unknown>
}

/** Body of GET /api/sessions/:id — mirrors Snapshot in src/session/runner.ts. */
export interface SessionSnapshot {
  session: Session
  messages: ChatMessage[]
  turns: Turn[]
  /** Current seq at snapshot time; open the event stream with `after=seq`. */
  seq: number
  liveTurn?: {
    turnId: string
    assistant: ChatMessage
    pendingPermissions: PendingToolPermission[]
  }
}

/** Body of a 200 from POST /api/sessions/:id/messages. */
export interface StartedTurn {
  turnId: string
  userMessageId: string
  assistantMessageId: string
}
```

- [ ] **Step 2: Write the fold mirror**

```ts
// client/src/lib/fold.ts
// Mirror of foldTurnEvent in src/session/fold.ts. The same pure function the
// server uses to build the assistant message, applied here to render a live
// turn. `message.completed` then carries the server's version, which replaces
// this fold, so a dropped chunk cannot leave a permanent gap.
import type { ChatMessage, Part, SessionOnlyEvent } from "./session-types"
import type { RunEvent } from "./types"

const lastTextIndex = (parts: readonly Part[]): number => {
  const last = parts[parts.length - 1]
  return last?.type === "text" ? parts.length - 1 : -1
}

export const foldTurnEvent = (
  assistant: ChatMessage,
  event: RunEvent | SessionOnlyEvent
): ChatMessage => {
  switch (event.type) {
    case "assistant.delta": {
      const at = lastTextIndex(assistant.parts)
      if (at === -1) {
        return {
          ...assistant,
          parts: [...assistant.parts, { type: "text", text: event.text }],
        }
      }
      const parts = assistant.parts.slice()
      const current = parts[at] as { type: "text"; text: string }
      parts[at] = { type: "text", text: current.text + event.text }
      return { ...assistant, parts }
    }
    case "assistant": {
      const at = lastTextIndex(assistant.parts)
      const parts =
        at === -1 ? [...assistant.parts] : assistant.parts.slice(0, at)
      return {
        ...assistant,
        parts: [...parts, { type: "text", text: event.text }],
      }
    }
    case "tool.call":
      return {
        ...assistant,
        parts: [
          ...assistant.parts,
          {
            type: "tool_call",
            callId: event.callId,
            tool: event.tool,
            args: event.args,
          },
        ],
      }
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
      }
    default:
      return assistant
  }
}
```

- [ ] **Step 3: Write the tree mirror**

```ts
// client/src/lib/tree.ts
// Mirror of src/session/tree.ts. Pure helpers over the message tree.
import type { ChatMessage } from "./session-types"

const byCreated = (a: ChatMessage, b: ChatMessage): number =>
  a.createdAt.localeCompare(b.createdAt)

/** Root → head. Empty when head is null or unknown. */
export const pathToHead = (
  messages: readonly ChatMessage[],
  headId: string | null
): ChatMessage[] => {
  if (!headId) return []
  const byId = new Map(messages.map((m) => [m.id, m]))
  const path: ChatMessage[] = []
  let current = byId.get(headId)
  while (current) {
    path.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path.reverse()
}

/** Messages sharing this one's parent (roots share `null`), oldest first. */
export const siblingsOf = (
  messages: readonly ChatMessage[],
  id: string
): { index: number; total: number; ids: string[] } => {
  const self = messages.find((m) => m.id === id)
  if (!self) return { index: 0, total: 0, ids: [] }
  const ids = messages
    .filter((m) => m.parentId === self.parentId)
    .sort(byCreated)
    .map((m) => m.id)
  return { index: ids.indexOf(id), total: ids.length, ids }
}

/** From `id`, step to the newest child repeatedly; the leaf reached. */
export const latestLeaf = (
  messages: readonly ChatMessage[],
  id: string
): string => {
  let current = id
  for (;;) {
    const children = messages
      .filter((m) => m.parentId === current)
      .sort(byCreated)
    if (children.length === 0) return current
    current = children[children.length - 1].id
  }
}
```

- [ ] **Step 4: Write the tests**

```ts
// client/src/lib/fold.test.ts
import { describe, expect, it } from "vitest"

import { foldTurnEvent } from "./fold"
import type { ChatMessage } from "./session-types"

const shell = (): ChatMessage => ({
  id: "a",
  sessionId: "s",
  parentId: "u",
  role: "assistant",
  parts: [],
  turnId: "t",
  createdAt: "2026-01-01T00:00:00Z",
})

describe("foldTurnEvent", () => {
  it("accumulates deltas into one text part", () => {
    let m = shell()
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Hel" })
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "lo" })
    expect(m.parts).toEqual([{ type: "text", text: "Hello" }])
  })

  it("lets the final assistant event replace the accumulated text", () => {
    let m = shell()
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Hel" })
    m = foldTurnEvent(m, { type: "assistant", step: 1, text: "Hello, world" })
    expect(m.parts).toEqual([{ type: "text", text: "Hello, world" }])
  })

  it("starts a new text part after a tool result", () => {
    let m = shell()
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Checking" })
    m = foldTurnEvent(m, {
      type: "tool.call",
      step: 1,
      callId: "c1",
      tool: "get_current_time",
      args: {},
    })
    m = foldTurnEvent(m, {
      type: "tool.result",
      step: 1,
      callId: "c1",
      tool: "get_current_time",
      result: "10:00",
      durationMs: 3,
      isError: false,
    })
    m = foldTurnEvent(m, { type: "assistant.delta", step: 2, text: "It is 10:00" })
    expect(m.parts.map((p) => p.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "text",
    ])
  })

  it("ignores events that are not about the message and never mutates input", () => {
    const m = shell()
    expect(foldTurnEvent(m, { type: "step.start", step: 1 })).toBe(m)
    expect(foldTurnEvent(m, { type: "queue.updated", queue: [] })).toBe(m)
    foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "x" })
    expect(m.parts).toEqual([])
  })
})
```

```ts
// client/src/lib/tree.test.ts
import { describe, expect, it } from "vitest"

import type { ChatMessage } from "./session-types"
import { latestLeaf, pathToHead, siblingsOf } from "./tree"

const msg = (
  id: string,
  parentId: string | null,
  createdAt: string,
  role: "user" | "assistant" = "user"
): ChatMessage => ({
  id,
  sessionId: "s",
  parentId,
  role,
  parts: [{ type: "text", text: id }],
  createdAt,
})

//   u1 ─ a1 ─ u2 ─ a2
//             └─ u2b ─ a2b
const tree: ChatMessage[] = [
  msg("u1", null, "2026-01-01T00:00:01Z"),
  msg("a1", "u1", "2026-01-01T00:00:02Z", "assistant"),
  msg("u2", "a1", "2026-01-01T00:00:03Z"),
  msg("a2", "u2", "2026-01-01T00:00:04Z", "assistant"),
  msg("u2b", "a1", "2026-01-01T00:00:05Z"),
  msg("a2b", "u2b", "2026-01-01T00:00:06Z", "assistant"),
]

describe("pathToHead", () => {
  it("walks parent pointers, root first", () => {
    expect(pathToHead(tree, "a2b").map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u2b",
      "a2b",
    ])
  })
  it("is empty for a null or unknown head", () => {
    expect(pathToHead(tree, null)).toEqual([])
    expect(pathToHead(tree, "nope")).toEqual([])
  })
})

describe("siblingsOf", () => {
  it("orders siblings by createdAt and reports the index", () => {
    expect(siblingsOf(tree, "u2b")).toEqual({
      index: 1,
      total: 2,
      ids: ["u2", "u2b"],
    })
  })
})

describe("latestLeaf", () => {
  it("follows the newest child until a message has none", () => {
    expect(latestLeaf(tree, "a1")).toBe("a2b")
    expect(latestLeaf(tree, "a2")).toBe("a2")
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: 2 files, 8 tests passed.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run lint
git add src/lib/session-types.ts src/lib/fold.ts src/lib/tree.ts src/lib/fold.test.ts src/lib/tree.test.ts
git commit -m "feat(client): mirror session types, fold and tree helpers with tests"
```

---

### Task 4: The session API client, with a reconnecting stream

**Files:**
- Modify: `client/src/lib/agent-client.ts`
- Create: `client/src/lib/session-client.ts`

- [ ] **Step 1: Export the shared helpers from `agent-client.ts`**

Read the file. Make these exact changes:

1. `const endpoint = …` → `export const endpoint = …`
2. `const describeFailure = …` → `export const describeFailure = …`
3. `const wait = …` → `export const wait = …`
4. Make `forwardEvents` and `drain` generic and exported. Replace their definitions with:

```ts
/** Parse `data:` lines out of one SSE message and forward them. */
export const forwardEvents = <T>(chunk: string, onEvent: (event: T) => void) => {
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data:")) continue
    onEvent(JSON.parse(line.slice(5).trim()) as T)
  }
}

/** Drain one SSE body, forwarding every event until the stream ends. */
export const drain = async <T>(
  body: ReadableStream<Uint8Array>,
  handle: (event: T) => void
): Promise<void> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf("\n\n")
    while (boundary !== -1) {
      forwardEvents<T>(buffer.slice(0, boundary), handle)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf("\n\n")
    }
  }
  if (buffer.trim()) forwardEvents<T>(buffer, handle)
}
```

The existing callers (`streamRun`, `replayRun`) pass a handler typed `(event: RunEvent) => void`, so `T` is inferred and they need no change.

- [ ] **Step 2: Write the session client**

```ts
// client/src/lib/session-client.ts
// HTTP client for /api/sessions/* (src/session/routes.ts in the harness).
import { describeFailure, drain, endpoint, wait } from "./agent-client"
import type {
  Session,
  SessionEvent,
  SessionSnapshot,
  SessionSummary,
  StartedTurn,
} from "./session-types"

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

const jsonHeaders = { "Content-Type": "application/json" }

/** fetch that turns network failures into the panel's standard message. */
const call = async (base: string, path: string, init?: RequestInit): Promise<Response> => {
  try {
    return await fetch(endpoint(base, path), init)
  } catch (error) {
    throw new Error(describeFailure(error), { cause: error })
  }
}

const expectOk = async (res: Response, what: string): Promise<Response> => {
  if (res.ok) return res
  const text = await res.text().catch(() => "")
  throw new Error(`Harness ${what} failed (${res.status})${text ? `: ${text}` : ""}`)
}

export const listSessions = async (base: string): Promise<SessionSummary[]> => {
  const res = await expectOk(await call(base, "/api/sessions"), "session list")
  return (await res.json()) as SessionSummary[]
}

export const createSession = async (
  base: string,
  input: { title?: string } = {}
): Promise<Session> => {
  const res = await expectOk(
    await call(base, "/api/sessions", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    }),
    "session create"
  )
  return (await res.json()) as Session
}

export const getSession = async (
  base: string,
  id: string
): Promise<SessionSnapshot> => {
  const res = await expectOk(await call(base, `/api/sessions/${id}`), "session load")
  return (await res.json()) as SessionSnapshot
}

export const renameSession = async (
  base: string,
  id: string,
  title: string
): Promise<Session> => {
  const res = await expectOk(
    await call(base, `/api/sessions/${id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ title }),
    }),
    "session rename"
  )
  return (await res.json()) as Session
}

export const deleteSession = async (base: string, id: string): Promise<void> => {
  await expectOk(
    await call(base, `/api/sessions/${id}`, { method: "DELETE" }),
    "session delete"
  )
}

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

export const cancelSession = async (base: string, id: string): Promise<boolean> => {
  try {
    const res = await call(base, `/api/sessions/${id}/cancel`, { method: "POST" })
    return res.ok
  } catch {
    return false
  }
}

export const replySessionPermission = async (
  base: string,
  sessionId: string,
  requestId: string,
  decision: "allow" | "deny" | "always"
): Promise<boolean> => {
  try {
    const res = await call(base, `/api/sessions/${sessionId}/permission/${requestId}`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ decision }),
    })
    return res.ok
  } catch {
    return false
  }
}

const backoff = (attempt: number): number =>
  Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)

/**
 * Follow a session's event stream from `after`, reconnecting with backoff
 * whenever the connection drops, until `signal` aborts or the session is gone.
 * The harness keeps session streams open across turns, so a normal end of
 * body means the connection was lost, not that anything finished.
 */
export const streamSession = async (
  base: string,
  sessionId: string,
  after: number,
  onEvent: (event: SessionEvent) => void,
  signal: AbortSignal
): Promise<void> => {
  let lastSeq = after
  let attempt = 0

  while (!signal.aborted) {
    let res: Response
    try {
      res = await fetch(
        endpoint(base, `/api/sessions/${sessionId}/events?after=${lastSeq}`),
        { signal }
      )
    } catch {
      if (signal.aborted) return
      await wait(backoff(attempt++), signal).catch(() => {})
      continue
    }
    if (res.status === 404) return // the session was deleted; stop for good
    if (!res.ok || !res.body) {
      await wait(backoff(attempt++), signal).catch(() => {})
      continue
    }

    attempt = 0
    try {
      await drain<SessionEvent>(res.body, (event) => {
        if (event.seq > lastSeq) lastSeq = event.seq
        onEvent(event)
      })
    } catch {
      if (signal.aborted) return
    }
    if (signal.aborted) return
    await wait(backoff(attempt++), signal).catch(() => {})
  }
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/lib/agent-client.ts src/lib/session-client.ts
git commit -m "feat(client): session API client with a reconnecting event stream"
```

---

### Task 5: The session store — reducer, event fold, provider

**Files:**
- Create: `client/src/lib/session-store.tsx`
- Create: `client/src/lib/session-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/lib/session-store.test.ts
import { describe, expect, it } from "vitest"

import {
  foldSessionEvent,
  loadedFromSnapshot,
  reducer,
  type LoadedSession,
  type State,
} from "./session-store"
import type { ChatMessage, Session, SessionEvent, SessionSnapshot } from "./session-types"

const session = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  title: "New chat",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "idle",
  headId: null,
  queue: [],
  defaults: {},
  ...over,
})

const user: ChatMessage = {
  id: "u1",
  sessionId: "s1",
  parentId: null,
  role: "user",
  parts: [{ type: "text", text: "hi" }],
  turnId: "t1",
  createdAt: "2026-01-01T00:00:01Z",
}

const loaded = (over: Partial<LoadedSession> = {}): LoadedSession => ({
  session: session(),
  messages: [],
  turns: [],
  lastSeq: 0,
  permissions: [],
  ...over,
})

const ev = <T extends SessionEvent["type"]>(
  seq: number,
  body: Extract<SessionEvent, { type: T }> extends infer E
    ? Omit<E, "sessionId" | "seq">
    : never
): SessionEvent => ({ ...body, sessionId: "s1", seq }) as SessionEvent

describe("foldSessionEvent", () => {
  it("tracks the highest seq seen", () => {
    const next = foldSessionEvent(loaded(), ev(7, { type: "step.start", step: 1 }))
    expect(next.lastSeq).toBe(7)
    expect(foldSessionEvent(next, ev(3, { type: "step.start", step: 2 })).lastSeq).toBe(7)
  })

  it("appends a created user message and moves head to it", () => {
    const next = foldSessionEvent(loaded(), ev(1, { type: "message.created", message: user }))
    expect(next.messages).toEqual([user])
    expect(next.session.headId).toBe("u1")
  })

  it("opens a live turn with an empty assistant shell on run.start", () => {
    const next = foldSessionEvent(
      loaded({ messages: [user] }),
      ev(2, {
        type: "run.start",
        runId: "t1",
        query: "hi",
        model: "m",
        startedAt: "2026-01-01T00:00:02Z",
        sessionId: "s1",
        turnId: "t1",
        userMessageId: "u1",
        assistantMessageId: "a1",
      })
    )
    expect(next.session.status).toBe("running")
    expect(next.liveTurn?.assistant).toMatchObject({
      id: "a1",
      parentId: "u1",
      role: "assistant",
      parts: [],
    })
    expect(next.lastError).toBeUndefined()
  })

  it("folds turn events into the live assistant", () => {
    let state = foldSessionEvent(
      loaded({ messages: [user] }),
      ev(2, {
        type: "run.start", runId: "t1", query: "hi", model: "m",
        startedAt: "x", turnId: "t1", userMessageId: "u1", assistantMessageId: "a1",
      })
    )
    state = foldSessionEvent(state, ev(3, { type: "assistant.delta", step: 1, text: "He" }))
    state = foldSessionEvent(state, ev(4, { type: "assistant.delta", step: 1, text: "llo" }))
    expect(state.liveTurn?.assistant.parts).toEqual([{ type: "text", text: "Hello" }])
  })

  it("keeps pending permissions until they resolve", () => {
    let state = foldSessionEvent(
      loaded(),
      ev(5, { type: "permission.ask", step: 1, id: "p1", tool: "shell", args: { command: "ls" } })
    )
    expect(state.permissions).toHaveLength(1)
    state = foldSessionEvent(
      state,
      ev(6, { type: "permission.resolved", step: 1, id: "p1", tool: "shell", decision: "allow" })
    )
    expect(state.permissions).toEqual([])
  })

  it("records a failure on run.end and clears it on the next run.start", () => {
    let state = foldSessionEvent(
      loaded(),
      ev(8, { type: "run.end", status: "failed", error: "boom", durationMs: 1, steps: 1 })
    )
    expect(state.lastError).toBe("boom")
    state = foldSessionEvent(
      state,
      ev(9, {
        type: "run.start", runId: "t2", query: "again", model: "m",
        startedAt: "x", turnId: "t2", userMessageId: "u2", assistantMessageId: "a2",
      })
    )
    expect(state.lastError).toBeUndefined()
  })

  it("replaces the live fold with the completed message and clears the live turn", () => {
    const completed: ChatMessage = {
      id: "a1", sessionId: "s1", parentId: "u1", role: "assistant", turnId: "t1",
      parts: [{ type: "text", text: "Hello, world" }], createdAt: "x",
    }
    let state = foldSessionEvent(
      loaded({ messages: [user] }),
      ev(2, {
        type: "run.start", runId: "t1", query: "hi", model: "m",
        startedAt: "x", turnId: "t1", userMessageId: "u1", assistantMessageId: "a1",
      })
    )
    state = foldSessionEvent(state, ev(3, { type: "assistant.delta", step: 1, text: "Hel" }))
    state = foldSessionEvent(state, ev(4, { type: "message.completed", message: completed }))
    expect(state.liveTurn).toBeUndefined()
    expect(state.messages.map((m) => m.id)).toEqual(["u1", "a1"])
    expect(state.messages[1].parts).toEqual([{ type: "text", text: "Hello, world" }])
    expect(state.session.headId).toBe("a1")
  })

  it("applies session.updated patches", () => {
    const state = foldSessionEvent(
      loaded(),
      ev(10, { type: "session.updated", patch: { title: "Renamed", status: "idle" } })
    )
    expect(state.session.title).toBe("Renamed")
  })
})

describe("loadedFromSnapshot", () => {
  it("carries the live turn and its pending permissions", () => {
    const snapshot: SessionSnapshot = {
      session: session({ status: "running", headId: "u1" }),
      messages: [user],
      turns: [],
      seq: 12,
      liveTurn: {
        turnId: "t1",
        assistant: { id: "a1", sessionId: "s1", parentId: "u1", role: "assistant", parts: [], createdAt: "x" },
        pendingPermissions: [{ id: "p1", step: 1, tool: "shell", args: {} }],
      },
    }
    const state = loadedFromSnapshot(snapshot)
    expect(state.lastSeq).toBe(12)
    expect(state.liveTurn?.status).toBe("running")
    expect(state.permissions).toHaveLength(1)
  })

  it("surfaces the last turn's error when it failed", () => {
    const state = loadedFromSnapshot({
      session: session(),
      messages: [],
      turns: [
        {
          id: "t1", sessionId: "s1", userMessageId: "u1", assistantMessageId: "a1",
          model: "m", status: "failed", error: "quota", startedAt: "x", durationMs: 1,
        },
      ],
      seq: 3,
    })
    expect(state.lastError).toBe("quota")
  })
})

describe("reducer", () => {
  const base: State = {
    summaries: [
      { id: "s1", title: "A", createdAt: "x", updatedAt: "x", status: "idle", messageCount: 0 },
    ],
    loaded: { s1: loaded() },
    selectedId: "s1",
    drafts: { s1: "draft" },
    listStatus: "ready",
  }

  it("removing the selected session clears the selection and its state", () => {
    const next = reducer(base, { type: "sessions/remove", id: "s1" })
    expect(next.selectedId).toBeNull()
    expect(next.summaries).toEqual([])
    expect(next.loaded.s1).toBeUndefined()
    expect(next.drafts.s1).toBeUndefined()
  })

  it("keeps the summary list in step with title changes from events", () => {
    const next = reducer(base, {
      type: "session/event",
      id: "s1",
      event: ev(1, { type: "session.updated", patch: { title: "Renamed" } }),
    })
    expect(next.summaries[0].title).toBe("Renamed")
  })

  it("ignores events for a session that is not loaded", () => {
    const next = reducer(base, {
      type: "session/event",
      id: "other",
      event: ev(1, { type: "step.start", step: 1 }),
    })
    expect(next).toBe(base)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `./session-store`.

- [ ] **Step 3: Write the store**

```tsx
/* eslint-disable react-refresh/only-export-components */
// client/src/lib/session-store.tsx
// Chat state: the session list, loaded session snapshots, and the fold of
// live SessionEvents into them. Sessions live on the harness; this store is a
// cache plus per-viewer UI state (which session is open, unsent drafts).
import * as React from "react"

import { foldTurnEvent } from "./fold"
import type {
  ChatMessage,
  SessionEvent,
  SessionSnapshot,
  SessionSummary,
  Turn,
  TurnStatus,
} from "./session-types"
import type { PendingPermission, RunUsage } from "./types"

const STORAGE_KEY = "dulo:chat:v1"

export interface LiveTurnState {
  turnId: string
  assistant: ChatMessage
  status: TurnStatus
}

export interface LoadedSession {
  session: SessionSnapshot["session"]
  messages: ChatMessage[]
  turns: Turn[]
  /** Highest seq seen; a reconnect resumes from here. */
  lastSeq: number
  liveTurn?: LiveTurnState
  /** Gated tool calls waiting on the user. */
  permissions: PendingPermission[]
  /** Error of the most recent turn if it failed; cleared when a new one starts. */
  lastError?: string
  lastUsage?: RunUsage
}

export interface State {
  summaries: SessionSummary[]
  loaded: Record<string, LoadedSession>
  selectedId: string | null
  /** Unsent composer text per session. */
  drafts: Record<string, string>
  listStatus: "idle" | "loading" | "ready" | "error"
  listError?: string
}

export type Action =
  | { type: "sessions/loading" }
  | { type: "sessions/set"; summaries: SessionSummary[] }
  | { type: "sessions/error"; error: string }
  | { type: "sessions/upsert"; summary: SessionSummary }
  | { type: "sessions/remove"; id: string }
  | { type: "session/loaded"; snapshot: SessionSnapshot }
  | { type: "session/event"; id: string; event: SessionEvent }
  | { type: "session/select"; id: string | null }
  | { type: "draft/set"; id: string; text: string }

const upsertMessage = (messages: ChatMessage[], message: ChatMessage): ChatMessage[] =>
  messages.some((m) => m.id === message.id)
    ? messages.map((m) => (m.id === message.id ? message : m))
    : [...messages, message]

/** Fold one stream event into a loaded session. Pure; returns a new object. */
export const foldSessionEvent = (
  loaded: LoadedSession,
  event: SessionEvent
): LoadedSession => {
  const base: LoadedSession = { ...loaded, lastSeq: Math.max(loaded.lastSeq, event.seq) }

  switch (event.type) {
    case "message.created":
      return {
        ...base,
        messages: upsertMessage(base.messages, event.message),
        session: { ...base.session, headId: event.message.id },
      }

    case "run.start": {
      // A legacy run.start without session fields cannot seed a shell; ignore.
      if (!event.assistantMessageId) return base
      const turnId = event.turnId ?? event.runId
      return {
        ...base,
        session: { ...base.session, status: "running" },
        permissions: [],
        lastError: undefined,
        liveTurn: {
          turnId,
          status: "running",
          assistant: {
            id: event.assistantMessageId,
            sessionId: event.sessionId,
            parentId: event.userMessageId ?? null,
            role: "assistant",
            parts: [],
            turnId,
            createdAt: event.startedAt,
          },
        },
      }
    }

    case "assistant.delta":
    case "assistant":
    case "tool.call":
    case "tool.result":
      return base.liveTurn
        ? {
            ...base,
            liveTurn: {
              ...base.liveTurn,
              assistant: foldTurnEvent(base.liveTurn.assistant, event),
            },
          }
        : base

    case "permission.ask":
      return {
        ...base,
        permissions: [
          ...base.permissions.filter((p) => p.id !== event.id),
          { id: event.id, step: event.step, tool: event.tool, args: event.args },
        ],
      }

    case "permission.resolved":
      return { ...base, permissions: base.permissions.filter((p) => p.id !== event.id) }

    case "run.end":
      return {
        ...base,
        permissions: [],
        lastError: event.status === "failed" ? (event.error ?? "The turn failed") : undefined,
        lastUsage: event.usage ?? base.lastUsage,
        liveTurn: base.liveTurn ? { ...base.liveTurn, status: event.status } : undefined,
      }

    case "message.completed":
      // The server's fold is authoritative; it replaces whatever we built live.
      return {
        ...base,
        messages: upsertMessage(base.messages, event.message),
        liveTurn: undefined,
        session: { ...base.session, headId: event.message.id },
      }

    case "session.updated":
      return { ...base, session: { ...base.session, ...event.patch } }

    case "queue.updated":
      return { ...base, session: { ...base.session, queue: event.queue } }

    default:
      return base
  }
}

/** Build the loaded state from GET /api/sessions/:id. */
export const loadedFromSnapshot = (snapshot: SessionSnapshot): LoadedSession => {
  const last = snapshot.turns[snapshot.turns.length - 1]
  return {
    session: snapshot.session,
    messages: snapshot.messages,
    turns: snapshot.turns,
    lastSeq: snapshot.seq,
    liveTurn: snapshot.liveTurn
      ? {
          turnId: snapshot.liveTurn.turnId,
          assistant: snapshot.liveTurn.assistant,
          status: "running",
        }
      : undefined,
    permissions: snapshot.liveTurn?.pendingPermissions ?? [],
    lastError: last?.status === "failed" ? last.error : undefined,
    lastUsage: last?.usage,
  }
}

const withoutKey = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record
  return rest
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "sessions/loading":
      return { ...state, listStatus: "loading", listError: undefined }
    case "sessions/set":
      return { ...state, summaries: action.summaries, listStatus: "ready", listError: undefined }
    case "sessions/error":
      return { ...state, listStatus: "error", listError: action.error }
    case "sessions/upsert":
      return {
        ...state,
        summaries: [
          action.summary,
          ...state.summaries.filter((s) => s.id !== action.summary.id),
        ],
      }
    case "sessions/remove":
      return {
        ...state,
        summaries: state.summaries.filter((s) => s.id !== action.id),
        loaded: withoutKey(state.loaded, action.id),
        drafts: withoutKey(state.drafts, action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      }
    case "session/loaded":
      return {
        ...state,
        loaded: {
          ...state.loaded,
          [action.snapshot.session.id]: loadedFromSnapshot(action.snapshot),
        },
      }
    case "session/event": {
      const current = state.loaded[action.id]
      if (!current) return state
      const next = foldSessionEvent(current, action.event)
      return {
        ...state,
        loaded: { ...state.loaded, [action.id]: next },
        summaries: state.summaries.map((s) =>
          s.id === action.id
            ? { ...s, title: next.session.title, status: next.session.status }
            : s
        ),
      }
    }
    case "session/select":
      return { ...state, selectedId: action.id }
    case "draft/set":
      return { ...state, drafts: { ...state.drafts, [action.id]: action.text } }
  }
}

interface Persisted {
  selectedId: string | null
  drafts: Record<string, string>
}

const loadPersisted = (): Persisted | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Persisted) : null
  } catch {
    return null
  }
}

const initialState = (): State => {
  const persisted = loadPersisted()
  return {
    summaries: [],
    loaded: {},
    selectedId: persisted?.selectedId ?? null,
    drafts: persisted?.drafts ?? {},
    listStatus: "idle",
  }
}

interface StoreValue {
  state: State
  dispatch: React.Dispatch<Action>
}

const SessionStoreContext = React.createContext<StoreValue | undefined>(undefined)

export function SessionStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initialState)

  React.useEffect(() => {
    const persisted: Persisted = { selectedId: state.selectedId, drafts: state.drafts }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      // Storage can be unavailable (private mode); the page still works in memory.
    }
  }, [state.selectedId, state.drafts])

  const value = React.useMemo(() => ({ state, dispatch }), [state])

  return (
    <SessionStoreContext.Provider value={value}>{children}</SessionStoreContext.Provider>
  )
}

export const useSessionStore = (): StoreValue => {
  const context = React.useContext(SessionStoreContext)
  if (context === undefined) {
    throw new Error("useSessionStore must be used within a SessionStoreProvider")
  }
  return context
}
```

Note on `withoutKey`: the `_removed` binding is intentionally unused. If `tsc` reports it under `noUnusedLocals`, rename it to `_` and add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` above the line, or replace the helper body with `Object.fromEntries(Object.entries(record).filter(([k]) => k !== key)) as Record<string, T>` — either is fine; keep the function pure.

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: 3 files, 21 tests passed.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint
git add src/lib/session-store.tsx src/lib/session-store.test.ts
git commit -m "feat(client): session store folding stream events into snapshots"
```

---

### Task 6: Shared components — move `PermissionPrompt` and `TodoList`, add `MarkdownContent`

The Playground defines two components the chat needs. Moving them is a pure refactor: the Playground must behave identically afterwards.

**Files:**
- Create: `client/src/components/permission-prompt.tsx`, `client/src/components/todo-list.tsx`, `client/src/components/markdown.tsx`
- Modify: `client/src/pages/playground.tsx`

- [ ] **Step 1: Move `PermissionPrompt`**

Read `src/pages/playground.tsx`. Cut the whole `function PermissionPrompt(…) { … }` (it starts near line 93) and paste it, with `export` added, into a new file. The result must be:

```tsx
// client/src/components/permission-prompt.tsx
import { CodeBlock } from "@/components/code-block"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatJson } from "@/lib/format"
import type { PendingPermission } from "@/lib/types"

export type PermissionChoice = "allow" | "deny" | "always"

/** A gated tool is paused until the user answers. */
export function PermissionPrompt({
  permission,
  onDecide,
}: {
  permission: PendingPermission
  onDecide: (decision: PermissionChoice) => void
}) {
  return (
    <Alert>
      <AlertTitle className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="outline">{permission.tool}</Badge>
        wants to run
      </AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-3">
        <CodeBlock>{formatJson(permission.args)}</CodeBlock>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecide("allow")}>
            Allow once
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide("always")}>
            Always in this run
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide("deny")}>
            Deny
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
```

If the body in `playground.tsx` differs from this in any detail, keep the Playground's version — the goal is a move, not a rewrite.

- [ ] **Step 2: Move `TodoList`**

Same for `function TodoList({ text }: { text: string })` (near line 63):

```tsx
// client/src/components/todo-list.tsx
/** manage_todos returns a checklist; showing it as one beats raw JSON. */
export function TodoList({ text }: { text: string }) {
  const [summary, ...items] = text.split("\n")
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{summary}</span>
      <ul className="flex min-w-0 flex-col gap-1">
        {items.map((line, i) => {
          const done = line.startsWith("[x]")
          const active = line.startsWith("[~]")
          return (
            <li
              key={i}
              className={
                "flex min-w-0 items-start gap-2 text-sm " +
                (done ? "text-muted-foreground line-through" : "")
              }
            >
              <span aria-hidden className="font-mono text-xs leading-5">
                {done ? "✓" : active ? "▸" : "○"}
              </span>
              <span className="min-w-0 break-words">{line.slice(4)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Update the Playground imports**

In `src/pages/playground.tsx`, add:

```tsx
import { PermissionPrompt } from "@/components/permission-prompt"
import { TodoList } from "@/components/todo-list"
```

and remove any import that is now unused because the two functions left the file (typecheck will tell you which — likely none, since the Playground still uses `Alert`, `Badge`, `Button`, `CodeBlock` and `formatJson` elsewhere).

- [ ] **Step 4: Write the Markdown component**

```tsx
// client/src/components/markdown.tsx
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { CodeBlock } from "@/components/code-block"

const components: Components = {
  // Fenced blocks arrive as <pre><code>. `code` renders the block itself, so
  // <pre> becomes a passthrough to avoid a box inside a box.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? "")
    const isBlock = /language-/.test(className ?? "") || text.includes("\n")
    if (isBlock) {
      return (
        <CodeBlock className="max-h-96 border bg-muted/40 p-3">
          {text.replace(/\n$/, "")}
        </CodeBlock>
      )
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    )
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ),
}

/**
 * Assistant text as Markdown. Typography is applied to the wrapper with
 * descendant selectors — the project has no typography plugin, and this keeps
 * every colour a semantic token.
 */
export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm/relaxed wrap-break-word [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:w-full [&_table]:text-left [&_th]:border-b [&_th]:pb-1 [&_th]:font-medium [&_td]:border-b [&_td]:py-1 [&_hr]:border-border">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  )
}
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run build && npm test
git add src/components/permission-prompt.tsx src/components/todo-list.tsx src/components/markdown.tsx src/pages/playground.tsx
git commit -m "refactor(client): share PermissionPrompt and TodoList; add Markdown renderer"
```

---

### Task 7: The message components — tool activity, assistant, user, thread

**Files:**
- Create: `client/src/components/chat/tool-activity.tsx`, `assistant-message.tsx`, `user-message.tsx`, `message-thread.tsx`
- Create: `client/src/components/chat/segments.test.ts`

- [ ] **Step 1: Write the failing test for part grouping**

```ts
// client/src/components/chat/segments.test.ts
import { describe, expect, it } from "vitest"

import { segmentsOf } from "./assistant-message"
import type { Part } from "@/lib/session-types"

describe("segmentsOf", () => {
  it("pairs each tool call with its result and keeps text runs in order", () => {
    const parts: Part[] = [
      { type: "text", text: "Let me check." },
      { type: "tool_call", callId: "c1", tool: "get_current_time", args: {} },
      {
        type: "tool_result", callId: "c1", tool: "get_current_time",
        result: "10:00", isError: false, durationMs: 2,
      },
      { type: "text", text: "It is 10:00." },
    ]
    const segments = segmentsOf(parts)
    expect(segments.map((s) => s.kind)).toEqual(["text", "tool", "text"])
    expect(segments[1]).toMatchObject({ kind: "tool", result: { result: "10:00" } })
  })

  it("leaves a tool call without a result unpaired (still running)", () => {
    const segments = segmentsOf([
      { type: "tool_call", callId: "c1", tool: "shell", args: { command: "ls" } },
    ])
    expect(segments).toEqual([
      { kind: "tool", call: { type: "tool_call", callId: "c1", tool: "shell", args: { command: "ls" } }, result: undefined },
    ])
  })

  it("merges adjacent text parts", () => {
    const segments = segmentsOf([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ])
    expect(segments).toEqual([{ kind: "text", text: "ab" }])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `./assistant-message`.

- [ ] **Step 3: Tool activity**

```tsx
// client/src/components/chat/tool-activity.tsx
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { CodeBlock } from "@/components/code-block"
import { TodoList } from "@/components/todo-list"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { formatDuration, formatJson } from "@/lib/format"
import type { ToolCallPart, ToolResultPart } from "@/lib/session-types"

/** One tool call and, once it has one, its result. Closed by default. */
export function ToolActivity({
  call,
  result,
}: {
  call: ToolCallPart
  result?: ToolResultPart
}) {
  const argsPreview = formatJson(call.args).replace(/\s+/g, " ")
  return (
    <Collapsible className="min-w-0 rounded-md border bg-muted/30">
      <CollapsibleTrigger className="group/trigger flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs">
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="shrink-0 transition-transform group-data-[panel-open]/trigger:rotate-90"
        />
        <Badge variant={result?.isError ? "destructive" : "outline"}>{call.tool}</Badge>
        {result ? (
          <span className="text-muted-foreground tabular-nums">
            {formatDuration(result.durationMs)}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Spinner />
            running
          </span>
        )}
        <code className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
          {argsPreview}
        </code>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex min-w-0 flex-col gap-2 border-t px-3 py-2">
        <CodeBlock>{formatJson(call.args)}</CodeBlock>
        {result &&
          (call.tool === "manage_todos" && !result.isError ? (
            <TodoList text={result.result} />
          ) : (
            <CodeBlock>{result.result}</CodeBlock>
          ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
```

If the chevron does not rotate when opened, inspect the trigger element in the browser: Base UI marks the open trigger with `data-panel-open`; if this project's build uses a different attribute, adjust the `group-data-[…]` selector to match what you see.

- [ ] **Step 4: Assistant message**

```tsx
// client/src/components/chat/assistant-message.tsx
import * as React from "react"

import { ToolActivity } from "@/components/chat/tool-activity"
import { MarkdownContent } from "@/components/markdown"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import type {
  ChatMessage,
  Part,
  ToolCallPart,
  ToolResultPart,
} from "@/lib/session-types"

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "tool"; call: ToolCallPart; result?: ToolResultPart }

/** Group ordered parts into what the thread renders. Pure. */
export const segmentsOf = (parts: readonly Part[]): Segment[] => {
  const results = new Map(
    parts
      .filter((p): p is ToolResultPart => p.type === "tool_result")
      .map((p) => [p.callId, p])
  )
  return parts.reduce<Segment[]>((segments, part) => {
    if (part.type === "text") {
      const last = segments[segments.length - 1]
      if (last?.kind === "text") {
        return [...segments.slice(0, -1), { kind: "text", text: last.text + part.text }]
      }
      return [...segments, { kind: "text", text: part.text }]
    }
    if (part.type === "tool_call") {
      return [...segments, { kind: "tool", call: part, result: results.get(part.callId) }]
    }
    // tool_result parts are attached to their call above; attachments never
    // appear on assistant messages.
    return segments
  }, [])
}

/**
 * An assistant turn as one bubble: text as Markdown, tools as collapsible
 * rows, in the order they happened. `ghost` removes the bubble surface, which
 * is how a chat assistant reads best — the user's side keeps the colour.
 */
export function AssistantMessage({
  message,
  live,
  footer,
}: {
  message: ChatMessage
  /** True while this message is still being written. */
  live: boolean
  footer?: React.ReactNode
}) {
  const segments = segmentsOf(message.parts)
  return (
    <Message align="start">
      <MessageContent>
        <Bubble variant="ghost" align="start">
          <BubbleContent className="flex w-full min-w-0 flex-col gap-3">
            {segments.length === 0 && live && (
              <span className="shimmer text-muted-foreground">Thinking…</span>
            )}
            {segments.map((segment, i) =>
              segment.kind === "text" ? (
                <MarkdownContent key={`text-${i}`} text={segment.text} />
              ) : (
                <ToolActivity
                  key={segment.call.callId}
                  call={segment.call}
                  result={segment.result}
                />
              )
            )}
          </BubbleContent>
        </Bubble>
        {footer && <MessageFooter>{footer}</MessageFooter>}
      </MessageContent>
    </Message>
  )
}
```

- [ ] **Step 5: User message**

```tsx
// client/src/components/chat/user-message.tsx
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import type { ChatMessage } from "@/lib/session-types"

/** The user's text, right-aligned. Attachment chips arrive in Plan 5. */
export function UserMessage({ message }: { message: ChatMessage }) {
  const text = message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
  return (
    <Message align="end">
      <MessageContent>
        <Bubble variant="default" align="end">
          <BubbleContent className="text-sm/relaxed whitespace-pre-wrap">{text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
```

- [ ] **Step 6: The thread**

```tsx
// client/src/components/chat/message-thread.tsx
import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatIcon } from "@hugeicons/core-free-icons"

import { AssistantMessage } from "@/components/chat/assistant-message"
import { UserMessage } from "@/components/chat/user-message"
import { PermissionPrompt, type PermissionChoice } from "@/components/permission-prompt"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import type { ChatMessage } from "@/lib/session-types"
import type { PendingPermission } from "@/lib/types"

interface MessageThreadProps {
  /** Completed messages on the current branch, root first. */
  messages: ChatMessage[]
  /** The assistant message being written right now, if any. */
  liveAssistant?: ChatMessage
  permissions: PendingPermission[]
  lastError?: string
  onDecide: (requestId: string, decision: PermissionChoice) => void
}

/**
 * The conversation. MessageScroller owns following the live edge, holding the
 * user's turn in view, and the jump-to-latest button — nothing here touches
 * scrollTop.
 */
export function MessageThread({
  messages,
  liveAssistant,
  permissions,
  lastError,
  onDecide,
}: MessageThreadProps) {
  const empty = messages.length === 0 && !liveAssistant
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport className="px-1">
          <MessageScrollerContent className="mx-auto w-full max-w-3xl py-4">
            {empty && (
              <MessageScrollerItem messageId="empty">
                <Empty className="min-h-60">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={BubbleChatIcon} />
                    </EmptyMedia>
                    <EmptyTitle>Start the conversation</EmptyTitle>
                    <EmptyDescription>
                      Ask something. The agent keeps everything in this session in
                      mind for your next message.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            )}
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                {message.role === "user" ? (
                  <UserMessage message={message} />
                ) : (
                  <AssistantMessage message={message} live={false} />
                )}
              </MessageScrollerItem>
            ))}
            {liveAssistant && (
              <MessageScrollerItem key={liveAssistant.id} messageId={liveAssistant.id}>
                <AssistantMessage message={liveAssistant} live />
              </MessageScrollerItem>
            )}
            {permissions.map((permission) => (
              <MessageScrollerItem key={permission.id} messageId={`permission-${permission.id}`}>
                <PermissionPrompt
                  permission={permission}
                  onDecide={(decision) => onDecide(permission.id, decision)}
                />
              </MessageScrollerItem>
            ))}
            {lastError && (
              <MessageScrollerItem messageId="turn-error">
                <Alert variant="destructive">
                  <AlertTitle>The turn failed</AlertTitle>
                  <AlertDescription>{lastError}</AlertDescription>
                </Alert>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
```

- [ ] **Step 7: Run to verify pass**

Run: `npm test`
Expected: 4 files, 24 tests passed.

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run build
git add src/components/chat/tool-activity.tsx src/components/chat/assistant-message.tsx src/components/chat/user-message.tsx src/components/chat/message-thread.tsx src/components/chat/segments.test.ts
git commit -m "feat(client): message thread on shadcn chat primitives with Markdown and tool activity"
```

---

### Task 8: Session list, composer, and the Chat page

**Files:**
- Create: `client/src/components/chat/session-list.tsx`, `client/src/components/chat/composer.tsx`
- Modify: `client/src/pages/chat.tsx` (replace the placeholder), `client/src/main.tsx`

- [ ] **Step 1: Session list**

```tsx
// client/src/components/chat/session-list.tsx
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { formatRelative } from "@/lib/format"
import type { SessionSummary } from "@/lib/session-types"

interface SessionListProps {
  sessions: SessionSummary[]
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

export function SessionList({
  sessions,
  selectedId,
  loading,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SessionListProps) {
  const [renaming, setRenaming] = React.useState<SessionSummary | null>(null)
  const [deleting, setDeleting] = React.useState<SessionSummary | null>(null)
  const [title, setTitle] = React.useState("")

  const openRename = (session: SessionSummary) => {
    setTitle(session.title)
    setRenaming(session)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <Button variant="outline" onClick={onCreate}>
        <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
        New chat
      </Button>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
        {loading && sessions.length === 0 && (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        )}
        {!loading && sessions.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">No chats yet.</p>
        )}
        {sessions.map((session) => (
          <div key={session.id} className="group/row flex min-w-0 items-center gap-1">
            <Button
              variant={session.id === selectedId ? "secondary" : "ghost"}
              className="h-auto min-w-0 flex-1 justify-start py-2 text-left"
              onClick={() => onSelect(session.id)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate">{session.title}</span>
                <span className="flex items-center gap-1 text-[0.625rem] text-muted-foreground">
                  {session.status === "running" && <Spinner />}
                  {formatRelative(session.updatedAt)}
                </span>
              </div>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${session.title}`}
                  />
                }
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => openRename(session)}>Rename</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(session)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>The title is only a label; it does not change the conversation.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (renaming && title.trim()) onRename(renaming.id, title.trim())
              setRenaming(null)
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="session-title">Title</FieldLabel>
                <Input
                  id="session-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  autoFocus
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this chat?</DialogTitle>
            <DialogDescription>
              “{deleting?.title}” and every message in it will be removed from the harness.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) onDelete(deleting.id)
                setDeleting(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

If `DropdownMenuItem` in this project's `dropdown-menu.tsx` has no `variant` prop, drop `variant="destructive"` and leave the item plain. If `Dialog`'s `onOpenChange` is typed with a second argument, the `(open) => …` callback still type-checks.

- [ ] **Step 2: Composer**

```tsx
// client/src/components/chat/composer.tsx
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { SentIcon, StopIcon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"

interface ComposerProps {
  value: string
  onChange: (text: string) => void
  onSend: () => void
  onStop: () => void
  /** A turn is running: show Stop, keep the input live for the next message. */
  running: boolean
  /** Why sending is unavailable (offline, no session); disables Send. */
  disabledReason?: string
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabledReason,
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

- [ ] **Step 3: Replace the Chat page**

Overwrite `client/src/pages/chat.tsx`:

```tsx
// client/src/pages/chat.tsx
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Menu01Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { Composer } from "@/components/chat/composer"
import { MessageThread } from "@/components/chat/message-thread"
import { SessionList } from "@/components/chat/session-list"
import { useHealth } from "@/components/health-provider"
import type { PermissionChoice } from "@/components/permission-prompt"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { CONNECTION_HINT } from "@/lib/agent-client"
import {
  cancelSession,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  renameSession,
  replySessionPermission,
  sendMessage,
  streamSession,
} from "@/lib/session-client"
import { useSessionStore } from "@/lib/session-store"
import { useStore } from "@/lib/store"
import { pathToHead } from "@/lib/tree"

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function ChatPage() {
  const { state: app } = useStore()
  const health = useHealth()
  const { state, dispatch } = useSessionStore()
  const base = app.settings.apiBaseUrl
  const online = health.status === "online"
  const [listOpen, setListOpen] = React.useState(false)

  const selected = state.selectedId ? state.loaded[state.selectedId] : undefined
  const selectedId = state.selectedId

  // ---- session list: on mount, when the harness comes online, on focus ----
  const refreshList = React.useCallback(() => {
    dispatch({ type: "sessions/loading" })
    void listSessions(base)
      .then((summaries) => dispatch({ type: "sessions/set", summaries }))
      .catch((error) => dispatch({ type: "sessions/error", error: describe(error) }))
  }, [base, dispatch])

  React.useEffect(() => {
    if (!online) return
    // Dispatch happens inside the promise, not synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshList()
    const onFocus = () => refreshList()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [online, refreshList])

  // ---- load the selected session's snapshot once -------------------------
  React.useEffect(() => {
    if (!online || !selectedId || state.loaded[selectedId]) return
    let cancelled = false
    void getSession(base, selectedId)
      .then((snapshot) => {
        if (!cancelled) dispatch({ type: "session/loaded", snapshot })
      })
      .catch((error) => {
        if (cancelled) return
        toast.error(describe(error))
        dispatch({ type: "session/select", id: null })
      })
    return () => {
      cancelled = true
    }
  }, [online, selectedId, state.loaded, base, dispatch])

  // ---- follow the selected session's stream from its snapshot seq --------
  const loadedId = selected?.session.id
  const initialSeq = selected?.lastSeq
  React.useEffect(() => {
    if (!online || !loadedId || initialSeq === undefined) return
    const controller = new AbortController()
    void streamSession(
      base,
      loadedId,
      initialSeq,
      (event) => dispatch({ type: "session/event", id: loadedId, event }),
      controller.signal
    )
    return () => controller.abort()
    // initialSeq is deliberately read once per (re)connect; the stream tracks
    // its own cursor after that. Re-running on every event would reconnect
    // constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, loadedId, base, dispatch])

  // ---- actions -----------------------------------------------------------
  const create = async () => {
    try {
      const session = await createSession(base)
      dispatch({
        type: "sessions/upsert",
        summary: {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          status: session.status,
          messageCount: 0,
        },
      })
      dispatch({ type: "session/select", id: session.id })
      setListOpen(false)
    } catch (error) {
      toast.error(describe(error))
    }
  }

  const select = (id: string) => {
    dispatch({ type: "session/select", id })
    setListOpen(false)
  }

  const rename = async (id: string, title: string) => {
    try {
      const session = await renameSession(base, id, title)
      dispatch({
        type: "sessions/upsert",
        summary: {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          status: session.status,
          messageCount: state.summaries.find((s) => s.id === id)?.messageCount ?? 0,
        },
      })
    } catch (error) {
      toast.error(describe(error))
    }
  }

  const remove = async (id: string) => {
    try {
      await deleteSession(base, id)
      dispatch({ type: "sessions/remove", id })
      toast("Chat deleted")
    } catch (error) {
      toast.error(describe(error))
    }
  }

  const draft = selectedId ? (state.drafts[selectedId] ?? "") : ""
  const setDraft = (text: string) => {
    if (selectedId) dispatch({ type: "draft/set", id: selectedId, text })
  }

  const send = async () => {
    if (!selectedId || !draft.trim()) return
    const text = draft
    setDraft("")
    try {
      const outcome = await sendMessage(base, selectedId, text)
      if (outcome.status === "running") {
        // Plan 3 turns this into a queued message; until then, keep the text.
        setDraft(text)
        toast("A turn is still running — wait for it to finish, or press Stop")
      }
    } catch (error) {
      setDraft(text)
      toast.error(describe(error))
    }
  }

  const stop = async () => {
    if (!selectedId) return
    if (!(await cancelSession(base, selectedId))) toast.error("Nothing to stop")
  }

  const decide = async (requestId: string, decision: PermissionChoice) => {
    if (!selectedId) return
    const ok = await replySessionPermission(base, selectedId, requestId, decision)
    if (!ok) toast.error("The harness did not accept that decision")
  }

  // ---- derived view state ------------------------------------------------
  const path = selected ? pathToHead(selected.messages, selected.session.headId) : []
  const running = selected?.session.status === "running"
  const disabledReason = !online
    ? "The harness is offline"
    : !selectedId
      ? "Start a new chat first"
      : undefined

  const list = (
    <SessionList
      sessions={state.summaries}
      selectedId={selectedId}
      loading={state.listStatus === "loading"}
      onSelect={select}
      onCreate={() => void create()}
      onRename={(id, title) => void rename(id, title)}
      onDelete={(id) => void remove(id)}
    />
  )

  return (
    // The header is 3rem; main has 1rem padding (1.5rem from md). The thread
    // needs a bounded height for MessageScroller to scroll, so it is sized to
    // the viewport here rather than growing with its content.
    <div className="flex h-[calc(100dvh-3rem-2rem)] min-h-0 min-w-0 gap-4 md:h-[calc(100dvh-3rem-3rem)]">
      <aside className="hidden w-64 shrink-0 lg:flex lg:min-h-0 lg:flex-col">{list}</aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sheet open={listOpen} onOpenChange={setListOpen}>
            <SheetTrigger
              render={<Button variant="outline" size="icon-sm" className="lg:hidden" aria-label="Chats" />}
            >
              <HugeiconsIcon icon={Menu01Icon} />
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col gap-4 p-4">
              <SheetHeader className="p-0">
                <SheetTitle>Chats</SheetTitle>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col">{list}</div>
            </SheetContent>
          </Sheet>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {selected?.session.title ?? "Chat"}
          </h2>
          {selected?.lastUsage && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {selected.lastUsage.totalTokens.toLocaleString()} tokens
            </span>
          )}
        </div>

        {!online && (
          <Alert variant="destructive">
            <AlertTitle>Harness offline</AlertTitle>
            <AlertDescription>{CONNECTION_HINT}</AlertDescription>
          </Alert>
        )}
        {state.listStatus === "error" && state.listError && (
          <Alert variant="destructive">
            <AlertTitle>Could not load chats</AlertTitle>
            <AlertDescription>{state.listError}</AlertDescription>
          </Alert>
        )}

        <MessageThread
          messages={path}
          liveAssistant={selected?.liveTurn?.assistant}
          permissions={selected?.permissions ?? []}
          lastError={selected?.lastError}
          onDecide={(id, decision) => void decide(id, decision)}
        />

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          onStop={() => void stop()}
          running={Boolean(running)}
          disabledReason={disabledReason}
        />
      </section>
    </div>
  )
}
```

Notes for the implementer:
- `CONNECTION_HINT` is already exported from `agent-client.ts`.
- If `Menu01Icon` is not exported by `@hugeicons/core-free-icons` in the installed version, use `SidebarLeft01Icon` or any icon that exists (check `node_modules/@hugeicons/core-free-icons/dist/types/index.d.ts`).
- `SheetContent`'s `side` prop is `"left"` in this project's `sheet.tsx`; open the file to confirm the prop name before relying on it.
- If the lint rule `react-hooks/exhaustive-deps` is not enabled in this project, the disable comment above the stream effect is harmless; remove it if ESLint reports an unused directive.

- [ ] **Step 4: Mount the provider**

In `client/src/main.tsx`, import and wrap — the session store needs no settings, so it sits directly inside `StoreProvider`:

```tsx
import { SessionStoreProvider } from "@/lib/session-store"
```

```tsx
        <StoreProvider>
          <SessionStoreProvider>
            <HealthProvider>
              <App />
              <Toaster />
            </HealthProvider>
          </SessionStoreProvider>
        </StoreProvider>
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run build && npm test
git add src/components/chat/session-list.tsx src/components/chat/composer.tsx src/pages/chat.tsx src/main.tsx
git commit -m "feat(client): Chat page — session list, streaming thread, composer with Stop"
```

---

### Task 9: Real-browser verification, docs and context

**Files:**
- Modify: `README.md`, `docs/conversations-design.md`, `context.md` (on disk only)

- [ ] **Step 1: Start a stub model and the harness**

From the repo root. Port 3001 is usually the owner's; check first and pick 3099 if taken.

```bash
lsof -iTCP:3001 -sTCP:LISTEN -t >/dev/null && echo "3001 taken — use 3099" || echo "3001 free"
cat > tmp-stub.cjs <<'EOF'
// Replies with how many user messages it received, streamed slowly enough
// to watch, and calls get_current_time once per turn so tool activity shows.
const http = require("node:http");
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    const body = JSON.parse(b);
    const users = body.messages.filter((m) => m.role === "user").length;
    const lastRole = body.messages[body.messages.length - 1].role;
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (hasTools && lastRole === "user") {
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c" + users, function: { name: "get_current_time", arguments: "{}" } }] } }] });
      send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      res.write("data: [DONE]\n\n"); return res.end();
    }
    const words = `You have sent **${users}** message${users === 1 ? "" : "s"} in this chat. Here is some code:\n\n\`\`\`ts\nconst n = ${users}\n\`\`\``.split(" ");
    let i = 0;
    const tick = setInterval(() => {
      if (i < words.length) { send({ choices: [{ delta: { content: (i ? " " : "") + words[i++] } }] }); return; }
      clearInterval(tick);
      send({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } });
      res.write("data: [DONE]\n\n"); res.end();
    }, 80);
  });
}).listen(4590);
EOF
tmux kill-session -t dulo-plan2 2>/dev/null
tmux new-session -d -s dulo-plan2 "node tmp-stub.cjs"
tmux new-window -t dulo-plan2 "PORT=3099 OPENROUTER_API_KEY=test OPENROUTER_URL=http://127.0.0.1:4590/x npx tsx src/server.ts"
tmux new-window -t dulo-plan2 "cd client && npx vite --port 5174"
sleep 5
curl -s http://127.0.0.1:3099/api/health | head -c 60; echo
```

- [ ] **Step 2: Point the panel at the harness**

Open `http://localhost:5174` in a real browser (the Playwright MCP tools or the `agent-browser` skill are both available in this environment). Go to **Settings**, set the API base URL to `http://localhost:3099`, and confirm the header badge turns to **Online**.

- [ ] **Step 3: Walk the chat**

1. Open **Chat**. Expected: the empty list ("No chats yet."), the thread's "Start the conversation" empty state, and the composer placeholder "Start a new chat first".
2. Click **New chat**. Expected: a session appears in the list, selected; the composer placeholder becomes "Message Dulo…".
3. Type `hello` and press **Enter**. Expected, in order: your message in a right-aligned bubble; a "Thinking…" shimmer; a collapsible `get_current_time` row with a spinner, then a duration; assistant text appearing word by word ending with "**1** message" in bold and a code block reading `const n = 1`; the session title in the list changes to `hello`; the header shows "50 tokens". The Stop button was visible while it ran and is gone now.
4. Type `again` and press Enter. Expected: the assistant says "**2** messages" — the second turn carried the first exchange.
5. Expand the tool row. Expected: arguments `{}` and the time as the result.
6. Press Enter on an empty composer. Expected: nothing happens. Shift+Enter inserts a newline.
7. Send a third message and, while it is streaming, **reload the page**. Expected: the Chat page reopens on the same session (selection is persisted), the two completed exchanges are there, the third turn's partial text is present, and it keeps streaming to completion — the reconnect picked up from the snapshot seq.
8. Send a fourth message and press **Stop** during the stream. Expected: the stream stops; the partial assistant message stays; no error alert (cancelled is not failed).
9. In the list, use the row menu: **Rename** to `smoke test` (the title updates), then **Delete** on a second, freshly created session (it disappears; the first stays selected).
10. Open the **Playground** page and run one query. Expected: unchanged behaviour — this plan did not touch its logic.

- [ ] **Step 4: Narrow viewport**

Resize to **400 px** wide. Expected: the session list is hidden behind the menu button at the top-left of the thread; opening it shows the list in a Sheet; selecting a session closes the Sheet; the thread and composer fit with no horizontal scrollbar (check `document.documentElement.scrollWidth <= window.innerWidth` in the console). Resize back to desktop (≥1024 px): the list returns as a left column.

- [ ] **Step 5: Permission prompt**

Send `run ls` — the stub only ever calls `get_current_time`, so to see the gate, temporarily change the stub's tool name to `shell` with `arguments: JSON.stringify({ command: "echo hi" })`, restart the stub window, send a message. Expected: a permission prompt appears inline in the thread with the `shell` badge and the arguments; the composer's Stop button is visible; **Allow once** runs it and the turn continues; **Deny** ends the tool with an error result the model sees. Reload while the prompt is showing: it is still there after reload (Task 2's snapshot field). Restore the stub afterwards.

- [ ] **Step 6: Clean up**

```bash
tmux kill-session -t dulo-plan2
rm -f tmp-stub.cjs
rm -rf sessions
```

Reset the Settings API URL in the browser to `http://localhost:3001` if you changed it, so the owner's usual setup is untouched.

- [ ] **Step 7: README**

In `README.md`, under "Control Panel Showcase", add a subsection before the Playground one:

```markdown
### 1. Chat

A conversation with the agent that remembers everything said so far. Sessions live in
the harness (`/api/sessions`), so a chat survives a refresh, a closed tab, or opening the
panel from another machine. Each assistant turn renders Markdown with its tool activity
inline and collapsible; gated tools ask for permission right in the thread; a turn keeps
running if you navigate away and the page reattaches when you come back.
```

Renumber the following subsections. In the "Running Dulo" section, mention that **Chat** is where conversations happen and the Playground runs one-shot queries.

- [ ] **Step 8: Design status**

In `docs/conversations-design.md`, change the status line to:

`Status: approved 2026-09-13. Plan 1 (session core) and Plan 2 (chat page) implemented <date>. Owner: Ali. Author: Claude.`

and append to §14, after the component table:

```markdown
Implementation note (Plan 2): the thread is built on shadcn's `message-scroller`,
`message`, `bubble` and `collapsible` primitives rather than the hand-written thread
sketched above — scrolling, streaming follow and jump-to-latest are theirs. Markdown is
`react-markdown` + `remark-gfm`; fenced code renders through the existing `CodeBlock`
without a highlighter, leaving syntax colouring as owner-directed polish.
```

- [ ] **Step 9: context.md**

Per `CLAUDE.md`: §3 add the client's chat module (`lib/session-*.ts`, `lib/fold.ts`, `lib/tree.ts`, `components/chat/*`, `components/markdown.tsx`, `pages/chat.tsx`) and the harness snapshot change; §4 decision rows — shadcn chat primitives over a hand-rolled thread (why: scrolling and streaming follow are solved there, and the owner wants to shape the visuals not the plumbing); `react-markdown` without a highlighter (why); pending permissions on the snapshot (why: a refresh during a gate used to hide the prompt until the 5-minute timeout); session streams stay open across turns so the client holds one connection per selected session; `message.completed` replaces the client fold (why); the Chat page sizes itself to the viewport because `MessageScroller` needs a bounded height. §6 timeline row. §7 open work: Plans 3–7 remain; send-while-running is still a 409 with a toast until Plan 3; Retry-on-failure is Plan 4 (it is a branch). §8 log line with what Task 9 verified. Bump **Last updated**.

- [ ] **Step 10: Commit**

```bash
npm run typecheck && npm test
cd client && npm run typecheck && npm run lint && npm run build && npm test && cd ..
git add README.md docs/conversations-design.md
git commit -m "docs: Chat page in README, mark plan 2 done"
```

---

## Self-review against the spec

- **§14 pieces:** `SessionList` (create/rename/delete/switch, running indicator) → Task 8. `MessageThread` → Task 7, on `MessageScroller` (deviation 1, recorded in Task 9). `UserMessage`, `AssistantMessage` (Markdown, streaming indicator, `ToolActivity` collapsible, `manage_todos` checklist) → Tasks 6–7. `Composer` (Enter/Shift+Enter, Stop) → Task 8; attachment drop and model/agent pickers are Plan 5 as the design's §17 says. `PermissionPrompt` inline → Tasks 6–7. `session-store.tsx` persisting only selection and drafts → Task 5. `session-client.ts` with the same reconnect loop → Task 4. `"chat"` in `Page` → Task 1.
- **§7 events:** every `SessionEvent` variant is handled or explicitly ignored in `foldSessionEvent` (Task 5); `message.completed` replaces the fold per §6.4; seq tracked for reconnect per §7.
- **§13 API:** list/create/get/patch(title)/delete/messages/events/cancel/permission — all wrapped in Task 4. `PATCH { headId }` is Plan 4; queue routes are Plan 3; files and memory are Plans 5 and 6.
- **§15 error handling:** LLM failure → `lastError` alert under the thread (Task 5, 7); Retry is deferred to Plan 4 because it is a resend-as-sibling; permission timeout → server-side, prompt clears via `permission.resolved`; client disconnect → `streamSession` reconnects (Task 4); harness restart → the snapshot shows the failed synthetic turn's error via `loadedFromSnapshot` (Task 5); send while running → toast, text kept (Task 8; 202 in Plan 3).
- **§16 tests:** client `fold`, `tree`, reducer/fold-of-events, and `segmentsOf` under vitest (Tasks 3, 5, 7); harness `runner.test.ts` extended (Task 2). Browser check at desktop and 400 px (Task 9), as `CLAUDE.md` requires for UI changes.
- **Type consistency:** `PendingToolPermission` (snapshot) and `PendingPermission` (`types.ts`) have identical fields, so `loadedFromSnapshot` assigns one to the other without a cast. `PermissionChoice` is defined once in `permission-prompt.tsx` and used by `MessageThread` and `ChatPage`. `LoadedSession.session` is `SessionSnapshot["session"]`, i.e. `Session`. `drain<T>` is called with `SessionEvent` in Task 4 and inferred as `RunEvent` for the untouched Playground callers. `segmentsOf` is exported from `assistant-message.tsx` and imported by its test.
- **Placeholders:** none. Two places tell the implementer to confirm a prop or export against the installed file (`side` on `SheetContent`, `variant` on `DropdownMenuItem`, the collapsible open-state attribute) because those come from the registry at install time — each gives the fallback to use.

## What comes after this plan

| Plan | Scope | Depends on |
| --- | --- | --- |
| 3 — Queue | 202 + `QueuedMessage` on send-while-running, auto-run after completion, hold after cancel/fail, `queue/:id` PATCH/DELETE/send; composer chips with Send now / Edit / Remove | 1, 2 |
| 4 — Branching UI | Edit → resend as sibling (also serves as Retry), `BranchSwitcher` `‹ k/n ›` using `siblingsOf`, `PATCH { headId }` via `latestLeaf` | 2 |
| 5 — Per-turn model/agent + attachments | Pickers in the composer from `/api/agents` and the model list; `PUT /files`, `GET /files/:id`; `@shadcn/attachment` chips on user messages; read text-like files into the `attachments` map before projection | 1, 2 |
| 6 — Memory | Threshold check, summarisation call, extend-not-replace, `GET/PATCH /memory`, `MemoryPanel` in a Sheet | 1, 2 |
| 7 — Switch-over | Chat as the default page; remove `runs/` from `.gitignore`; README; `context.md` | all |
