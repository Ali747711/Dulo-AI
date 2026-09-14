export type Page = "dashboard" | "chat" | "playground" | "tools" | "settings"

export type ToolCategory = "files" | "system" | "network" | "utility"

export interface ToolDef {
  name: string
  description: string
  category: ToolCategory
  enabled: boolean
  /** JSON Schema for the tool's arguments, mirrors `parameters` in the harness. */
  parameters: Record<string, unknown>
}

/** Tool as returned by GET /api/tools on the harness. */
export interface ServerTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCallRecord {
  id: string
  tool: string
  args: Record<string, unknown>
  result: string
  durationMs: number
  /** True only when the tool threw, never inferred from the result text. */
  isError: boolean
  /** Present when isError; the message without the "Error: " prefix. */
  errorMessage?: string
  /** True between tool.call and tool.result events. */
  pending: boolean
}

export interface RunStep {
  index: number
  toolCalls: ToolCallRecord[]
  assistantText?: string
}

export type RunStatus = "running" | "completed" | "failed" | "cancelled"

/**
 * Why a run ended. "step-limit" means the agent ran out of steps and summarised
 * what it had instead of failing outright.
 */
export type RunEndReason = "answered" | "step-limit"

export type PermissionDecision = "allow" | "deny" | "always" | "timeout"

/** A gated tool call waiting on the user before it runs. */
/** Mirrors RiskTier in src/risk.ts. */
export type RiskTier = "allowed" | "ask" | "confirm"

export interface PendingPermission {
  id: string
  step: number
  tool: string
  args: Record<string, unknown>
  /** "confirm" is asked every time and offers no blanket yes. */
  tier?: RiskTier
  /** Plain language, for someone who is not an engineer. */
  what?: string
  where?: string
  undo?: string
}

/** Token counts summed over every model call in a run. */
export interface RunUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface Run {
  id: string
  /** Id the harness gave this run, from run.start. Needed to reattach or cancel. */
  serverId?: string
  /** Highest event seq seen, so a reconnect can resume from it. */
  lastSeq?: number
  query: string
  model: string
  status: RunStatus
  /** ISO timestamp */
  startedAt: string
  durationMs: number
  steps: RunStep[]
  finalAnswer?: string
  error?: string
  reason?: RunEndReason
  usage?: RunUsage
  /** Unanswered permission requests, newest last. */
  permissions?: PendingPermission[]
  /** Steps where older context was condensed away. */
  condensedAt?: number[]
}

export interface Settings {
  model: string
  fallbackModels: string[]
  temperature: number
  maxSteps: number
  apiBaseUrl: string
}

export interface ModelOption {
  id: string
  label: string
  context: string
}

/** Response of GET /api/health on the harness. */
export interface HealthInfo {
  ok: boolean
  name: string
  model: string
  fallbackModels: string[]
  hasApiKey: boolean
  toolCount: number
}

/**
 * Server-sent events streamed by POST /api/run.
 * Mirrors src/events.ts in the harness, keep the two in sync.
 */
export type RunEvent =
  | {
      type: "run.start"
      runId: string
      query: string
      model: string
      startedAt: string
      /** Set when the run is a turn inside a session. runId === turnId. */
      sessionId?: string
      turnId?: string
      userMessageId?: string
      assistantMessageId?: string
    }
  | { type: "step.start"; step: number }
  | {
      type: "tool.call"
      step: number
      callId: string
      tool: string
      args: Record<string, unknown>
    }
  | {
      type: "tool.result"
      step: number
      callId: string
      tool: string
      result: string
      durationMs: number
      isError: boolean
      error?: { message: string }
    }
  | {
      type: "permission.ask"
      step: number
      id: string
      tool: string
      args: Record<string, unknown>
      tier?: RiskTier
      what?: string
      where?: string
      undo?: string
    }
  | {
      type: "permission.auto"
      step: number
      tool: string
      args: Record<string, unknown>
      what?: string
    }
  | {
      type: "permission.resolved"
      step: number
      id: string
      tool: string
      decision: PermissionDecision
    }
  | {
      type: "context.condensed"
      step: number
      droppedMessages: number
      estimatedTokens: number
    }
  | { type: "assistant.delta"; step: number; text: string }
  | { type: "assistant"; step: number; text: string }
  | {
      type: "run.end"
      status: "completed" | "failed" | "cancelled"
      finalAnswer?: string
      error?: string
      reason?: RunEndReason
      usage?: RunUsage
      durationMs: number
      steps: number
      sessionId?: string
      turnId?: string
    }
