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
  moveHead,
  removeQueuedMessage,
  renameSession,
  replySessionPermission,
  sendMessage,
  sendQueuedMessage,
  streamSession,
} from "@/lib/session-client"
import type { ChatMessage, QueuedMessage } from "@/lib/session-types"
import { useSessionStore } from "@/lib/session-store"
import { useStore } from "@/lib/store"
import { pathToHead } from "@/lib/tree"

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Draft slot used while no session is selected yet. Never a real session id. */
const NO_SESSION_DRAFT_KEY = "__no_session__"

export function ChatPage() {
  const { state: app } = useStore()
  const health = useHealth()
  const { state, dispatch } = useSessionStore()
  const base = app.settings.apiBaseUrl
  const online = health.status === "online"
  const [listOpen, setListOpen] = React.useState(false)

  const selected = state.selectedId ? state.loaded[state.selectedId] : undefined
  const selectedId = state.selectedId

  // Editing is per-session. The target carries its own session id rather than
  // being cleared from an effect on every switch: a stale target simply stops
  // applying, which keeps the reset out of render and out of an effect.
  const [editing, setEditing] = React.useState<{
    sessionId: string
    parentId: string | null
  } | null>(null)
  const editTarget = editing?.sessionId === selectedId ? editing : null

  // ---- session list: on mount, when the harness comes online, on focus ----
  const refreshList = React.useCallback(() => {
    dispatch({ type: "sessions/loading" })
    void listSessions(base)
      .then((summaries) => dispatch({ type: "sessions/set", summaries }))
      .catch((error) =>
        dispatch({ type: "sessions/error", error: describe(error) })
      )
  }, [base, dispatch])

  React.useEffect(() => {
    if (!online) return
    // Dispatch happens inside the promise, not synchronously in the effect —
    // the lint rule does not fire here, unlike health-provider.tsx's case.
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
      // Anything typed before a chat existed moves with the user into it,
      // rather than being silently dropped once a real session id exists.
      const pending = state.drafts[NO_SESSION_DRAFT_KEY]
      if (pending)
        dispatch({ type: "draft/set", id: session.id, text: pending })
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
          messageCount:
            state.summaries.find((s) => s.id === id)?.messageCount ?? 0,
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

  // Before any chat is selected, drafts still need a place to live: keyed by
  // a sentinel that can never collide with a real session id (those are
  // crypto.randomUUID()s), so typing works immediately on a fresh page load
  // instead of silently reverting every keystroke (a controlled input whose
  // value and onChange both no-op without a selectedId looks broken, not
  // just "can't send yet" — Send staying disabled already carries that
  // message via disabledReason).
  const draftKey = selectedId ?? NO_SESSION_DRAFT_KEY
  const draft = state.drafts[draftKey] ?? ""
  const setDraft = (text: string) => {
    dispatch({ type: "draft/set", id: draftKey, text })
  }

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
      setEditing(null)
    } catch (error) {
      setDraft(text)
      toast.error(describe(error))
    }
  }

  // Editing does not mutate the original message: the resend is a sibling of
  // it, so the harness branches and `pathToHead` shows the new branch.
  const editMessage = (message: ChatMessage) => {
    if (!selectedId) return
    const text = message.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n\n")
    setEditing({ sessionId: selectedId, parentId: message.parentId })
    setDraft(text)
  }

  const cancelEdit = () => {
    setEditing(null)
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

  const queuedText = (message: QueuedMessage): string =>
    message.parts
      .filter(
        (p): p is Extract<typeof p, { type: "text" }> => p.type === "text"
      )
      .map((p) => p.text)
      .join(" ")

  const sendQueuedNow = async (msgId: string) => {
    if (!selectedId) return
    try {
      const outcome = await sendQueuedMessage(base, selectedId, msgId)
      if (!outcome.sent)
        toast.error(
          "A turn is running — it will send automatically once it finishes"
        )
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
    void removeQueuedMessage(base, selectedId, message.id).catch((error) =>
      toast.error(describe(error))
    )
  }

  const removeQueued = (msgId: string) => {
    if (!selectedId) return
    void removeQueuedMessage(base, selectedId, msgId).catch((error) =>
      toast.error(describe(error))
    )
  }

  const stop = async () => {
    if (!selectedId) return
    if (!(await cancelSession(base, selectedId))) toast.error("Nothing to stop")
  }

  const decide = async (requestId: string, decision: PermissionChoice) => {
    if (!selectedId) return
    const ok = await replySessionPermission(
      base,
      selectedId,
      requestId,
      decision
    )
    if (!ok) toast.error("The harness did not accept that decision")
  }

  // ---- derived view state ------------------------------------------------
  const path = selected
    ? pathToHead(selected.messages, selected.session.headId)
    : []
  const running = selected?.session.status === "running"
  const disabledReason = !online
    ? "The harness is offline"
    : !selectedId
      ? "Start a new chat first"
      : undefined

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
      const outcome = await sendMessage(base, selectedId, text, {
        parentId: retryTarget.parentId,
      })
      if (outcome.status === "queued") {
        toast("Queued — it will send once the current turn finishes")
      }
    } catch (error) {
      toast.error(describe(error))
    }
  }

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

  const editingBanner = editTarget && (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">
        Editing a previous message — sending will branch from here.
      </span>
      <Button size="xs" variant="ghost" onClick={cancelEdit}>
        Cancel
      </Button>
    </div>
  )

  return (
    // The header is 3rem; main has 1rem padding (1.5rem from md). The thread
    // needs a bounded height for MessageScroller to scroll, so it is sized to
    // the viewport here rather than growing with its content.
    <div className="flex h-[calc(100dvh-3rem-2rem)] min-h-0 min-w-0 gap-4 md:h-[calc(100dvh-3rem-3rem)]">
      <aside className="hidden w-64 shrink-0 lg:flex lg:min-h-0 lg:flex-col">
        {list}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sheet open={listOpen} onOpenChange={setListOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="lg:hidden"
                  aria-label="Chats"
                />
              }
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
          allMessages={selected?.messages ?? []}
          liveAssistant={selected?.liveTurn?.assistant}
          permissions={selected?.permissions ?? []}
          lastError={selected?.lastError}
          onDecide={(id, decision) => void decide(id, decision)}
          onEdit={editMessage}
          onSwitchBranch={(id) => void switchBranch(id)}
          onRetry={retryTarget ? () => void retry() : undefined}
        />

        {editingBanner}

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
      </section>
    </div>
  )
}
