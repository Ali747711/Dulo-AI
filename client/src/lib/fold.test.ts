import { describe, expect, it } from "vitest"

import { foldTurnEvent } from "./fold"
import type { ChatMessage } from "./session-types"

const shell = (): ChatMessage => ({
  id: "a",
  sessionId: "s",
  parentId: "u",
  role: "assistant",
  parts: [],
  turnId: "t",
  createdAt: "2026-01-01T00:00:00Z",
})

describe("foldTurnEvent", () => {
  it("accumulates deltas into one text part", () => {
    let m = shell()
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Hel" })
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "lo" })
    expect(m.parts).toEqual([{ type: "text", text: "Hello" }])
  })

  it("lets the final assistant event replace the accumulated text", () => {
    let m = shell()
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Hel" })
    m = foldTurnEvent(m, { type: "assistant", step: 1, text: "Hello, world" })
    expect(m.parts).toEqual([{ type: "text", text: "Hello, world" }])
  })

  it("starts a new text part after a tool result", () => {
    let m = shell()
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Checking" })
    m = foldTurnEvent(m, {
      type: "tool.call",
      step: 1,
      callId: "c1",
      tool: "get_current_time",
      args: {},
    })
    m = foldTurnEvent(m, {
      type: "tool.result",
      step: 1,
      callId: "c1",
      tool: "get_current_time",
      result: "10:00",
      durationMs: 3,
      isError: false,
    })
    m = foldTurnEvent(m, { type: "assistant.delta", step: 2, text: "It is 10:00" })
    expect(m.parts.map((p) => p.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "text",
    ])
  })

  it("ignores events that are not about the message and never mutates input", () => {
    const m = shell()
    expect(foldTurnEvent(m, { type: "step.start", step: 1 })).toBe(m)
    expect(foldTurnEvent(m, { type: "queue.updated", queue: [] })).toBe(m)
    foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "x" })
    expect(m.parts).toEqual([])
  })
})
