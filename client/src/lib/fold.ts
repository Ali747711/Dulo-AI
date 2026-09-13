// client/src/lib/fold.ts
// Mirror of foldTurnEvent in src/session/fold.ts. The same pure function the
// server uses to build the assistant message, applied here to render a live
// turn. `message.completed` then carries the server's version, which replaces
// this fold, so a dropped chunk cannot leave a permanent gap.
import type { ChatMessage, Part, SessionOnlyEvent } from "./session-types"
import type { RunEvent } from "./types"

const lastTextIndex = (parts: readonly Part[]): number => {
  const last = parts[parts.length - 1]
  return last?.type === "text" ? parts.length - 1 : -1
}

export const foldTurnEvent = (
  assistant: ChatMessage,
  event: RunEvent | SessionOnlyEvent
): ChatMessage => {
  switch (event.type) {
    case "assistant.delta": {
      const at = lastTextIndex(assistant.parts)
      if (at === -1) {
        return {
          ...assistant,
          parts: [...assistant.parts, { type: "text", text: event.text }],
        }
      }
      const parts = assistant.parts.slice()
      const current = parts[at] as { type: "text"; text: string }
      parts[at] = { type: "text", text: current.text + event.text }
      return { ...assistant, parts }
    }
    case "assistant": {
      const at = lastTextIndex(assistant.parts)
      const parts =
        at === -1 ? [...assistant.parts] : assistant.parts.slice(0, at)
      return {
        ...assistant,
        parts: [...parts, { type: "text", text: event.text }],
      }
    }
    case "tool.call":
      return {
        ...assistant,
        parts: [
          ...assistant.parts,
          {
            type: "tool_call",
            callId: event.callId,
            tool: event.tool,
            args: event.args,
          },
        ],
      }
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
      }
    default:
      return assistant
  }
}
