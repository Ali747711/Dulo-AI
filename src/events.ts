// src/events.ts
// Events emitted while an agent run is in progress. The Dulo web client
// mirrors this type in client/src/lib/types.ts, keep the two in sync.

export type RunStatus = "completed" | "failed" | "cancelled";

/**
 * Why a run ended where it did. "step-limit" means the agent ran out of steps
 * and was asked for a closing summary instead of failing outright.
 */
export type RunEndReason = "answered" | "step-limit";

export type RunEvent =
  | {
      type: "run.start";
      runId: string;
      query: string;
      model: string;
      startedAt: string;
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
  | { type: "assistant"; step: number; text: string }
  | {
      type: "run.end";
      status: RunStatus;
      finalAnswer?: string;
      error?: string;
      reason?: RunEndReason;
      durationMs: number;
      steps: number;
    };

export interface RunResult {
  status: RunStatus;
  finalAnswer?: string;
  error?: string;
  reason?: RunEndReason;
  steps: number;
  durationMs: number;
}
