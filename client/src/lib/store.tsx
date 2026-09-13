/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

import { DEFAULT_SETTINGS, DEFAULT_TOOLS } from "./defaults"
import type { Run, RunEvent, RunStep, Settings, ToolDef } from "./types"

const STORAGE_KEY = "dulo:v1"
const MAX_PERSISTED_RUNS = 50

interface State {
  settings: Settings
  tools: ToolDef[]
  runs: Run[]
}

type Action =
  | { type: "settings/update"; patch: Partial<Settings> }
  | { type: "settings/reset" }
  | { type: "tools/toggle"; name: string; enabled: boolean }
  | { type: "tools/replace"; tools: ToolDef[] }
  | { type: "runs/add"; run: Run }
  | { type: "runs/update"; id: string; patch: Partial<Run> }
  | { type: "runs/event"; id: string; event: RunEvent }
  | { type: "runs/clear" }

interface Persisted {
  settings: Settings
  disabledTools: string[]
  runs?: Run[]
}

const updateStep = (
  run: Run,
  index: number,
  change: (step: RunStep) => RunStep
): Run => {
  const exists = run.steps.some((s) => s.index === index)
  const steps = exists ? run.steps : [...run.steps, { index, toolCalls: [] }]
  return {
    ...run,
    steps: steps.map((s) => (s.index === index ? change(s) : s)),
  }
}

/** Fold one server-sent event into a run. Pure, returns a new run. */
const applyEvent = (run: Run, event: RunEvent): Run => {
  switch (event.type) {
    case "run.start":
      return { ...run, model: event.model, startedAt: event.startedAt }
    case "step.start":
      return updateStep(run, event.step, (s) => s)
    case "tool.call":
      return updateStep(run, event.step, (s) => ({
        ...s,
        toolCalls: [
          ...s.toolCalls,
          {
            id: event.callId,
            tool: event.tool,
            args: event.args,
            result: "",
            durationMs: 0,
            isError: false,
            pending: true,
          },
        ],
      }))
    case "tool.result":
      return updateStep(run, event.step, (s) => {
        const known = s.toolCalls.some((c) => c.id === event.callId)
        const done = {
          result: event.result,
          durationMs: event.durationMs,
          isError: event.isError,
          errorMessage: event.error?.message,
          pending: false,
        }
        return {
          ...s,
          toolCalls: known
            ? s.toolCalls.map((c) =>
                c.id === event.callId ? { ...c, ...done } : c
              )
            : [
                ...s.toolCalls,
                { id: event.callId, tool: event.tool, args: {}, ...done },
              ],
        }
      })
    case "assistant":
      return updateStep(run, event.step, (s) => ({
        ...s,
        assistantText: event.text,
      }))
    case "run.end":
      return {
        ...run,
        status: event.status,
        finalAnswer: event.finalAnswer,
        error: event.error,
        reason: event.reason,
        durationMs: event.durationMs,
      }
  }
}

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "settings/update":
      return { ...state, settings: { ...state.settings, ...action.patch } }
    case "settings/reset":
      return { ...state, settings: DEFAULT_SETTINGS }
    case "tools/toggle":
      return {
        ...state,
        tools: state.tools.map((tool) =>
          tool.name === action.name
            ? { ...tool, enabled: action.enabled }
            : tool
        ),
      }
    case "tools/replace":
      return { ...state, tools: action.tools }
    case "runs/add":
      return { ...state, runs: [action.run, ...state.runs] }
    case "runs/update":
      return {
        ...state,
        runs: state.runs.map((run) =>
          run.id === action.id ? { ...run, ...action.patch } : run
        ),
      }
    case "runs/event":
      return {
        ...state,
        runs: state.runs.map((run) =>
          run.id === action.id ? applyEvent(run, action.event) : run
        ),
      }
    case "runs/clear":
      return { ...state, runs: [] }
  }
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
  const disabled = new Set(persisted?.disabledTools ?? [])
  // A run that was in flight when the tab closed can never finish
  const runs = (persisted?.runs ?? []).map((run) =>
    run.status === "running"
      ? {
          ...run,
          status: "failed" as const,
          error: "Interrupted: the page was closed",
        }
      : run
  )
  return {
    settings: { ...DEFAULT_SETTINGS, ...persisted?.settings },
    tools: persisted
      ? DEFAULT_TOOLS.map((tool) => ({
          ...tool,
          enabled: !disabled.has(tool.name),
        }))
      : DEFAULT_TOOLS,
    runs,
  }
}

interface StoreValue {
  state: State
  dispatch: React.Dispatch<Action>
}

const StoreContext = React.createContext<StoreValue | undefined>(undefined)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initialState)

  React.useEffect(() => {
    const persisted: Persisted = {
      settings: state.settings,
      disabledTools: state.tools.filter((t) => !t.enabled).map((t) => t.name),
      runs: state.runs.slice(0, MAX_PERSISTED_RUNS),
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      // Storage can be unavailable (private mode); the panel still works in memory.
    }
  }, [state.settings, state.tools, state.runs])

  const value = React.useMemo(() => ({ state, dispatch }), [state])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export const useStore = (): StoreValue => {
  const context = React.useContext(StoreContext)
  if (context === undefined) {
    throw new Error("useStore must be used within a StoreProvider")
  }
  return context
}
