import type { HealthInfo, Run, RunEvent, ServerTool } from "./types"

/** HTTP client for the Dulo harness API (src/server.ts in the harness). */

export interface RunRequest {
  query: string
  model?: string
  maxSteps?: number
  temperature?: number
  /** Tool names the model may use. Omit for all tools. */
  enabledTools?: string[]
}

export const CONNECTION_HINT =
  "Start the harness API with `npm run serve` in the harness folder."

const endpoint = (base: string, path: string): string =>
  `${base.replace(/\/+$/, "")}${path}`

const describeFailure = (error: unknown): string => {
  if (error instanceof TypeError) {
    // fetch rejects with TypeError when the server is unreachable
    return `Cannot reach the harness. ${CONNECTION_HINT}`
  }
  return error instanceof Error ? error.message : String(error)
}

export const fetchHealth = async (
  base: string,
  signal?: AbortSignal
): Promise<HealthInfo> => {
  try {
    const res = await fetch(endpoint(base, "/api/health"), { signal })
    if (!res.ok) throw new Error(`Harness returned ${res.status}`)
    return (await res.json()) as HealthInfo
  } catch (error) {
    throw new Error(describeFailure(error), { cause: error })
  }
}

export const fetchTools = async (base: string): Promise<ServerTool[]> => {
  try {
    const res = await fetch(endpoint(base, "/api/tools"))
    if (!res.ok) throw new Error(`Harness returned ${res.status}`)
    return (await res.json()) as ServerTool[]
  } catch (error) {
    throw new Error(describeFailure(error), { cause: error })
  }
}

/** Parse `data:` lines out of one SSE message and forward them. */
const forwardEvents = (chunk: string, onEvent: (event: RunEvent) => void) => {
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data:")) continue
    onEvent(JSON.parse(line.slice(5).trim()) as RunEvent)
  }
}

/** Drain one SSE body, forwarding every event until the stream ends. */
const drain = async (
  body: ReadableStream<Uint8Array>,
  handle: (event: RunEvent) => void
): Promise<void> => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf("\n\n")
    while (boundary !== -1) {
      forwardEvents(buffer.slice(0, boundary), handle)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf("\n\n")
    }
  }
  if (buffer.trim()) forwardEvents(buffer, handle)
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000
const MAX_RECONNECTS = 8

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DOMException("aborted", "AbortError"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })

/**
 * POST a run, then stream its events — reconnecting if the connection drops
 * before the run finishes. The harness keeps running independently of any one
 * connection, so a refresh or a wifi blip resumes from the last seq seen rather
 * than losing the run. Resolves true once run.end arrives.
 */
export const streamRun = async (
  base: string,
  request: RunRequest,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal
): Promise<boolean> => {
  let res: Response
  try {
    res = await fetch(endpoint(base, "/api/run"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    })
  } catch (error) {
    throw new Error(describeFailure(error), { cause: error })
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Harness rejected the run (${res.status}): ${text}`)
  }
  if (!res.body) {
    throw new Error("Harness returned an empty stream")
  }

  let ended = false
  let runId: string | undefined
  let lastSeq = 0
  const handle = (event: RunEvent) => {
    const { seq } = event as { seq?: number }
    if (typeof seq === "number") lastSeq = Math.max(lastSeq, seq)
    if (event.type === "run.start") runId = event.runId
    if (event.type === "run.end") ended = true
    onEvent(event)
  }

  await drain(res.body, handle)

  // The stream ended without run.end, so the connection dropped rather than the
  // run finishing. Reattach where we left off.
  for (let attempt = 0; !ended && runId && attempt < MAX_RECONNECTS; attempt++) {
    if (signal.aborted) break
    await wait(
      Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS),
      signal
    )
    let again: Response
    try {
      again = await fetch(
        endpoint(base, `/api/run/${runId}/stream?after=${lastSeq}`),
        { signal }
      )
    } catch {
      continue // harness still unreachable, back off further
    }
    if (again.status === 404) break // the run is gone, stop trying
    if (!again.ok || !again.body) continue
    await drain(again.body, handle)
  }

  return ended
}

/** Replay a finished run's event log from the harness, oldest event first. */
export const replayRun = async (
  base: string,
  runId: string,
  onEvent: (event: RunEvent) => void
): Promise<void> => {
  const res = await fetch(endpoint(base, `/api/run/${runId}/stream?after=0`))
  if (!res.ok || !res.body) {
    throw new Error(`Harness has no log for run ${runId}`)
  }
  await drain(res.body, onEvent)
}

/** Ask the harness to stop a run. The run id comes from the run.start event. */
export const cancelRun = async (
  base: string,
  runId: string
): Promise<boolean> => {
  try {
    const res = await fetch(endpoint(base, `/api/run/${runId}/cancel`), {
      method: "POST",
    })
    return res.ok
  } catch {
    return false
  }
}

export interface RunSummary {
  id: string
  query: string
  model: string
  startedAt: string
  status: "running" | "completed" | "failed" | "cancelled"
  steps: number
  durationMs: number
}

/** Run history as the harness recorded it, independent of this browser. */
export const fetchRuns = async (base: string): Promise<RunSummary[]> => {
  try {
    const res = await fetch(endpoint(base, "/api/runs"))
    if (!res.ok) throw new Error(`Harness returned ${res.status}`)
    return (await res.json()) as RunSummary[]
  } catch (error) {
    throw new Error(describeFailure(error), { cause: error })
  }
}

export const createRun = (query: string, model: string): Run => ({
  id: crypto.randomUUID(),
  query,
  model,
  status: "running",
  startedAt: new Date().toISOString(),
  durationMs: 0,
  steps: [],
})
