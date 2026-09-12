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

/**
 * POST a run and stream its events until the server closes the connection.
 * Resolves with true if a run.end event arrived, false if the stream ended early.
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

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let ended = false
  const handle = (event: RunEvent) => {
    if (event.type === "run.end") ended = true
    onEvent(event)
  }

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
  return ended
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
