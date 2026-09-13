import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fillDangling, foldTurnEvent } from "./fold.js";
import type { ChatMessage } from "./types.js";

const shell = (): ChatMessage => ({
  id: "a",
  sessionId: "s",
  parentId: "u",
  role: "assistant",
  parts: [],
  turnId: "t",
  createdAt: "2026-01-01T00:00:00Z",
});

describe("foldTurnEvent", () => {
  it("accumulates deltas into one text part", () => {
    let m = shell();
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Hel" });
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "lo" });
    assert.deepEqual(m.parts, [{ type: "text", text: "Hello" }]);
  });

  it("lets the final assistant event replace the accumulated text", () => {
    let m = shell();
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Hel" });
    m = foldTurnEvent(m, { type: "assistant", step: 1, text: "Hello, world" });
    assert.deepEqual(m.parts, [{ type: "text", text: "Hello, world" }]);
  });

  it("starts a new text part after a tool result", () => {
    let m = shell();
    m = foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "Checking" });
    m = foldTurnEvent(m, {
      type: "tool.call", step: 1, callId: "c1", tool: "get_current_time", args: {},
    });
    m = foldTurnEvent(m, {
      type: "tool.result", step: 1, callId: "c1", tool: "get_current_time",
      result: "10:00", durationMs: 3, isError: false,
    });
    m = foldTurnEvent(m, { type: "assistant.delta", step: 2, text: "It is 10:00" });
    assert.deepEqual(
      m.parts.map((p) => p.type),
      ["text", "tool_call", "tool_result", "text"],
    );
    assert.deepEqual(m.parts[3], { type: "text", text: "It is 10:00" });
  });

  it("carries the tool error object through", () => {
    const m = foldTurnEvent(shell(), {
      type: "tool.result", step: 1, callId: "c1", tool: "shell", result: "Error: denied",
      durationMs: 0, isError: true, error: { message: "denied" },
    });
    assert.deepEqual(m.parts[0], {
      type: "tool_result", callId: "c1", tool: "shell", result: "Error: denied",
      isError: true, durationMs: 0, error: { message: "denied" },
    });
  });

  it("ignores events that are not about the message", () => {
    const m = shell();
    assert.equal(foldTurnEvent(m, { type: "step.start", step: 1 }), m);
    assert.equal(
      foldTurnEvent(m, { type: "queue.updated", queue: [] }),
      m,
    );
  });

  it("never mutates its input", () => {
    const m = shell();
    foldTurnEvent(m, { type: "assistant.delta", step: 1, text: "x" });
    assert.deepEqual(m.parts, []);
  });
});

describe("fillDangling", () => {
  it("adds a cancelled result for every unanswered tool call", () => {
    const m: ChatMessage = {
      ...shell(),
      parts: [
        { type: "tool_call", callId: "c1", tool: "shell", args: { command: "ls" } },
        { type: "tool_call", callId: "c2", tool: "read_file", args: { path: "x" } },
        { type: "tool_result", callId: "c1", tool: "shell", result: "ok", isError: false, durationMs: 1 },
      ],
    };
    const filled = fillDangling(m);
    assert.equal(filled.parts.length, 4);
    assert.deepEqual(filled.parts[3], {
      type: "tool_result", callId: "c2", tool: "read_file", result: "Error: cancelled",
      isError: true, durationMs: 0, error: { message: "cancelled" },
    });
  });
  it("returns the same message when nothing dangles", () => {
    const m = shell();
    assert.equal(fillDangling(m), m);
  });
});
