# Conversations — Plan 4 of 7: Branching UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat UI what the harness has already had, tested, since Plan 1:
editing an earlier message (or retrying a failed turn) resends it as a sibling and
branches; a `‹ k/n ›` switcher on any message with siblings moves between branches.
No new conversation model, no new harness route — `POST /messages` with an explicit
`parentId` and `PATCH { headId }` already do exactly this, end to end, proven by
`runner.test.ts`. This plan is almost entirely client work, plus one small,
already-flagged harness bug fix.

**Architecture:** `client/src/lib/tree.ts`'s `siblingsOf`/`pathToHead` (Plan 1) already
compute everything a branch switcher needs; they've simply never been called from a
component. `client/src/lib/session-store.tsx` needs **no changes at all** — switching
`headId` arrives over the already-open event stream as an ordinary `session.updated`
event, which `foldSessionEvent` already applies, and `pathToHead` re-derives the
displayed path from the new `headId` on the next render. All new logic is therefore
in `chat.tsx` (deriving sibling info per message, owning "editing" state, resolving a
failed turn's retry target) and two components (`UserMessage` gains hover-revealed
Edit + the switcher; `MessageThread`'s error banner gains a Retry button).

**Tech Stack:** Unchanged. One new shadcn install: `button-group` (for the switcher).

**Spec:** `docs/conversations-design.md` §10 (Branching — the primary spec), §2's
"Editing an earlier message" decision row, §14's `user-message.tsx`/
`branch-switcher.tsx` component rows, §15's Retry row. All settled in Plan 1/2's
design pass; this plan implements what's already agreed, not new product decisions,
except where called out inline (the exact switcher typography, which the design
deliberately leaves open, and the `QueuedMessage.parentId` fix, which Plan 3 flagged
as something for this plan to "revisit").

**Read first:** `context.md` (mandatory per `CLAUDE.md`), `docs/conversations-design.md`
§10/§14/§15, `src/session/tree.ts` and `client/src/lib/tree.ts` (already correct,
unchanged by this plan — read them so you don't re-derive or duplicate them),
`src/session/runner.test.ts`'s `"branches when parentId is an earlier message"` and
`"setHead resolves to the latest leaf and refuses while running"` tests (proof the
harness side already works), `client/src/components/chat/user-message.tsx`,
`client/src/components/chat/message-thread.tsx`, and `client/src/pages/chat.tsx` (read
the committed files fresh — this plan's diffs assume their exact current content,
quoted below; if any has moved on since, re-derive the diff from the real file).

**Conventions that apply to every task:**
- Conventional commits, **no attribution trailers**. One commit per task.
- Root checks when a task touches `src/`: `npm run typecheck && npm test`.
- Client checks when a task touches `client/`: `npm run typecheck && npm run lint &&
  npm run build && npm test` — client `typecheck` means `tsc -b` (see `context.md`
  §4/§5 if this needs re-deriving; do not reintroduce a plain `tsc --noEmit` there).
- Dev servers only inside tmux. Ports 3001/5173 are usually the owner's; use
  3099/5174 for anything you start, checking `lsof -iTCP:<port> -sTCP:LISTEN` first.
  Never `pkill` by a bare command-line pattern — it can kill a process you didn't
  start (this happened once already in this project; see `context.md` §5).
- Never call the real OpenRouter API. Point `OPENROUTER_URL` at a stub.
- `context.md` is git-ignored: edit it on disk, never `git add` it.
- Do not reopen: that editing is branching (not in-place mutation), that Retry means
  "resend the same user message as a sibling" (not a distinct concept), that the
  switcher's behavior (siblings ordered by `createdAt`, `PATCH headId` resolves to
  the latest leaf, 409 while running) is already correct and untouched by this plan.
  Only the switcher's exact glyphs/spacing are undecided — this plan settles that.

---

## File structure

| File | Responsibility | Status |
| --- | --- | --- |
| `src/session/types.ts` | `QueuedMessage.parentId` becomes `string \| null` (was `string \| undefined`) so a queued edit-and-resend of the first message can represent an explicit new root | modify |
| `src/session/runner.ts` | The enqueue branch of `startTurn` preserves an explicit `null` parentId instead of dropping it | modify |
| `src/session/routes.ts` | `PatchQueueItem`'s `parentId` field becomes nullable, matching the type | modify |
| `src/session/runner.test.ts` | New test proving the queued-new-root fix | modify |
| `client/src/lib/session-types.ts` | Mirror of the `QueuedMessage.parentId` type change | modify |
| `client/src/lib/session-client.ts` | `sendMessage` gains an optional `{ parentId }`; new `moveHead` wrapper for `PATCH { headId }` | modify |
| `client/src/components/chat/user-message.tsx` | Hover-revealed Edit button; `‹ k/n ›` switcher when siblings exist | modify |
| `client/src/components/chat/message-thread.tsx` | Takes `allMessages` (for sibling lookups) and `onEdit`/`onSwitchBranch`/`onRetry`; the failed-turn Alert gains a Retry button | modify |
| `client/src/pages/chat.tsx` | Owns "editing" state, resolves the retry target from `turns`/`messages`, wires the three new callbacks | modify |
| `README.md`, `docs/conversations-design.md`, `context.md` | Docs | modify |

---

### Task 1: Harness — a queued edit-and-resend can represent an explicit new root

**Why this is a real, if narrow, bug, not a hypothetical:** `TurnInput.parentId` is
`string | null | undefined` — `undefined` means "current head", `null` means "force a
new root" (editing the very first message). `QueuedMessage.parentId`, added in Plan 1
and unchanged through Plan 3, is only `string | undefined` — it cannot represent
`null` at all. `startTurn`'s enqueue branch (added in Plan 3 Task 1) builds the queued
item with `...(input.parentId ? { parentId: input.parentId } : {})` — a **truthy**
check, so `input.parentId === null` (a deliberate new-root request) is treated
exactly like `undefined` and silently dropped. The practical effect: if a user edits
the very first message of a session *while a turn happens to be running*, the queued
edit is dequeued later against whatever the head is *by then*, instead of becoming
the new root it was supposed to be. Plan 3 flagged this exact gap and assigned it to
this plan ("revisit whether `QueuedMessage.parentId` needs to represent an explicit
new-root now that edit-and-resend actually exists").

**Files:**
- Modify: `src/session/types.ts`, `src/session/runner.ts`, `src/session/routes.ts`
- Modify: `src/session/runner.test.ts`
- Modify: `client/src/lib/session-types.ts` (mirror only, no logic)

- [ ] **Step 1: Write the failing test**

Append inside the `describe("runner", …)` block of `src/session/runner.test.ts`,
near the other queue tests:

```ts
  it("preserves an explicit new-root parentId when queuing, unlike 'head at send time'", async () => {
    const slow = await startStubLlm(() => ({ text: "slow", delayMs: 300 }));
    useStubLlm(slow);
    try {
      const session = await runner.createSession();
      const first = await runner.startTurn(session.id, { parts: text("v1") });
      assert.ok(first && first.started);

      // Edit-and-resend of the very first message, queued because "v1" is still running.
      const b = await runner.startTurn(session.id, { parts: text("v2"), parentId: null });
      assert.ok(b && !b.started && b.reason === "queued");
      assert.equal(b.queued.parentId, null);

      await runner.awaitIdle(session.id); // lets both turns finish, including the auto-continue

      const snap = await runner.getSnapshot(session.id);
      const roots = snap!.messages.filter((m) => m.parentId === null);
      // v2 must be its own root, NOT a child of v1's answer (the head at dequeue time).
      assert.equal(roots.length, 2);
    } finally {
      await slow.close();
      useStubLlm(stub);
    }
  });
```

- [ ] **Step 2: Run to verify failure**

Run (repo root): `npm test`
Expected: FAIL — `roots.length` is `1`, not `2` (today `v2` silently attaches under
`v1`'s answer instead of becoming a second root).

- [ ] **Step 3: Fix the type and the enqueue construction**

In `src/session/types.ts`, change `QueuedMessage`:

```ts
export interface QueuedMessage extends TurnSettings {
  /** Becomes the ChatMessage id when the message is sent. */
  id: string;
  parts: Part[];
  /** undefined = head at send time; null = force a new root (matches TurnInput). */
  parentId?: string | null;
  queuedAt: string;
}
```

In `client/src/lib/session-types.ts`, make the identical change to the mirrored
`QueuedMessage` interface (same doc comment).

In `src/session/runner.ts`'s `startTurn`, change the enqueue construction's
`parentId` line from a truthy check to an `undefined` check, so an explicit `null`
survives:

```ts
        const queued: QueuedMessage = {
          id: input.messageId ?? randomUUID(),
          parts: input.parts,
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.agent ? { agent: input.agent } : {}),
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
          queuedAt: new Date().toISOString(),
        };
```

(Only the `parentId` line changes — `?` becomes `!== undefined`. Everything else in
this object is unchanged.)

In `src/session/routes.ts`, make `PatchQueueItem`'s `parentId` nullable, matching the
type (so a queued item's parent can also be explicitly cleared back to "new root" via
`PATCH`, not just set at creation):

```ts
const PatchQueueItem = z
  .object({
    parts: z.array(UserPart).min(1).max(50).optional(),
    parentId: z.string().min(1).max(64).nullable().optional(),
    model: Settings.model,
    agent: Settings.agent,
  })
  .refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
```

(Only the `parentId` line changes — add `.nullable()`.)

- [ ] **Step 4: Run to verify pass**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; `# pass 54`, `# fail 0` (53 from Plans 1-3 plus this one).

- [ ] **Step 5: Verify the client mirror compiles**

```bash
cd client && npm run typecheck
```

Expected: clean — `patchQueuedMessage`'s patch type
(`Partial<Pick<QueuedMessage, "parts"|"parentId"|"model"|"agent">>`) picks up the
wider `parentId` type automatically from the mirrored interface; no other client
file references `QueuedMessage.parentId` yet (that starts in Task 3).

- [ ] **Step 6: Commit**

```bash
git add src/session/types.ts src/session/runner.ts src/session/routes.ts src/session/runner.test.ts client/src/lib/session-types.ts
git commit -m "fix(session): a queued edit-and-resend can force a new root, not just inherit the head"
```

---

### Task 2: Client — session-client wrappers for branching

**Files:**
- Modify: `client/src/lib/session-client.ts`

- [ ] **Step 1: Extend `sendMessage` with an optional `parentId` override**

Read the file first — this is an additive change to one function; every existing
3-argument call site (`chat.tsx`'s plain `send()`, Plan 3's queue flows) keeps
compiling and behaving identically, since the new parameter is optional.

Replace:

```ts
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
  if (res.status === 202)
    return {
      status: "queued",
      queued: (await res.json()).queued as QueuedMessage,
    }
  await expectOk(res, "message send")
  return { status: "started", turn: (await res.json()) as StartedTurn }
}
```

with:

```ts
export const sendMessage = async (
  base: string,
  sessionId: string,
  text: string,
  /** Omitted = current head. null = force a new root. A specific id = branch from there. */
  options?: { parentId?: string | null }
): Promise<SendOutcome> => {
  const res = await call(base, `/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      text,
      ...(options?.parentId !== undefined ? { parentId: options.parentId } : {}),
    }),
  })
  if (res.status === 202)
    return {
      status: "queued",
      queued: (await res.json()).queued as QueuedMessage,
    }
  await expectOk(res, "message send")
  return { status: "started", turn: (await res.json()) as StartedTurn }
}
```

- [ ] **Step 2: Add `moveHead`**

Add after `renameSession` (the other function that PATCHes `/api/sessions/:id`):

```ts
/**
 * Switch the session's current branch. The harness resolves `messageId` to that
 * branch's latest leaf — pointing at any message on a branch shows the whole
 * branch through to its most recent answer. Refuses (409) while a turn is running.
 */
export const moveHead = async (
  base: string,
  sessionId: string,
  messageId: string
): Promise<Session> => {
  const res = await call(base, `/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({ headId: messageId }),
  })
  if (res.status === 409) {
    const text = await res.text().catch(() => "")
    throw new Error(`Cannot switch branch — a turn is running${text ? `: ${text}` : ""}`)
  }
  const session = await expectOk(res, "branch switch")
  return (await session.json()) as Session
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run build && npm test
git add src/lib/session-client.ts
git commit -m "feat(client): session-client wrappers for editing and switching branches"
```

Expected: all clean; `Tests 25 passed` — unchanged (no test file for this thin
wrapper layer, consistent with Plan 2/3's own precedent for `session-client.ts`;
verified instead by Task 5's real-browser walkthrough).

---

### Task 3: Client — Edit-and-resend, with the branch switcher

**Files:**
- Modify: `client/src/components/chat/user-message.tsx`, `client/src/components/chat/message-thread.tsx`, `client/src/pages/chat.tsx`

- [ ] **Step 1: Install the switcher's building block**

```bash
cd client && npx shadcn@latest add button-group
```

Expected: `client/src/components/ui/button-group.tsx` created, exporting
`ButtonGroup`, `ButtonGroupText`, `ButtonGroupSeparator`. Its only dependency,
`separator`, is already installed, so nothing else should change. Check
`git status --short` afterward: only `button-group.tsx` should be new.

- [ ] **Step 2: Rewrite `user-message.tsx`**

Replace the file in full:

```tsx
// client/src/components/chat/user-message.tsx
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon, Edit02Icon } from "@hugeicons/core-free-icons"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ChatMessage } from "@/lib/session-types"

export interface SiblingSwitcher {
  /** This message's position among its siblings, 0-based. */
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
}

/**
 * The user's text, right-aligned. Edit and the sibling switcher live in a
 * footer row that only shows on hover/focus (`group/message`, already carried
 * by the Message wrapper) — the same reveal pattern used for sidebar row
 * actions, so a message bubble doesn't compete with the text at rest.
 */
export function UserMessage({
  message,
  sibling,
  onEdit,
}: {
  message: ChatMessage
  /** Present only when this message has more than one sibling. */
  sibling?: SiblingSwitcher
  onEdit: () => void
}) {
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
        <MessageFooter className="opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
          {sibling && sibling.total > 1 && (
            <ButtonGroup>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Previous version"
                disabled={sibling.index === 0}
                onClick={sibling.onPrev}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} />
              </Button>
              <ButtonGroupText>
                {sibling.index + 1}/{sibling.total}
              </ButtonGroupText>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Next version"
                disabled={sibling.index === sibling.total - 1}
                onClick={sibling.onNext}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} />
              </Button>
            </ButtonGroup>
          )}
          <Tooltip>
            <TooltipTrigger render={<Button size="icon-xs" variant="ghost" aria-label="Edit message" onClick={onEdit} />}>
              <HugeiconsIcon icon={Edit02Icon} />
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
        </MessageFooter>
      </MessageContent>
    </Message>
  )
}
```

If `ButtonGroupText`'s children must be a single text node (check the installed
file if the build errors on the `{sibling.index + 1}/{sibling.total}` JSX
expression — some registry components are strict about children types) wrap it in
a template string instead: `` {`${sibling.index + 1}/${sibling.total}`} ``.

- [ ] **Step 3: Update `message-thread.tsx`**

Add sibling lookups and the two new callbacks. Read the file first (quoted in
"Read first" above). Replace the imports and props interface:

```tsx
import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatIcon } from "@hugeicons/core-free-icons"

import { AssistantMessage } from "@/components/chat/assistant-message"
import { UserMessage } from "@/components/chat/user-message"
import { PermissionPrompt, type PermissionChoice } from "@/components/permission-prompt"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import { siblingsOf } from "@/lib/tree"
import type { ChatMessage } from "@/lib/session-types"
import type { PendingPermission } from "@/lib/types"

interface MessageThreadProps {
  /** Completed messages on the current branch, root first. */
  messages: ChatMessage[]
  /** Every message in the session, every branch — for sibling lookups only. */
  allMessages: ChatMessage[]
  /** The assistant message being written right now, if any. */
  liveAssistant?: ChatMessage
  permissions: PendingPermission[]
  lastError?: string
  onDecide: (requestId: string, decision: PermissionChoice) => void
  onEdit: (message: ChatMessage) => void
  onSwitchBranch: (messageId: string) => void
  /** Present only when the last turn failed and can be retried. */
  onRetry?: () => void
}
```

Replace the function signature and the `messages.map(...)` block:

```tsx
export function MessageThread({
  messages,
  allMessages,
  liveAssistant,
  permissions,
  lastError,
  onDecide,
  onEdit,
  onSwitchBranch,
  onRetry,
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
            {messages.map((message) => {
              const sib = message.role === "user" ? siblingsOf(allMessages, message.id) : null
              return (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  {message.role === "user" ? (
                    <UserMessage
                      message={message}
                      onEdit={() => onEdit(message)}
                      sibling={
                        sib && sib.total > 1
                          ? {
                              index: sib.index,
                              total: sib.total,
                              onPrev: () => onSwitchBranch(sib.ids[sib.index - 1]),
                              onNext: () => onSwitchBranch(sib.ids[sib.index + 1]),
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <AssistantMessage message={message} live={false} />
                  )}
                </MessageScrollerItem>
              )
            })}
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
                  <AlertDescription className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 break-words">{lastError}</span>
                    {onRetry && (
                      <Button size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
                        Retry
                      </Button>
                    )}
                  </AlertDescription>
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

(`onRetry` is added here so Task 4 doesn't have to touch this file again; it is
`undefined` until Task 4 wires it, so the button simply never renders until then.)

- [ ] **Step 4: Wire "editing" state into `chat.tsx`**

Add to the imports from `@/lib/session-client`:

```ts
import {
  cancelSession,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  moveHead,
  removeQueuedMessage,
  renameSession,
  replySessionPermission,
  sendMessage,
  sendQueuedMessage,
  streamSession,
} from "@/lib/session-client"
```

Add state and a reset-on-session-change effect, right after the existing
`selected`/`selectedId` derivation:

```ts
  const [editTarget, setEditTarget] = React.useState<{
    parentId: string | null
    originalText: string
  } | null>(null)

  // Editing state is per-session, and stale across a session switch.
  React.useEffect(() => {
    setEditTarget(null)
  }, [selectedId])
```

Replace `send()` so it branches from `editTarget` when present, and clears it
after a successful (started or queued) send:

```ts
  const send = async () => {
    if (!selectedId || !draft.trim()) return
    const text = draft
    const parentId = editTarget?.parentId
    setDraft("")
    try {
      const outcome = await sendMessage(
        base,
        selectedId,
        text,
        parentId !== undefined ? { parentId } : undefined
      )
      if (outcome.status === "queued") {
        toast("Queued — it will send once the current turn finishes")
      }
      setEditTarget(null)
    } catch (error) {
      setDraft(text)
      toast.error(describe(error))
    }
  }
```

Add three new handlers, after `send`:

```ts
  const editMessage = (message: ChatMessage) => {
    const text = message.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n\n")
    setEditTarget({ parentId: message.parentId, originalText: text })
    setDraft(text)
  }

  const cancelEdit = () => {
    setEditTarget(null)
    setDraft("")
  }

  const switchBranch = async (messageId: string) => {
    if (!selectedId) return
    try {
      await moveHead(base, selectedId, messageId)
    } catch (error) {
      toast.error(describe(error))
    }
  }
```

Add the `ChatMessage` type import next to the existing `QueuedMessage` one:

```ts
import type { ChatMessage, QueuedMessage } from "@/lib/session-types"
```

- [ ] **Step 5: Show an editing indicator, and pass everything to `MessageThread`**

Add, right after the `list` variable and before the `return (`:

```tsx
  const editingBanner = editTarget && (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">Editing a previous message — sending will branch from here.</span>
      <Button size="xs" variant="ghost" onClick={cancelEdit}>
        Cancel
      </Button>
    </div>
  )
```

Update the `<MessageThread>` element:

```tsx
        <MessageThread
          messages={path}
          allMessages={selected?.messages ?? []}
          liveAssistant={selected?.liveTurn?.assistant}
          permissions={selected?.permissions ?? []}
          lastError={selected?.lastError}
          onDecide={(id, decision) => void decide(id, decision)}
          onEdit={editMessage}
          onSwitchBranch={(id) => void switchBranch(id)}
        />

        {editingBanner}

```

(`onRetry` is intentionally omitted here — Task 4 adds it.)

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run build && npm test
git add src/components/chat/user-message.tsx src/components/chat/message-thread.tsx src/pages/chat.tsx src/components/ui/button-group.tsx
git commit -m "feat(client): edit-and-resend with a branch switcher on messages with siblings"
```

Expected: all clean; `Tests 25 passed` — unchanged (no new test file; this task is
presentational/wiring, verified by Task 5's real-browser walkthrough, consistent
with how Plan 3's own composer-chip task had no dedicated test file either).

---

### Task 4: Client — Retry a failed turn

**Files:**
- Modify: `client/src/pages/chat.tsx`

- [ ] **Step 1: Resolve the retry target and wire `onRetry`**

In `chat.tsx`, add right after the `path`/`running`/`disabledReason` derivations:

```ts
  // A failed turn's user message, if the most recent turn actually failed —
  // "Retry" resends its exact parts as a sibling of its own parent, per
  // design §15 ("resend the same user message as a sibling"). lastError and
  // turns are kept in sync by the same run.end fold, so this is safe to
  // derive rather than track separately.
  const lastTurn = selected?.turns[selected.turns.length - 1]
  const retryTarget =
    lastTurn?.status === "failed"
      ? selected?.messages.find((m) => m.id === lastTurn.userMessageId)
      : undefined

  const retry = async () => {
    if (!selectedId || !retryTarget) return
    const text = retryTarget.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n\n")
    try {
      const outcome = await sendMessage(base, selectedId, text, { parentId: retryTarget.parentId })
      if (outcome.status === "queued") {
        toast("Queued — it will send once the current turn finishes")
      }
    } catch (error) {
      toast.error(describe(error))
    }
  }
```

Update the `<MessageThread>` element to pass it:

```tsx
        <MessageThread
          messages={path}
          allMessages={selected?.messages ?? []}
          liveAssistant={selected?.liveTurn?.assistant}
          permissions={selected?.permissions ?? []}
          lastError={selected?.lastError}
          onDecide={(id, decision) => void decide(id, decision)}
          onEdit={editMessage}
          onSwitchBranch={(id) => void switchBranch(id)}
          onRetry={retryTarget ? () => void retry() : undefined}
        />
```

- [ ] **Step 2: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run build && npm test
git add src/pages/chat.tsx
git commit -m "feat(client): retry a failed turn by resending its message as a sibling"
```

Expected: all clean; `Tests 25 passed` — unchanged.

---

### Task 5: Real-browser verification, docs and context

**Files:**
- Modify: `README.md` (only if something is actually stale — see Step 8), `docs/conversations-design.md`, `context.md` (on disk only)

- [ ] **Step 1: Start a stub that can fail on demand, the harness, and vite**

Port 3001/5173 are usually the owner's; check first and use 3099/5174.

```bash
lsof -iTCP:3001 -sTCP:LISTEN -t >/dev/null && echo "3001 taken — use 3099" || echo "3001 free"
cat > tmp-stub.cjs <<'EOF'
// Replies with the message text echoed back, so edits/retries are easy to tell
// apart in the thread. Any message whose text is exactly "fail" gets a 500,
// so the Retry flow can be exercised on demand.
const http = require("node:http");
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    const body = JSON.parse(b);
    const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
    const text = typeof lastUser?.content === "string" ? lastUser.content : "";
    if (text.trim() === "fail") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "stub-induced failure" } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ choices: [{ delta: { content: `echo: ${text}` } }] });
    send({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } });
    res.write("data: [DONE]\n\n"); res.end();
  });
}).listen(4593);
EOF
tmux kill-session -t dulo-plan4 2>/dev/null
tmux new-session -d -s dulo-plan4 "node tmp-stub.cjs"
tmux new-window -t dulo-plan4 "PORT=3099 DULO_SESSIONS_DIR=/tmp/dulo-plan4-sessions OPENROUTER_API_KEY=test OPENROUTER_URL=http://127.0.0.1:4593/x npx tsx src/server.ts"
tmux new-window -t dulo-plan4 "cd client && npx vite --port 5174"
sleep 5
curl -s http://127.0.0.1:3099/api/health | head -c 60; echo
```

- [ ] **Step 2: Point the panel at the harness**

Open `http://localhost:5174`, Settings → API base URL `http://localhost:3099`,
confirm **Online**.

- [ ] **Step 3: Walk the branching**

Use the `agent-browser` skill (load it via the Skill tool first) to drive this for
real, not by inspection.

1. New chat, send `hello`. Expected: `echo: hello`. Hover the user bubble. Expected:
   an Edit icon appears (no switcher yet — only one version).
2. Click Edit. Expected: the composer fills with `hello`; an "Editing a previous
   message…" banner appears above the composer with a Cancel button.
3. Change the text to `hello v2` and press Send. Expected: a **new** user bubble
   with `hello v2` and its own `echo: hello v2` reply; the editing banner is gone.
   Hover the ORIGINAL `hello` bubble (scroll up if needed, or check its switcher
   directly on whichever version is currently the head). Expected: it now shows a
   `1/2` (or `2/2`) switcher with working ‹/› buttons.
4. Click `‹` (or `›`) to switch to the other version. Expected: the thread replaces
   its content with that branch's messages, ending at that branch's own reply —
   proving `PATCH headId` resolved to the latest leaf and the client re-rendered
   from the new head with no page reload.
5. Click Edit on a message, then click **Cancel**. Expected: the banner disappears
   and the draft clears without sending anything.
6. Send `fail`. Expected: the turn ends failed, an error Alert appears with the
   stub's message and a **Retry** button.
7. Click Retry. Expected: a new turn starts resending `fail` verbatim as a sibling
   of the failed attempt's parent (it will fail again with this stub — that's
   expected and fine; the point is proving the resend happens, not that it
   magically succeeds). Confirm via a network/console check or the new bubble's
   text that it really is a fresh sibling turn, not a retry of the exact same
   message object.
8. While a turn is running, send a second message so it queues, then click Edit on
   an **earlier, already-completed** message (not the queued one). Expected:
   editing still works normally (queuing and editing are independent); once the
   running turn finishes and the queued item auto-sends, confirm the queue drains
   as it did in Plan 3 and nothing about the edit interfered with it.
9. **The Task 1 fix specifically:** create a fresh session, send its very first
   message, then immediately (while it's running) edit that same first message
   (Edit → change text → Send). Expected: since the original message is queued
   while busy, and this is a `parentId: null` edit of the first message, the
   result — once auto-continued — must be a **second, independent root** message
   (check via `GET /api/sessions/:id`'s `messages`, or simply note two entries at
   the very top level with no shared parent), not a message chained under the
   first turn's answer. This is the one behavior Task 1 changed; confirm it
   concretely rather than assuming the UI "looks right".

- [ ] **Step 4: Narrow viewport**

Resize to 400px. Expected: the switcher and Edit icon still fit without wrapping
oddly or causing horizontal scroll (`document.documentElement.scrollWidth <=
window.innerWidth`); the editing banner and Retry button remain usable at this
width.

- [ ] **Step 5: Clean up**

```bash
tmux kill-session -t dulo-plan4
rm -f tmp-stub.cjs
rm -rf /tmp/dulo-plan4-sessions
```

**Never `rm -rf sessions` in the repo root.** That directory belongs to whatever
harness is running from this checkout — including the owner's own long-running one on
:3001 — because the store's root defaults to `sessions/` under the working directory
and `PORT` does not isolate it. Deleting it destroyed this project's real conversation
history once already (see `context.md` §5). The scratch harness above writes to
`DULO_SESSIONS_DIR=/tmp/dulo-plan4-sessions`, so only that throwaway path is removed.

Reset Settings' API URL to `http://localhost:3001` if changed.

- [ ] **Step 6: Design status**

In `docs/conversations-design.md`, change the status line to:

`Status: approved 2026-09-13. Plans 1-4 (session core, chat page, queue, branching) implemented <date>. Owner: Ali. Author: Claude.`

- [ ] **Step 7: context.md**

Per `CLAUDE.md`: §3 add `user-message.tsx`'s new sibling/edit props, the
`message-thread.tsx` prop additions, `chat.tsx`'s `editTarget`/retry-derivation
state, `moveHead`; §4 decision rows for: `QueuedMessage.parentId` becoming nullable
(why: Plan 3's own documented gap, now that edit-and-resend actually exists to
trigger it), Retry being a plain resend-as-sibling with no separate concept (why:
the design already settles this — quote §15), Edit taking the message out of "just
appended" mode via a small banner rather than inline-editing the bubble (why: reuses
the exact same composer/send pipeline, no second edit-in-place UI to build or keep
in sync), session-store.tsx needing zero changes (why: `session.updated{headId}`
already flows through the existing fold, `pathToHead` re-derives the view). §6
timeline row. §7 mark Plan 4 done, Plans 5-7 remaining. §8 log line with what Task 5
verified, including the specific Task-1 new-root proof. Bump **Last updated**.

- [ ] **Step 8: README (only if actually stale)**

Read the current "Chat" paragraph added in Plan 2. If it already reads correctly
with branching in place (it very likely does — nothing about editing/retrying
contradicts what's already written there), leave it alone. Only touch it if it says
something Plan 4 makes untrue.

- [ ] **Step 9: Commit**

```bash
npm run typecheck && npm test
cd client && npm run typecheck && npm run lint && npm run build && npm test && cd ..
git add docs/conversations-design.md
git commit -m "docs: branching UI in the design doc, mark plan 4 done"
```

(Only `docs/conversations-design.md` is staged here unless Step 8 found README
genuinely needed a change — `context.md` is git-ignored, never staged.)

---

## Self-review against the spec

- **§10 Branching, every bullet:** `parentId` accepted on send (already true,
  pre-existing) → Task 2/3 wire the client to actually use it. Siblings/switcher
  `n > 1` → Task 3. `PATCH headId` resolves to latest leaf (already true) → Task 2's
  `moveHead` + Task 3's wiring. `pathToHead`/`siblingsOf` (already exist, unchanged)
  → reused, not reimplemented. Switching head while running → 409 (already true,
  unchanged) → Task 2's `moveHead` surfaces it as a thrown error the UI toasts.
- **§14 component rows:** `user-message.tsx`'s "Edit → prefilled composer in
  'resend' mode; k/n switcher when siblings" → Task 3, literally. A separate
  `branch-switcher.tsx` file was **not** created — the switcher is small enough
  (one `ButtonGroup` + two buttons) to live inside `user-message.tsx` directly
  rather than as its own file with its own prop-drilling; this is a deliberate,
  disclosed deviation from §14's file list, not a missed requirement — the
  *behavior* §14 describes for the switcher is fully implemented.
- **§15 Retry row:** "resend the same user message as a sibling" → Task 4,
  literally reusing Task 2's `parentId`-aware `sendMessage`.
- **The `QueuedMessage.parentId` gap Plan 3 flagged:** fixed in Task 1, with a test
  proving the specific failure mode (a queued first-message edit no longer silently
  attaches under the wrong parent).
- **Type consistency:** `QueuedMessage.parentId`'s widened type is mirrored in the
  same task on both sides (Task 1), so no window exists where the two definitions
  disagree. `SiblingSwitcher` is defined once (`user-message.tsx`) and consumed by
  `message-thread.tsx` inline (an object literal shaped to match it) rather than a
  second exported type doing the same job.
- **Placeholders:** one, deliberate — Task 3 Step 2 flags that `ButtonGroupText`'s
  children might need to be a plain string rather than a JSX expression, with the
  exact fallback, because that detail depends on the installed registry file's
  actual prop typing, which this plan can't pin without having run the install.

## What comes after this plan

| Plan | Scope | Depends on |
| --- | --- | --- |
| 5 — Per-turn model/agent + attachments | Pickers in the composer from `/api/agents` and the model list; `PUT /files`, `GET /files/:id`; `@shadcn/attachment` chips on user messages; read text-like files into the `attachments` map before projection | 1, 2 |
| 6 — Memory | Threshold check, summarisation call, extend-not-replace, `GET/PATCH /memory`, `MemoryPanel` in a Sheet | 1, 2 |
| 7 — Switch-over | Chat as the default page; remove `runs/` from `.gitignore`; README; `context.md` | all |
