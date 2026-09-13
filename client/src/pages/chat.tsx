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
