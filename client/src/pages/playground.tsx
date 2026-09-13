import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Delete02Icon,
  PlayIcon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { useHealth } from "@/components/health-provider"
import { CodeBlock } from "@/components/code-block"
import { RunStatusBadge } from "@/components/run-status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  cancelRun,
  createRun,
  fetchRuns,
  replayRun,
  streamRun,
} from "@/lib/agent-client"
import { formatDuration, formatJson, shortModel } from "@/lib/format"
import { useStore } from "@/lib/store"
import type { Run, RunStep, ToolCallRecord } from "@/lib/types"

const SUGGESTIONS = [
  "What time is it and what is 15 * 8?",
  "List the files in src",
  "What's the weather in Seoul?",
  "Show me system info",
]

function ToolCallRow({ call }: { call: ToolCallRecord }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant={call.isError ? "destructive" : "outline"}>
          {call.tool}
        </Badge>
        {call.pending ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Spinner />
            running
          </span>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(call.durationMs)}
          </span>
        )}
        {Object.keys(call.args).length > 0 && (
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {formatJson(call.args).replace(/\s+/g, " ")}
          </code>
        )}
      </div>
      {!call.pending && <CodeBlock>{call.result}</CodeBlock>}
    </div>
  )
}

function StepCard({
  step,
  isLast,
  running,
}: {
  step: RunStep
  isLast: boolean
  running: boolean
}) {
  const waiting =
    running &&
    isLast &&
    !step.assistantText &&
    step.toolCalls.every((c) => !c.pending)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Step {step.index}
        </span>
        <Separator className="flex-1" />
      </div>
      {waiting && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          {step.toolCalls.length === 0
            ? "Waiting for the model…"
            : "Sending tool results back to the model…"}
        </div>
      )}
      {step.toolCalls.map((call) => (
        <ToolCallRow key={call.id} call={call} />
      ))}
      {step.assistantText && (
        <Alert>
          <AlertTitle>Final answer</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {step.assistantText}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function RunView({ run, onStop }: { run: Run; onStop: () => void }) {
  const running = run.status === "running"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{run.query}</CardTitle>
        <CardDescription>
          {shortModel(run.model)}
          {run.durationMs > 0 && ` · ${formatDuration(run.durationMs)}`}
          {` · ${run.steps.length} ${run.steps.length === 1 ? "step" : "steps"}`}
          {run.usage && ` · ${run.usage.totalTokens.toLocaleString()} tokens`}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {running && (
            <Button variant="outline" size="sm" onClick={onStop}>
              <HugeiconsIcon icon={StopIcon} data-icon="inline-start" />
              Stop
            </Button>
          )}
          <RunStatusBadge status={run.status} reason={run.reason} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {run.steps.length === 0 && running && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            Connecting to the harness…
          </div>
        )}
        {run.steps.map((step, i) => (
          <StepCard
            key={step.index}
            step={step}
            isLast={i === run.steps.length - 1}
            running={running}
          />
        ))}
        {run.error && (
          <Alert variant="destructive">
            <AlertTitle>Run {run.status}</AlertTitle>
            <AlertDescription className="break-words">
              {run.error}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

export function PlaygroundPage() {
  const { state, dispatch } = useStore()
  const health = useHealth()
  const [query, setQuery] = React.useState("")
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const activeRun = state.runs.find((r) => r.id === activeRunId) ?? null
  const isRunning = state.runs.some((r) => r.status === "running")
  const offline = health.status === "offline"

  const submit = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isRunning) return

    const { settings, tools } = state
    const run = createRun(trimmed, settings.model)
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: "runs/add", run })
    setActiveRunId(run.id)
    setQuery("")

    const end = (status: "failed" | "cancelled", error?: string) =>
      dispatch({ type: "runs/update", id: run.id, patch: { status, error } })

    try {
      const ended = await streamRun(
        settings.apiBaseUrl,
        {
          query: trimmed,
          model: settings.model,
          maxSteps: settings.maxSteps,
          temperature: settings.temperature,
          enabledTools: tools.filter((t) => t.enabled).map((t) => t.name),
        },
        (event) => {
          dispatch({ type: "runs/event", id: run.id, event })
          if (event.type === "run.end") {
            if (event.status === "completed") toast.success("Run completed")
            else if (event.status === "failed")
              toast.error(event.error ?? "Run failed")
          }
        },
        controller.signal
      )
      if (!ended)
        end("failed", "The harness closed the stream before the run finished")
    } catch (error) {
      if (controller.signal.aborted) {
        end("cancelled")
        toast("Run cancelled")
      } else {
        const message = error instanceof Error ? error.message : String(error)
        end("failed", message)
        toast.error(message)
      }
    } finally {
      abortRef.current = null
    }
  }

  // The harness owns the run now, so Stop asks it to cancel and lets the
  // resulting run.end event close the stream. Aborting locally is the fallback
  // for a run that has not reported its server id yet.
  const stop = async () => {
    const serverId = activeRun?.serverId
    const cancelled = serverId
      ? await cancelRun(state.settings.apiBaseUrl, serverId)
      : false
    if (!cancelled) abortRef.current?.abort()
  }

  // Runs recorded by the harness that this browser has never seen, so history
  // survives clearing site data or opening the panel from another machine.
  React.useEffect(() => {
    if (health.status !== "online") return
    let cancelledEffect = false
    void fetchRuns(state.settings.apiBaseUrl)
      .then((summaries) => {
        if (cancelledEffect) return
        dispatch({
          type: "runs/merge",
          runs: summaries.map((s) => ({
            id: s.id,
            serverId: s.id,
            query: s.query,
            model: s.model,
            status: s.status,
            startedAt: s.startedAt,
            durationMs: s.durationMs,
            steps: [],
          })),
        })
      })
      .catch(() => {
        // History is a convenience; a harness without it still works.
      })
    return () => {
      cancelledEffect = true
    }
  }, [health.status, state.settings.apiBaseUrl, dispatch])

  // A merged run has no steps until its log is replayed from the harness.
  const select = (run: Run) => {
    setActiveRunId(run.id)
    if (run.steps.length > 0 || !run.serverId || run.status === "running") return
    void replayRun(state.settings.apiBaseUrl, run.serverId, (event) =>
      dispatch({ type: "runs/event", id: run.id, event })
    ).catch(() => {
      // Leave the summary as-is if the log is gone.
    })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      void submit(query)
    }
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-5">
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>New run</CardTitle>
            <CardDescription>
              Ask the agent something. It picks tools on its own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="query">Query</FieldLabel>
                <Textarea
                  id="query"
                  rows={4}
                  placeholder="What time is it and how many files are in src?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={isRunning}
                />
              </Field>
            </FieldGroup>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="xs"
                  disabled={isRunning}
                  onClick={() => setQuery(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
            {offline && (
              <Alert variant="destructive" className="mt-3">
                <AlertTitle>Harness offline</AlertTitle>
                <AlertDescription>{health.error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="justify-between">
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              to run
            </span>
            {isRunning ? (
              <Button variant="outline" onClick={stop}>
                <HugeiconsIcon icon={StopIcon} data-icon="inline-start" />
                Stop
              </Button>
            ) : (
              <Button
                disabled={!query.trim() || offline}
                onClick={() => void submit(query)}
              >
                <HugeiconsIcon icon={SentIcon} data-icon="inline-start" />
                Run
              </Button>
            )}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>
              {state.runs.length} {state.runs.length === 1 ? "run" : "runs"}{" "}
              known to this browser and the harness
            </CardDescription>
            <CardAction>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear history"
                disabled={state.runs.length === 0 || isRunning}
                onClick={() => {
                  dispatch({ type: "runs/clear" })
                  setActiveRunId(null)
                }}
              >
                <HugeiconsIcon icon={Delete02Icon} />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {state.runs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No runs yet.</p>
            ) : (
              <div className="flex max-h-72 flex-col gap-1 overflow-y-auto overscroll-contain">
                {state.runs.map((run) => (
                  <Button
                    key={run.id}
                    variant={run.id === activeRunId ? "secondary" : "ghost"}
                    className="h-auto shrink-0 justify-start py-2 text-left"
                    onClick={() => select(run)}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">{run.query}</span>
                      <span className="text-[0.625rem] text-muted-foreground">
                        {shortModel(run.model)}
                      </span>
                    </div>
                    <RunStatusBadge status={run.status} reason={run.reason} />
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0 xl:col-span-3">
        {activeRun ? (
          <RunView run={activeRun} onStop={() => void stop()} />
        ) : (
          <Empty className="h-full min-h-72 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={PlayIcon} />
              </EmptyMedia>
              <EmptyTitle>No run selected</EmptyTitle>
              <EmptyDescription>
                Start a new run or pick one from the history to watch its steps
                and tool calls.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}
