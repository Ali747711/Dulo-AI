// src/session/fold.ts
// Turn events → the assistant message's ordered parts. One pure function used
// by the server (to persist the message and to serve a live partial) and by
// the client (to render a live turn). Mirrored in client/src/lib/fold.ts.
import type { RunEvent } from "../events.js";
import type { ChatMessage, Part, SessionOnlyEvent, ToolCallPart } from "./types.js";

const lastTextIndex = (parts: readonly Part[]): number => {
  const last = parts[parts.length - 1];
  return last?.type === "text" ? parts.length - 1 : -1;
};

export const foldTurnEvent = (
  assistant: ChatMessage,
  event: RunEvent | SessionOnlyEvent,
): ChatMessage => {
  switch (event.type) {
    case "assistant.delta": {
      const at = lastTextIndex(assistant.parts);
      if (at === -1) {
        return { ...assistant, parts: [...assistant.parts, { type: "text", text: event.text }] };
      }
      const parts = assistant.parts.slice();
      const current = parts[at] as { type: "text"; text: string };
      parts[at] = { type: "text", text: current.text + event.text };
      return { ...assistant, parts };
    }
    case "assistant": {
      // The final text for this step wins over whatever the deltas built, so a
      // dropped chunk cannot leave a permanent gap.
      const at = lastTextIndex(assistant.parts);
      const parts = at === -1 ? [...assistant.parts] : assistant.parts.slice(0, at);
      return { ...assistant, parts: [...parts, { type: "text", text: event.text }] };
    }
    case "tool.call":
      return {
        ...assistant,
        parts: [
          ...assistant.parts,
          { type: "tool_call", callId: event.callId, tool: event.tool, args: event.args },
        ],
      };
    case "tool.result":
      return {
        ...assistant,
        parts: [
          ...assistant.parts,
          {
            type: "tool_result",
            callId: event.callId,
            tool: event.tool,
            result: event.result,
            isError: event.isError,
            durationMs: event.durationMs,
            ...(event.error ? { error: event.error } : {}),
          },
        ],
      };
    default:
      return assistant;
  }
};

/**
 * A cancelled turn can leave a tool_call with no tool_result. The projection
 * must never send the model a dangling call, so give each one a result.
 */
export const fillDangling = (assistant: ChatMessage): ChatMessage => {
  const answered = new Set(
    assistant.parts.filter((p) => p.type === "tool_result").map((p) => p.callId),
  );
  const missing = assistant.parts.filter(
    (p): p is ToolCallPart => p.type === "tool_call" && !answered.has(p.callId),
  );
  if (missing.length === 0) return assistant;
  return {
    ...assistant,
    parts: [
      ...assistant.parts,
      ...missing.map((call): Part => ({
        type: "tool_result",
        callId: call.callId,
        tool: call.tool,
        result: "Error: cancelled",
        isError: true,
        durationMs: 0,
        error: { message: "cancelled" },
      })),
    ],
  };
};
