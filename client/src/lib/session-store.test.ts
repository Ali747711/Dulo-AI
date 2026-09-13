import { describe, expect, it } from "vitest"

import {
  foldSessionEvent,
  loadedFromSnapshot,
  reducer,
  type LoadedSession,
  type State,
} from "./session-store"
import type {
  ChatMessage,
  Session,
  SessionEvent,
  SessionSnapshot,
} from "./session-types"

const session = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  title: "New chat",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "idle",
  headId: null,
  queue: [],
  defaults: {},
  ...over,
})

const user: ChatMessage = {
  id: "u1",
  sessionId: "s1",
  parentId: null,
  role: "user",
  parts: [{ type: "text", text: "hi" }],
  turnId: "t1",
  createdAt: "2026-01-01T00:00:01Z",
}

const loaded = (over: Partial<LoadedSession> = {}): LoadedSession => ({
  session: session(),
  messages: [],
  turns: [],
  lastSeq: 0,
  permissions: [],
  ...over,
})

// A plain `Omit<SessionEvent, K>` collapses the union to its shared keys only
// (keyof of a union is the intersection of each member's keys), which is why
// the naive version of this helper let TypeScript accept `ev(1, { type:
// "run.start", ... })` with no per-variant checking at all — a real gap only
// `tsc -b` (the build script) catches, not `tsc --noEmit` at the repo root
// (which compiles zero files here; see context.md) or vitest (no type-check).
// Distributing over a bare type parameter keeps each union member intact.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

const ev = (
  seq: number,
  body: DistributiveOmit<SessionEvent, "sessionId" | "seq">
): SessionEvent => ({ ...body, sessionId: "s1", seq }) as SessionEvent

describe("foldSessionEvent", () => {
  it("tracks the highest seq seen", () => {
    const next = foldSessionEvent(
      loaded(),
      ev(7, { type: "step.start", step: 1 })
    )
    expect(next.lastSeq).toBe(7)
    expect(
      foldSessionEvent(next, ev(3, { type: "step.start", step: 2 })).lastSeq
    ).toBe(7)
  })

  it("appends a created user message and moves head to it", () => {
    const next = foldSessionEvent(
      loaded(),
      ev(1, { type: "message.created", message: user })
    )
    expect(next.messages).toEqual([user])
    expect(next.session.headId).toBe("u1")
  })

  it("opens a live turn with an empty assistant shell on run.start", () => {
    const next = foldSessionEvent(
      loaded({ messages: [user] }),
      ev(2, {
        type: "run.start",
        runId: "t1",
        query: "hi",
        model: "m",
        startedAt: "2026-01-01T00:00:02Z",
        turnId: "t1",
        userMessageId: "u1",
        assistantMessageId: "a1",
      })
    )
    expect(next.session.status).toBe("running")
    expect(next.liveTurn?.assistant).toMatchObject({
      id: "a1",
      parentId: "u1",
      role: "assistant",
      parts: [],
    })
    expect(next.lastError).toBeUndefined()
  })

  it("folds turn events into the live assistant", () => {
    let state = foldSessionEvent(
      loaded({ messages: [user] }),
      ev(2, {
        type: "run.start",
        runId: "t1",
        query: "hi",
        model: "m",
        startedAt: "x",
        turnId: "t1",
        userMessageId: "u1",
        assistantMessageId: "a1",
      })
    )
    state = foldSessionEvent(
      state,
      ev(3, { type: "assistant.delta", step: 1, text: "He" })
    )
    state = foldSessionEvent(
      state,
      ev(4, { type: "assistant.delta", step: 1, text: "llo" })
    )
    expect(state.liveTurn?.assistant.parts).toEqual([
      { type: "text", text: "Hello" },
    ])
  })

  it("keeps pending permissions until they resolve", () => {
    let state = foldSessionEvent(
      loaded(),
      ev(5, {
        type: "permission.ask",
        step: 1,
        id: "p1",
        tool: "shell",
        args: { command: "ls" },
      })
    )
    expect(state.permissions).toHaveLength(1)
    state = foldSessionEvent(
      state,
      ev(6, {
        type: "permission.resolved",
        step: 1,
        id: "p1",
        tool: "shell",
        decision: "allow",
      })
    )
    expect(state.permissions).toEqual([])
  })

  it("records a failure on run.end and clears it on the next run.start", () => {
    let state = foldSessionEvent(
      loaded(),
      ev(8, {
        type: "run.end",
        status: "failed",
        error: "boom",
        durationMs: 1,
        steps: 1,
      })
    )
    expect(state.lastError).toBe("boom")
    state = foldSessionEvent(
      state,
      ev(9, {
        type: "run.start",
        runId: "t2",
        query: "again",
        model: "m",
        startedAt: "x",
        turnId: "t2",
        userMessageId: "u2",
        assistantMessageId: "a2",
      })
    )
    expect(state.lastError).toBeUndefined()
  })

  it("replaces the live fold with the completed message and clears the live turn", () => {
    const completed: ChatMessage = {
      id: "a1",
      sessionId: "s1",
      parentId: "u1",
      role: "assistant",
      turnId: "t1",
      parts: [{ type: "text", text: "Hello, world" }],
      createdAt: "x",
    }
    let state = foldSessionEvent(
      loaded({ messages: [user] }),
      ev(2, {
        type: "run.start",
        runId: "t1",
        query: "hi",
        model: "m",
        startedAt: "x",
        turnId: "t1",
        userMessageId: "u1",
        assistantMessageId: "a1",
      })
    )
    state = foldSessionEvent(
      state,
      ev(3, { type: "assistant.delta", step: 1, text: "Hel" })
    )
    state = foldSessionEvent(
      state,
      ev(4, { type: "message.completed", message: completed })
    )
    expect(state.liveTurn).toBeUndefined()
    expect(state.messages.map((m) => m.id)).toEqual(["u1", "a1"])
    expect(state.messages[1].parts).toEqual([
      { type: "text", text: "Hello, world" },
    ])
    expect(state.session.headId).toBe("a1")
  })

  it("applies session.updated patches", () => {
    const state = foldSessionEvent(
      loaded(),
      ev(10, {
        type: "session.updated",
        patch: { title: "Renamed", status: "idle" },
      })
    )
    expect(state.session.title).toBe("Renamed")
  })
})

describe("loadedFromSnapshot", () => {
  it("carries the live turn and its pending permissions", () => {
    const snapshot: SessionSnapshot = {
      session: session({ status: "running", headId: "u1" }),
      messages: [user],
      turns: [],
      seq: 12,
      liveTurn: {
        turnId: "t1",
        assistant: {
          id: "a1",
          sessionId: "s1",
          parentId: "u1",
          role: "assistant",
          parts: [],
          createdAt: "x",
        },
        pendingPermissions: [{ id: "p1", step: 1, tool: "shell", args: {} }],
      },
    }
    const state = loadedFromSnapshot(snapshot)
    expect(state.lastSeq).toBe(12)
    expect(state.liveTurn?.status).toBe("running")
    expect(state.permissions).toHaveLength(1)
  })

  it("surfaces the last turn's error when it failed", () => {
    const state = loadedFromSnapshot({
      session: session(),
      messages: [],
      turns: [
        {
          id: "t1",
          sessionId: "s1",
          userMessageId: "u1",
          assistantMessageId: "a1",
          model: "m",
          status: "failed",
          error: "quota",
          startedAt: "x",
          durationMs: 1,
        },
      ],
      seq: 3,
    })
    expect(state.lastError).toBe("quota")
  })
})

describe("reducer", () => {
  const base: State = {
    summaries: [
      {
        id: "s1",
        title: "A",
        createdAt: "x",
        updatedAt: "x",
        status: "idle",
        messageCount: 0,
      },
    ],
    loaded: { s1: loaded() },
    selectedId: "s1",
    drafts: { s1: "draft" },
    listStatus: "ready",
  }

  it("removing the selected session clears the selection and its state", () => {
    const next = reducer(base, { type: "sessions/remove", id: "s1" })
    expect(next.selectedId).toBeNull()
    expect(next.summaries).toEqual([])
    expect(next.loaded.s1).toBeUndefined()
    expect(next.drafts.s1).toBeUndefined()
  })

  it("keeps the summary list in step with title changes from events", () => {
    const next = reducer(base, {
      type: "session/event",
      id: "s1",
      event: ev(1, { type: "session.updated", patch: { title: "Renamed" } }),
    })
    expect(next.summaries[0].title).toBe("Renamed")
  })

  it("ignores events for a session that is not loaded", () => {
    const next = reducer(base, {
      type: "session/event",
      id: "other",
      event: ev(1, { type: "step.start", step: 1 }),
    })
    expect(next).toBe(base)
  })
})
