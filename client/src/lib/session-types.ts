// client/src/lib/session-types.ts
// Mirror of src/session/types.ts in the harness — keep the two in sync the way
// types.ts mirrors src/events.ts. Plus the response shapes of the session API.
import type { RiskTier, RunEvent, RunUsage } from "./types"

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
  /** undefined = head at send time; null = force a new root (matches TurnInput). */
  parentId?: string | null
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
  /** See PendingPermission in types.ts; both mirror src/permissions.ts. */
  tier?: RiskTier
  what?: string
  where?: string
  undo?: string
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
