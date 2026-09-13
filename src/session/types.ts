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
