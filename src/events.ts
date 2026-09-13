// src/events.ts
// Events emitted while an agent run is in progress. The Dulo web client
// mirrors this type in client/src/lib/types.ts, keep the two in sync.

export type RunStatus = "completed" | "failed" | "cancelled";

/**
 * Why a run ended where it did. "step-limit" means the agent ran out of steps
 * and was asked for a closing summary instead of failing outright.
 */
export type RunEndReason = "answered" | "step-limit";

/** What a human (or a timeout) decided about one gated tool call. */
export type PermissionDecision = "allow" | "deny" | "always" | "timeout";

/** Token counts summed over every model call in a run. */
export interface RunUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type RunEvent =
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
  | { type: "step.start"; step: number }
  | {
      type: "tool.call";
      step: number;
      callId: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool.result";
      step: number;
      callId: string;
      tool: string;
      result: string;
      durationMs: number;
      /** True only when the tool threw. Never inferred from the result text. */
      isError: boolean;
      /** Present when isError; the thrown message without the "Error: " prefix. */
      error?: { message: string };
    }
  /** A gated tool is waiting for a human before it runs. */
  | {
      type: "permission.ask";
      step: number;
      id: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: "permission.resolved";
      step: number;
      id: string;
      tool: string;
      decision: PermissionDecision;
    }
  /** Older messages were folded into a digest to stay inside the budget. */
  | {
      type: "context.condensed";
      step: number;
      droppedMessages: number;
      estimatedTokens: number;
    }
  /** A piece of assistant text as it streams. Concatenating every delta for a
   *  step yields the same text as that step's "assistant" event. */
  | { type: "assistant.delta"; step: number; text: string }
  | { type: "assistant"; step: number; text: string }
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

/**
 * A RunEvent as it is stored and streamed: the same shape plus a per-run
 * monotonic sequence number, so a reconnecting client can ask for everything
 * after the last one it saw.
 */
export type StoredEvent = RunEvent & { seq: number };

export interface RunResult {
  status: RunStatus;
  finalAnswer?: string;
  error?: string;
  reason?: RunEndReason;
  usage?: RunUsage;
  steps: number;
  durationMs: number;
}
