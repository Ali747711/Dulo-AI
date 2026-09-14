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

const upsertMessage = (
  messages: ChatMessage[],
  message: ChatMessage
): ChatMessage[] =>
  messages.some((m) => m.id === message.id)
    ? messages.map((m) => (m.id === message.id ? message : m))
    : [...messages, message]

/** Fold one stream event into a loaded session. Pure; returns a new object. */
export const foldSessionEvent = (
  loaded: LoadedSession,
  event: SessionEvent
): LoadedSession => {
  const base: LoadedSession = {
    ...loaded,
    lastSeq: Math.max(loaded.lastSeq, event.seq),
  }

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
          {
            id: event.id,
            step: event.step,
            tool: event.tool,
            args: event.args,
            tier: event.tier,
            what: event.what,
            where: event.where,
            undo: event.undo,
          },
        ],
      }

    case "permission.resolved":
      return {
        ...base,
        permissions: base.permissions.filter((p) => p.id !== event.id),
      }

    case "run.end":
      return {
        ...base,
        permissions: [],
        lastError:
          event.status === "failed"
            ? (event.error ?? "The turn failed")
            : undefined,
        lastUsage: event.usage ?? base.lastUsage,
        liveTurn: base.liveTurn
          ? { ...base.liveTurn, status: event.status }
          : undefined,
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
export const loadedFromSnapshot = (
  snapshot: SessionSnapshot
): LoadedSession => {
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

const withoutKey = <T,>(
  record: Record<string, T>,
  key: string
): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).filter(([k]) => k !== key)
  ) as Record<string, T>

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "sessions/loading":
      return { ...state, listStatus: "loading", listError: undefined }
    case "sessions/set":
      return {
        ...state,
        summaries: action.summaries,
        listStatus: "ready",
        listError: undefined,
      }
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

const SessionStoreContext = React.createContext<StoreValue | undefined>(
  undefined
)

export function SessionStoreProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initialState)

  React.useEffect(() => {
    const persisted: Persisted = {
      selectedId: state.selectedId,
      drafts: state.drafts,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      // Storage can be unavailable (private mode); the page still works in memory.
    }
  }, [state.selectedId, state.drafts])

  const value = React.useMemo(() => ({ state, dispatch }), [state])

  return (
    <SessionStoreContext.Provider value={value}>
      {children}
    </SessionStoreContext.Provider>
  )
}

export const useSessionStore = (): StoreValue => {
  const context = React.useContext(SessionStoreContext)
  if (context === undefined) {
    throw new Error(
      "useSessionStore must be used within a SessionStoreProvider"
    )
  }
  return context
}
