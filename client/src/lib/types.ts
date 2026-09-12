export type Page = "dashboard" | "playground" | "tools" | "settings"

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
  isError: boolean
  /** True between tool.call and tool.result events. */
  pending: boolean
}

export interface RunStep {
  index: number
  toolCalls: ToolCallRecord[]
  assistantText?: string
}

export type RunStatus = "running" | "completed" | "failed" | "cancelled"

export interface Run {
  id: string
  query: string
  model: string
  status: RunStatus
  /** ISO timestamp */
  startedAt: string
  durationMs: number
  steps: RunStep[]
  finalAnswer?: string
  error?: string
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
    }
  | { type: "assistant"; step: number; text: string }
  | {
      type: "run.end"
      status: "completed" | "failed" | "cancelled"
      finalAnswer?: string
      error?: string
      durationMs: number
      steps: number
    }
