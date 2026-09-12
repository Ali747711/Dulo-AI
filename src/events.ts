// src/events.ts
// Events emitted while an agent run is in progress. The Dulo web client
// mirrors this type in client/src/lib/types.ts, keep the two in sync.

export type RunStatus = "completed" | "failed" | "cancelled";

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
      isError: boolean;
    }
  | { type: "assistant"; step: number; text: string }
  | {
      type: "run.end";
      status: RunStatus;
      finalAnswer?: string;
      error?: string;
      durationMs: number;
      steps: number;
    };

export interface RunResult {
  status: RunStatus;
  finalAnswer?: string;
  error?: string;
  steps: number;
  durationMs: number;
}
