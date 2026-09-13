# Conversations: from tool runner to chat

Design for turning Dulo from "submit a query, watch it run, done" into a
conversational agent — multi-turn sessions with memory, a message queue,
branching, attachments, and per-turn model choice. Written for the agent that
will implement it; the ordered task list lives in `conversations-plan.md`.

Status: approved 2026-09-13. Plan 1 (session core) and Plan 2 (chat page) implemented 2026-09-13. Plan 3 (queue) written in `conversations-plan-3-queue.md`, not yet implemented. Owner: Ali. Author: Claude.

---

## 1. Problem

Every submit today builds `[system, user]` from scratch (`src/agent.ts:220`).
Nothing carries forward: not the previous answer, not the files the agent read,
not the tools it ran. The web Playground, the Go TUI and the CLI all inherit
this, so all three feel like a tool runner rather than an assistant. The fix is
not a UI change. The harness has no concept of a conversation, so the clients
cannot show one.

## 2. Decisions already made

These were settled with the owner during design and are not open.

| Decision | Choice |
| --- | --- |
| Where the conversation lives | In the harness. A **session** owns messages; a **turn** is the existing agent loop run over the session's history. Clients are views. |
| Clients in scope | Harness + web client. The Go TUI and the CLI keep working unchanged through compatibility shims; each gets its own follow-up plan. |
| Message sent while a turn is running | **Queued.** Delivered as the next turn automatically after a normal completion; held after a cancel or failure. |
| Editing an earlier message | **Branching.** Messages form a tree with a `headId`; edit-and-resend creates a sibling. |
| Model / agent profile | Recorded **per turn**, switchable between turns. |
| Files | **Attachments** as message parts; text-like files are inlined into the prompt. |
| Long sessions | **Memory**: the model summarises older turns; the summary is stored on the session and is user-editable. |
| Storage | **Files** (JSON Lines) behind a `SessionStore` interface. A Postgres implementation is a later, optional phase selected by `DULO_DATABASE_URL`. Never a hard dependency. |
| Event names | `run.start` / `run.end` are kept and now mean **turn start / end**. This is what keeps the TUI working with zero changes. |

## 3. Vocabulary

- **Session** — one conversation. Has a title, a message tree, a head, a queue, optional memory.
- **Turn** — one execution of the agent loop: a user message in, an assistant message out. A turn *is* what the code has called a run; `turnId === runId`.
- **ChatMessage** — a node in the session tree. Not the same as the LLM wire `Message` in `src/types.ts`; the two are related by *projection* (§6).
- **Part** — an ordered piece of a ChatMessage: text, attachment, tool call, tool result.
- **Head** — the message id at the tip of the current branch. The **path** is root → head.
- **Memory** — the compaction summary standing in for messages older than `coversUpTo`.

## 4. Data model

Types live in `src/session/types.ts` and are mirrored by hand in
`client/src/lib/session-types.ts`, the way `src/events.ts` and
`client/src/lib/types.ts` already mirror each other.

```
Session {
  id: string                 // uuid
  title: string              // first user message, trimmed to 60 chars, until renamed
  createdAt: string          // ISO
  updatedAt: string
  status: "idle" | "running"
  headId: string | null      // tip of the current branch; null for an empty session
  memory?: Memory
  queue: QueuedMessage[]
  defaults: { model?: string; agent?: string; temperature?: number; maxSteps?: number }
}

ChatMessage {
  id: string
  sessionId: string
  parentId: string | null    // null only for a root user message
  role: "user" | "assistant"
  parts: Part[]
  turnId?: string            // assistant messages, and the user message that started the turn
  createdAt: string
}

Part =
  | { type: "text"; text: string }
  | { type: "attachment"; fileId: string; name: string; mime: string; size: number }
  | { type: "tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; callId: string; tool: string; result: string;
      isError: boolean; durationMs: number; error?: { message: string } }

Turn {
  id: string
  sessionId: string
  userMessageId: string
  assistantMessageId: string
  model: string
  agent?: string
  temperature?: number
  maxSteps?: number
  status: "running" | "completed" | "failed" | "cancelled"
  reason?: "answered" | "step-limit"
  error?: string
  usage?: RunUsage
  startedAt: string
  durationMs: number
}

QueuedMessage {
  id: string                 // becomes the ChatMessage id when it is sent
  parts: Part[]              // text and attachments only
  parentId?: string          // omitted = head at send time
  model?: string; agent?: string; temperature?: number; maxSteps?: number
  queuedAt: string
}

Memory {
  summary: string
  coversUpTo: string         // id of the last message the summary replaces (on the path)
  updatedAt: string
  editedByUser: boolean
}
```

Rules:

- **One user message and one assistant message per turn.** The assistant
  message's parts are appended in order as the turn streams: text, tool calls,
  their results, more text. This is what lets a chat render "thought → ran tool
  → answered" as one bubble instead of the current step list.
- A user message may carry `text` and `attachment` parts only. An assistant
  message may carry `text`, `tool_call` and `tool_result` parts only.
- Every `tool_call` on an assistant message has exactly one matching
  `tool_result` by `callId` once the turn has ended. A cancelled turn fills in
  missing results with `{ isError: true, result: "Error: cancelled" }` so the
  projection never sends the model a dangling call.
- `headId` always points at a message that exists. Deleting is not supported
  on messages (only whole sessions), so this cannot break.

## 5. Storage

### 5.1 Interface

`src/session/store.ts` exports:

```
interface SessionStore {
  createSession(input: { title: string; defaults?: Session["defaults"] }): Promise<Session>
  getSession(id: string): Promise<Session | null>
  listSessions(): Promise<SessionSummary[]>          // newest first
  updateSession(id: string, patch: Partial<Pick<Session,
    "title" | "headId" | "status" | "memory" | "queue" | "defaults">>): Promise<Session>
  deleteSession(id: string): Promise<void>

  appendMessage(message: ChatMessage): Promise<void>
  getMessages(sessionId: string): Promise<ChatMessage[]>   // whole tree, creation order

  appendTurn(turn: Turn): Promise<void>                    // written once, at turn end
  getTurns(sessionId: string): Promise<Turn[]>

  appendEvent(sessionId: string, event: SessionEvent): Promise<void>
  readEvents(sessionId: string, after: number): Promise<SessionEvent[]>

  putFile(sessionId: string, file: { name: string; mime: string; bytes: Buffer })
    : Promise<{ fileId: string; name: string; mime: string; size: number }>
  getFile(sessionId: string, fileId: string)
    : Promise<{ name: string; mime: string; bytes: Buffer } | null>
}

SessionSummary = Pick<Session, "id" | "title" | "createdAt" | "updatedAt" | "status">
               & { messageCount: number; lastModel?: string }
```

The session logic (§6–§11) depends only on this interface. Nothing outside
`src/session/store/*` may touch the filesystem or a database for session data.

### 5.2 File implementation (`src/session/store/files.ts`)

```
sessions/
  index.json                 // SessionSummary[], rewritten on every session update
  <sessionId>/
    session.json             // Session, rewritten on every update
    messages.jsonl           // one ChatMessage per line, append-only
    turns.jsonl              // one Turn per line, append-only
    events.jsonl             // one SessionEvent per line, append-only, no assistant.delta
    files/
      <fileId>               // raw bytes
      <fileId>.json          // { name, mime, size, uploadedAt }
```

- Writes to one session are serialised through a promise chain, exactly as
  `src/runs.ts` does today, so two events cannot interleave inside one line.
- `assistant.delta` events are never written (same reasoning as today:
  thousands per turn, and `assistant` carries the full text). Seq numbers are
  still consumed, so replayed logs have gaps; readers filter `seq > N` and are
  unaffected.
- A failed append is logged and swallowed; the in-memory state remains
  authoritative for the life of the process. Losing a log line must never end
  a live turn.
- `sessions/` is git-ignored. `runs/` is removed in the final phase.

### 5.3 Postgres implementation (later, optional)

`src/session/store/postgres.ts`, selected when `DULO_DATABASE_URL` is set.
Tables: `sessions`, `messages` (self-referencing `parent_id`, `parts JSONB`),
`turns`, `events` (`(session_id, seq)` primary key), `files`. It exists to
unlock cross-session full-text search and token/cost analytics; nothing in
this document depends on it. Out of scope for the first plan except that the
interface in §5.1 must be honoured so it can be added without touching
session logic.

## 6. Turn execution

### 6.1 Projection: tree → LLM messages

`src/session/history.ts` exports
`projectHistory(input: { session, messages, registry, systemPrompt }): Message[]`
producing the OpenAI-shaped `Message[]` the loop already consumes:

1. `{ role: "system", content: systemPrompt }` — the agent profile's prompt or
   `SYSTEM_PROMPT`, plus the skills catalogue, exactly as `runAgent` builds it
   today.
2. If `session.memory` exists:
   `{ role: "user", content: "[Memory of earlier conversation]\n" + summary }`
   followed by `{ role: "assistant", content: "Understood." }` so the model
   sees it as established context rather than a new question.
3. Walk the path root → head. Skip every message up to and including
   `memory.coversUpTo` when memory exists. For each remaining message:
   - **user** → one `{ role: "user", content }` where content is the text parts
     joined by `\n\n`, followed by each attachment rendered per §9.
   - **assistant** → its parts, in order, folded into wire messages: a run of
     `text` becomes `{ role: "assistant", content }`; a run of `tool_call`
     becomes one `{ role: "assistant", content: null, tool_calls: [...] }`;
     each `tool_result` becomes `{ role: "tool", tool_call_id, name, content }`.
     A `tool_call` is always followed by its `tool_result`s before the next
     text run, which is how the loop produced them.
4. The final message on the path is the new user message; the loop starts there.

This is a pure function and is unit-tested against fixtures.

### 6.2 `runTurn`

`src/agent.ts` gains `runTurn(history: Message[], options: RunOptions)`. It is
today's `runAgent` with the `[system, user]` construction removed: `history`
is used as `messages`. Everything after that — the step loop, tools, streaming,
the condense/clip guard, the wrap-up turn, cancellation, permissions — is
unchanged. `runAgent(query, options)` remains as
`runTurn([{ role: "system", ... }, { role: "user", content: query }], options)`
so the CLI does not change.

### 6.3 Session runner

`src/session/runner.ts` exports `startTurn(sessionId, input)` and owns the
live state that `src/runs.ts` owns today, re-keyed by session:

```
LiveSession {
  session: Session
  seq: number                          // last event seq issued for this session
  recent: SessionEvent[]               // in-memory tail for fast reattach
  subscribers: Set<ServerResponse>
  turn?: {
    turn: Turn
    assistant: ChatMessage             // folded live from events, see §6.4
    controller: AbortController
    gate: Gate                         // from src/permissions.ts
  }
}
```

`startTurn`:

1. Reject with 409 if `session.status === "running"` — callers use the queue
   (§8) for that case.
2. Create the user `ChatMessage` (`parentId` = input.parentId ?? headId),
   append it, set `headId` to it, emit `message.created`.
3. Create the `Turn` and an empty assistant `ChatMessage` with
   `parentId = userMessage.id`; set `status = "running"`; emit `run.start`
   with `sessionId`, `turnId`, `userMessageId`, `assistantMessageId`.
4. `projectHistory` → `runTurn` with `onEvent` = fold + publish (§6.4),
   `signal`, and `requestPermission` wired to the gate exactly as
   `src/server.ts` wires it today.
5. On return: fill dangling tool results if cancelled (§4), set head to the
   assistant message, append assistant message and turn, emit `run.end` (with
   `sessionId`, `turnId`, `usage`, `reason`), then `message.completed`, set
   `status = "idle"`, update `defaults` from this turn's model/agent.
6. If the turn **completed** and the queue is non-empty, dequeue the first
   item and call `startTurn` with it (§8). If it was cancelled or failed, do
   nothing further.

Only one turn per session runs at a time. Different sessions may run
concurrently, as runs do today.

### 6.4 Fold: events → assistant parts

`src/session/fold.ts` exports
`foldTurnEvent(assistant: ChatMessage, event: RunEvent): ChatMessage` — pure,
returns a new message:

- `assistant.delta` → append text to the last part if it is `text`, else push a new `text` part.
- `assistant` → replace the trailing `text` run with the full text (same "final text wins" rule the client uses today).
- `tool.call` → push `tool_call`.
- `tool.result` → push `tool_result`.
- everything else → unchanged.

The server applies it on every published event to keep `turn.assistant`
current; the client applies the same function (mirrored in
`client/src/lib/fold.ts`) to render a live turn. `message.completed` then
carries the authoritative folded message, which replaces the client's fold, so
a dropped chunk can never leave a permanent gap.

## 7. Events

`SessionEvent = (RunEvent | SessionOnlyEvent) & { sessionId: string; seq: number }`.

Turn-scoped events keep today's names and shapes from `src/events.ts` and
gain `turnId`: `step.start`, `tool.call`, `tool.result`, `assistant.delta`,
`assistant`, `permission.ask`, `permission.resolved`, `context.condensed`.

`run.start` and `run.end` keep their names (§2) and gain
`sessionId`, `turnId`, `userMessageId`, `assistantMessageId`. `runId` stays
present and equals `turnId`. In `src/events.ts` these are added as **optional**
fields on the existing variants, so the TUI's Go struct (every field
`omitempty`) and the current web client keep decoding unchanged; the legacy
`/api/run` path populates them too.

New, session-only:

| Event | Fields | When |
| --- | --- | --- |
| `message.created` | `message: ChatMessage` | A user message is appended (sent directly or dequeued) |
| `message.completed` | `message: ChatMessage` | After `run.end`; the final folded assistant message |
| `queue.updated` | `queue: QueuedMessage[]` | Any change to the queue |
| `session.updated` | `patch: Partial<Pick<Session, "title" \| "headId" \| "status" \| "memory" \| "defaults">>` | Any of those changes, including memory compaction |

One `seq` counter per session. `GET /api/sessions/:id/events?after=N` serves
everything with `seq > N` — from `recent` while the session is live in
memory, from `events.jsonl` otherwise — and then **stays open until the client
disconnects**, across turns, so a chat client sees the next turn (including one
auto-started from the queue) without reconnecting. Only the legacy
`/api/run` and `/api/run/:id/stream` streams close at that turn's `run.end`,
because the TUI treats a closed stream as end-of-run. This is `handleReattach`
from `src/server.ts` re-keyed.

## 8. Queue

- `POST /api/sessions/:id/messages` while `status === "running"` appends a
  `QueuedMessage`, persists the session, emits `queue.updated`, returns
  `202 { queued: QueuedMessage }`. While idle it starts a turn and returns
  `200 { turnId, userMessageId, assistantMessageId }`. (Until Plan 3 lands,
  send-while-running returns `409`; Plan 1 ships the turn model without the
  queue.)
- After a turn **completes**, the first queued item is dequeued and sent as the
  next turn with its own `parentId`/model/agent, in the same tick, before
  `status` is observed as idle by anyone. `queue.updated` and
  `message.created` are emitted in that order.
- After a turn is **cancelled or fails**, the queue is kept but **held**:
  nothing auto-starts. Each item can be sent explicitly with
  `POST /api/sessions/:id/queue/:msgId/send` (allowed only while idle), edited
  with `PATCH` (parts, parentId, model, agent), or removed with `DELETE`.
- A queued item whose `parentId` no longer lies on the current path is still
  sent as written; it simply creates a branch. This is intentional: the user
  chose that parent.

## 9. Attachments

- `PUT /api/sessions/:id/files?name=<urlencoded>` with the raw file as the body
  and its type in `Content-Type`. No multipart parsing, no dependency.
  Returns `201 { fileId, name, mime, size }`. Limit `config.files.maxBytes`,
  default 2 MB; over the limit → `413`.
- `GET /api/sessions/:id/files/:fileId` streams it back with the stored type.
- An `attachment` part references the file. In projection (§6.1) each
  attachment is rendered after the message text as:
  - **text-like** (`text/*`, `application/json`, `application/xml`,
    `application/javascript`, `application/typescript`, or a name ending in
    one of: `.md .txt .json .yaml .yml .toml .csv .ts .tsx .js .jsx .mjs .cjs
    .py .go .rs .java .kt .c .h .cpp .cs .rb .php .sh .sql .html .css .xml
    .env.example`): `\n\n--- ${name} ---\n${content}\n--- end ${name} ---`,
    with `content` capped at `config.files.maxInlineChars` (default 20 000)
    and a `[truncated: N of M characters]` marker when cut.
  - **anything else**: `\n\n[attached file: ${name}, ${mime}, ${size} bytes — binary, not shown]`.
- Files are stored once and referenced by id, so a branch that re-sends an
  edited message can reuse the same attachments without re-uploading.

## 10. Branching

- `POST /api/sessions/:id/messages` accepts `parentId`. Omitted means the
  current head. Edit-and-resend on message M is a post with
  `parentId = M.parentId` and the new parts; head moves to the new message and
  the turn runs from there. M and its subtree remain.
- Siblings are messages sharing a `parentId`. The client shows a `k/n`
  switcher on any message with `n > 1`, ordered by `createdAt`.
- `PATCH /api/sessions/:id { headId }` switches branch. The server accepts any
  existing message id and resolves head to the **latest leaf** under it: from
  the given message, repeatedly step to the child with the greatest
  `createdAt` until a message has no children. So pointing at a user message
  shows that whole branch through to its most recent answer.
- Two pure helpers in `src/session/tree.ts`, mirrored in
  `client/src/lib/tree.ts`: `pathToHead(messages, headId): ChatMessage[]` and
  `siblingsOf(messages, id): { index: number; total: number; ids: string[] }`.
- Switching head while a turn is running → `409`; the running turn owns head.

## 11. Memory (compaction)

- Before projecting a turn, estimate tokens of the would-be history with the
  existing `estimateTokens` (`JSON.stringify(...).length / 4`). If it exceeds
  `config.memory.threshold` (default 24 000), compact first.
- **Compact:** take the path after the current `coversUpTo` (or the whole path
  if no memory), leave the last `config.memory.keepRecent` messages (default
  8, i.e. four turns) untouched, and summarise the rest. The summarisation
  call is `callLLM` with no tools and a fixed prompt asking for a compact
  record of: what the user wanted, what was done, what was learned (files,
  facts, decisions), and what is unresolved. If memory already exists, the
  prompt includes the old summary and asks for an updated one that
  **extends** it. Result → `memory = { summary, coversUpTo: <last summarised id>, updatedAt, editedByUser: <unchanged if it was true> }`,
  persist, emit `session.updated`.
- `GET /api/sessions/:id/memory` returns it; `PATCH` with `{ summary }` sets
  `editedByUser = true`. Subsequent compactions always extend rather than
  replace, so a user's edits survive.
- If the summarisation call fails, the turn proceeds without compacting and
  the failure is logged; the step-6 `condense`/clip guard inside `runTurn`
  still protects the request. Compaction is best-effort; a turn must never be
  blocked by it.
- Memory is per session and follows head: after a branch switch, if the new
  path does not include `coversUpTo`, memory is treated as absent for
  projection (it summarised a different branch) but is not deleted.

## 12. Permissions and cancel inside a session

- The gate is created per turn and lives on `LiveSession.turn.gate`.
  `POST /api/sessions/:id/permission/:requestId { decision }` resolves it; the
  same `permission.ask` / `permission.resolved` events flow on the session
  stream. Behaviour (timeout, "always" scoped to the turn, denial as a tool
  error) is unchanged from `src/permissions.ts`.
- `POST /api/sessions/:id/cancel` aborts the running turn. The turn ends
  `cancelled`, dangling tool results are filled (§4), head moves to the partial
  assistant message so the conversation can continue from it, and the queue is
  held (§8).
- `DELETE /api/sessions/:id` on a running session cancels first, waits for
  `run.end`, then deletes.

## 13. API

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| `GET` | `/api/sessions` | | `SessionSummary[]` newest first |
| `POST` | `/api/sessions` | `{ title?, defaults? }` | `201 Session` |
| `GET` | `/api/sessions/:id` | | `{ session, messages, turns, queue, memory, seq, liveTurn?: { turnId, assistant: ChatMessage } }` |
| `PATCH` | `/api/sessions/:id` | `{ title?, headId?, defaults? }` | `Session` |
| `DELETE` | `/api/sessions/:id` | | `204` |
| `POST` | `/api/sessions/:id/messages` | `{ parts \| text, parentId?, model?, agent?, temperature?, maxSteps? }` | `200 { turnId, userMessageId, assistantMessageId }` or `202 { queued }` |
| `GET` | `/api/sessions/:id/events?after=N` | | SSE of `SessionEvent` |
| `POST` | `/api/sessions/:id/cancel` | | `{ cancelled: boolean }` |
| `POST` | `/api/sessions/:id/permission/:requestId` | `{ decision }` | `{ settled: boolean }` |
| `PATCH` | `/api/sessions/:id/queue/:msgId` | `{ parts?, parentId?, model?, agent? }` | `QueuedMessage` |
| `DELETE` | `/api/sessions/:id/queue/:msgId` | | `204` |
| `POST` | `/api/sessions/:id/queue/:msgId/send` | | `200 { turnId, ... }` or `409` if running |
| `GET` | `/api/sessions/:id/memory` | | `Memory \| null` |
| `PATCH` | `/api/sessions/:id/memory` | `{ summary }` | `Memory` |
| `PUT` | `/api/sessions/:id/files?name=` | raw body | `201 { fileId, name, mime, size }` |
| `GET` | `/api/sessions/:id/files/:fileId` | | file bytes |

`GET /api/sessions/:id` returns `seq` = the session's current seq at snapshot
time and, when a turn is live, the server's folded partial assistant message.
A client loads the snapshot, then opens `events?after=seq`. Events published
between snapshot and subscribe are still in `recent`, so nothing is lost.

All bodies are validated with zod, as `RunRequest` is today. `text` is
shorthand for `parts: [{ type: "text", text }]`.

### 13.1 Compatibility shims (unchanged clients)

| Legacy | Becomes |
| --- | --- |
| `POST /api/run` | Creates a session titled from `query`, starts one turn with the request's model/maxSteps/temperature/enabledTools/agent, and streams that turn's events. Same `run.*` events, plus the new fields. |
| `POST /api/run/:id/cancel` | Looks up the session by turn id (`Map<turnId, sessionId>` in the runner) and cancels. |
| `GET /api/run/:id/stream?after=N` | Same lookup; streams the session's events filtered to that `turnId`. |
| `GET /api/runs` | Alias of `GET /api/sessions`. |
| `POST /api/run/:id/permission/:requestId` | Same lookup; resolves the gate. |

`enabledTools` on the legacy request maps to a turn-scoped tool filter, as
today. The Go TUI (`tui/api/client.go`) uses exactly `health`, `tools`, `run`,
`run/:id/cancel`; all keep working. The CLI uses `runAgent`; unchanged.

## 14. Web client

Pages are a `useState<Page>` union in `client/src/App.tsx`, not a router. Add
`"chat"` to `Page` and a sidebar entry. Phase 7 makes it the default;
Playground stays reachable as "Runs" until the owner removes it.

New files, each with one job:

| File | Job |
| --- | --- |
| `client/src/lib/session-types.ts` | Mirror of `src/session/types.ts` |
| `client/src/lib/fold.ts`, `tree.ts` | Mirrors of the two pure helpers |
| `client/src/lib/session-client.ts` | Fetch wrappers for §13; `streamSession(base, id, after, onEvent, signal)` with the same reconnect loop as `streamRun` |
| `client/src/lib/session-store.tsx` | Reducer over `SessionEvent` + local UI state (selected session, composer draft per session). Persists only `selectedSessionId` and drafts to localStorage; sessions come from the harness. |
| `client/src/pages/chat.tsx` | Layout: `SessionList` \| `MessageThread` + `Composer` |
| `client/src/components/chat/session-list.tsx` | List, new, rename (inline), delete (confirm), running indicator |
| `client/src/components/chat/message-thread.tsx` | Renders `pathToHead`; autoscroll only when already at bottom |
| `client/src/components/chat/user-message.tsx` | Text + attachment chips; Edit → prefilled composer in "resend" mode; `k/n` switcher when siblings |
| `client/src/components/chat/assistant-message.tsx` | Markdown (`react-markdown` + `remark-gfm` + `rehype-highlight`), streaming cursor while live, collapsible `ToolActivity` |
| `client/src/components/chat/tool-activity.tsx` | The message's `tool_call`/`tool_result` pairs; reuses `CodeBlock`; `manage_todos` renders as the existing checklist |
| `client/src/components/chat/composer.tsx` | Textarea (Enter sends, Shift+Enter newline), attachment drop/paste → `PUT files`, model + agent pickers (per turn, default from `session.defaults`), Stop while running, queued chips with Send now / Edit / Remove |
| `client/src/components/chat/memory-panel.tsx` | Sheet showing `memory.summary`, editable, "covers N messages" |
| `client/src/components/chat/branch-switcher.tsx` | `‹ 1/2 ›`, calls `PATCH { headId }` |

Implementation note (Plan 2): the thread is built on shadcn's `message-scroller`,
`message`, `bubble` and `collapsible` primitives rather than the hand-written thread
sketched above — scrolling, streaming follow and jump-to-latest are theirs. Markdown is
`react-markdown` + `remark-gfm`; fenced code renders through the existing `CodeBlock`
without a highlighter, leaving syntax colouring as owner-directed polish.

The existing `PermissionPrompt` renders inline in the thread above the live
assistant message. The design leaves visual direction to the owner: build these
functionally with clear props, no bespoke styling beyond the shadcn defaults
the app already uses. UI changes get the usual real-browser check at desktop and
~400 px.

## 15. Error handling

| Failure | Behaviour |
| --- | --- |
| LLM error mid-turn | Turn ends `failed` with `error`; the assistant message keeps whatever parts it had; head moves to it; queue held. The thread shows the error under the message with Retry (resend the same user message as a sibling). |
| Permission timeout | Denial, as today. |
| Store write fails | Logged; in-memory state stays authoritative; a `session.updated { patch: {} }` is **not** emitted (no fake success). |
| Client disconnect | Reattach via `events?after=`; the run continues. |
| Harness restart mid-turn | Turn is lost, as today (honest limit). On next load the session shows the user message with no assistant reply and `status: "idle"`; the runner marks any `status: "running"` found on disk at startup as `idle` and appends a synthetic failed `Turn` with `error: "harness restarted"`. |
| Compaction fails | Turn proceeds uncompacted; logged. |
| `parentId` not in session | `400`. |
| Send while running | `202` queued, never an error. |

## 16. Testing

This design introduces Dulo's first test runner. Harness: Node's built-in
`node:test` through `tsx` — `"test": "node --import tsx --test 'src/**/*.test.ts'"`
— zero new dependencies (glob patterns in `--test` need Node ≥ 22; the machine
runs 26). Client: `vitest` for pure modules.

Must be covered before the corresponding phase is called done:

- `history.test.ts` — projection with and without memory; attachments inline vs binary; assistant parts → wire messages including tool call/result ordering; a cancelled turn's filled results.
- `tree.test.ts` — `pathToHead`, `siblingsOf`, latest-leaf resolution.
- `fold.test.ts` — delta accumulation, final text replacement, tool pairs.
- `runner.test.ts` — with a stub LLM (the `OPENROUTER_URL` pattern): a two-turn session carries context; queue auto-runs after completion and holds after cancel; 409 on send-while-running uses the queue; head moves correctly; dangling results filled.
- `memory.test.ts` — threshold triggers compaction; extend-not-replace when `editedByUser`; failure is non-blocking.
- `store.files.test.ts` — round trip of every method against a temp directory.
- Client: `fold`, `tree`, and the reducer's handling of `message.created` / `message.completed` / `queue.updated` / `session.updated`.

Every phase ends with `npm run typecheck && npm test` in the root and
`npm run typecheck && npm run lint && npm run build` in `client/`.

## 17. Phases

Each is one commit, independently verifiable, and leaves every existing client
working. Detail is in `conversations-plan.md`.

1. **Session core** — types, `SessionStore` + file implementation, tree/history/fold, `runTurn`, runner, all §13 routes except queue/files/memory, `/api/run` shims, tests. Web untouched.
2. **Chat page MVP** — session list, thread, composer, streaming, tool activity, permissions, reconnect, Markdown.
3. **Queue** — server rules + composer chips.
4. **Branching** — edit & resend, switcher, head PATCH.
5. **Per-turn model/agent + attachments** — pickers, file upload, inlining.
6. **Memory** — compaction, memory endpoints, panel.
7. **Switch-over** — Chat becomes the default page, README and `context.md`, remove `runs/`.

## 18. Out of scope

- Steering a turn mid-flight (injecting a message between tool steps). The queue covers the need for now; the data model does not prevent adding it.
- A global stream of session-list changes. The client refetches `/api/sessions` after its own actions and on window focus.
- LLM-generated titles. Title = first message trimmed; rename is manual.
- Full-text search and analytics — the reason the Postgres store exists; it is a separate plan.
- TUI and CLI conversational modes — separate plans against the same API.
- Message deletion. Sessions delete whole; messages are permanent within one.
