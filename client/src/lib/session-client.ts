// client/src/lib/session-client.ts
// HTTP client for /api/sessions/* (src/session/routes.ts in the harness).
import { describeFailure, drain, endpoint, wait } from "./agent-client"
import type {
  QueuedMessage,
  Session,
  SessionEvent,
  SessionSnapshot,
  SessionSummary,
  StartedTurn,
} from "./session-types"

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

const jsonHeaders = { "Content-Type": "application/json" }

/** fetch that turns network failures into the panel's standard message. */
const call = async (
  base: string,
  path: string,
  init?: RequestInit
): Promise<Response> => {
  try {
    return await fetch(endpoint(base, path), init)
  } catch (error) {
    throw new Error(describeFailure(error), { cause: error })
  }
}

const expectOk = async (res: Response, what: string): Promise<Response> => {
  if (res.ok) return res
  const text = await res.text().catch(() => "")
  throw new Error(
    `Harness ${what} failed (${res.status})${text ? `: ${text}` : ""}`
  )
}

export const listSessions = async (base: string): Promise<SessionSummary[]> => {
  const res = await expectOk(await call(base, "/api/sessions"), "session list")
  return (await res.json()) as SessionSummary[]
}

export const createSession = async (
  base: string,
  input: { title?: string } = {}
): Promise<Session> => {
  const res = await expectOk(
    await call(base, "/api/sessions", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    }),
    "session create"
  )
  return (await res.json()) as Session
}

export const getSession = async (
  base: string,
  id: string
): Promise<SessionSnapshot> => {
  const res = await expectOk(
    await call(base, `/api/sessions/${id}`),
    "session load"
  )
  return (await res.json()) as SessionSnapshot
}

export const renameSession = async (
  base: string,
  id: string,
  title: string
): Promise<Session> => {
  const res = await expectOk(
    await call(base, `/api/sessions/${id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ title }),
    }),
    "session rename"
  )
  return (await res.json()) as Session
}

export const deleteSession = async (
  base: string,
  id: string
): Promise<void> => {
  await expectOk(
    await call(base, `/api/sessions/${id}`, { method: "DELETE" }),
    "session delete"
  )
}

export type SendOutcome =
  | { status: "started"; turn: StartedTurn }
  | { status: "queued"; queued: QueuedMessage }

export const sendMessage = async (
  base: string,
  sessionId: string,
  text: string
): Promise<SendOutcome> => {
  const res = await call(base, `/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ text }),
  })
  if (res.status === 202)
    return {
      status: "queued",
      queued: (await res.json()).queued as QueuedMessage,
    }
  await expectOk(res, "message send")
  return { status: "started", turn: (await res.json()) as StartedTurn }
}

export const cancelSession = async (
  base: string,
  id: string
): Promise<boolean> => {
  try {
    const res = await call(base, `/api/sessions/${id}/cancel`, {
      method: "POST",
    })
    return res.ok
  } catch {
    return false
  }
}

export const replySessionPermission = async (
  base: string,
  sessionId: string,
  requestId: string,
  decision: "allow" | "deny" | "always"
): Promise<boolean> => {
  try {
    const res = await call(
      base,
      `/api/sessions/${sessionId}/permission/${requestId}`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ decision }),
      }
    )
    return res.ok
  } catch {
    return false
  }
}

export const patchQueuedMessage = async (
  base: string,
  sessionId: string,
  msgId: string,
  patch: Partial<Pick<QueuedMessage, "parts" | "parentId" | "model" | "agent">>
): Promise<QueuedMessage> => {
  const res = await expectOk(
    await call(base, `/api/sessions/${sessionId}/queue/${msgId}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(patch),
    }),
    "queued message patch"
  )
  return (await res.json()) as QueuedMessage
}

export const removeQueuedMessage = async (
  base: string,
  sessionId: string,
  msgId: string
): Promise<void> => {
  await expectOk(
    await call(base, `/api/sessions/${sessionId}/queue/${msgId}`, {
      method: "DELETE",
    }),
    "queued message remove"
  )
}

export type SendQueuedOutcome =
  { sent: true; turn: StartedTurn } | { sent: false }

export const sendQueuedMessage = async (
  base: string,
  sessionId: string,
  msgId: string
): Promise<SendQueuedOutcome> => {
  const res = await call(
    base,
    `/api/sessions/${sessionId}/queue/${msgId}/send`,
    { method: "POST" }
  )
  if (res.status === 409) return { sent: false }
  await expectOk(res, "queued message send")
  return { sent: true, turn: (await res.json()) as StartedTurn }
}

const backoff = (attempt: number): number =>
  Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)

/**
 * Follow a session's event stream from `after`, reconnecting with backoff
 * whenever the connection drops, until `signal` aborts or the session is gone.
 * The harness keeps session streams open across turns, so a normal end of
 * body means the connection was lost, not that anything finished.
 */
export const streamSession = async (
  base: string,
  sessionId: string,
  after: number,
  onEvent: (event: SessionEvent) => void,
  signal: AbortSignal
): Promise<void> => {
  let lastSeq = after
  let attempt = 0

  while (!signal.aborted) {
    let res: Response
    try {
      res = await fetch(
        endpoint(base, `/api/sessions/${sessionId}/events?after=${lastSeq}`),
        { signal }
      )
    } catch {
      if (signal.aborted) return
      await wait(backoff(attempt++), signal).catch(() => {})
      continue
    }
    if (res.status === 404) return // the session was deleted; stop for good
    if (!res.ok || !res.body) {
      await wait(backoff(attempt++), signal).catch(() => {})
      continue
    }

    attempt = 0
    try {
      await drain<SessionEvent>(res.body, (event) => {
        if (event.seq > lastSeq) lastSeq = event.seq
        onEvent(event)
      })
    } catch {
      if (signal.aborted) return
    }
    if (signal.aborted) return
    await wait(backoff(attempt++), signal).catch(() => {})
  }
}
