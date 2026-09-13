import { describe, expect, it } from "vitest"

import { segmentsOf } from "./assistant-message"
import type { Part } from "@/lib/session-types"

describe("segmentsOf", () => {
  it("pairs each tool call with its result and keeps text runs in order", () => {
    const parts: Part[] = [
      { type: "text", text: "Let me check." },
      { type: "tool_call", callId: "c1", tool: "get_current_time", args: {} },
      {
        type: "tool_result", callId: "c1", tool: "get_current_time",
        result: "10:00", isError: false, durationMs: 2,
      },
      { type: "text", text: "It is 10:00." },
    ]
    const segments = segmentsOf(parts)
    expect(segments.map((s) => s.kind)).toEqual(["text", "tool", "text"])
    expect(segments[1]).toMatchObject({ kind: "tool", result: { result: "10:00" } })
  })

  it("leaves a tool call without a result unpaired (still running)", () => {
    const segments = segmentsOf([
      { type: "tool_call", callId: "c1", tool: "shell", args: { command: "ls" } },
    ])
    expect(segments).toEqual([
      { kind: "tool", call: { type: "tool_call", callId: "c1", tool: "shell", args: { command: "ls" } }, result: undefined },
    ])
  })

  it("merges adjacent text parts", () => {
    const segments = segmentsOf([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ])
    expect(segments).toEqual([{ kind: "text", text: "ab" }])
  })
})
