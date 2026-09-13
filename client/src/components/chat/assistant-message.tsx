/* eslint-disable react-refresh/only-export-components */
// client/src/components/chat/assistant-message.tsx
// segmentsOf is exported alongside the component so its pure grouping logic
// can be unit-tested directly (segments.test.ts) without rendering anything.
import * as React from "react"

import { ToolActivity } from "@/components/chat/tool-activity"
import { MarkdownContent } from "@/components/markdown"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import type {
  ChatMessage,
  Part,
  ToolCallPart,
  ToolResultPart,
} from "@/lib/session-types"

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "tool"; call: ToolCallPart; result?: ToolResultPart }

/** Group ordered parts into what the thread renders. Pure. */
export const segmentsOf = (parts: readonly Part[]): Segment[] => {
  const results = new Map(
    parts
      .filter((p): p is ToolResultPart => p.type === "tool_result")
      .map((p) => [p.callId, p])
  )
  return parts.reduce<Segment[]>((segments, part) => {
    if (part.type === "text") {
      const last = segments[segments.length - 1]
      if (last?.kind === "text") {
        return [
          ...segments.slice(0, -1),
          { kind: "text", text: last.text + part.text },
        ]
      }
      return [...segments, { kind: "text", text: part.text }]
    }
    if (part.type === "tool_call") {
      return [
        ...segments,
        { kind: "tool", call: part, result: results.get(part.callId) },
      ]
    }
    // tool_result parts are attached to their call above; attachments never
    // appear on assistant messages.
    return segments
  }, [])
}

/**
 * An assistant turn as one bubble: text as Markdown, tools as collapsible
 * rows, in the order they happened. `ghost` removes the bubble surface, which
 * is how a chat assistant reads best — the user's side keeps the colour.
 */
export function AssistantMessage({
  message,
  live,
  footer,
}: {
  message: ChatMessage
  /** True while this message is still being written. */
  live: boolean
  footer?: React.ReactNode
}) {
  const segments = segmentsOf(message.parts)
  return (
    <Message align="start">
      <MessageContent>
        <Bubble variant="ghost" align="start">
          <BubbleContent className="flex w-full min-w-0 flex-col gap-3">
            {segments.length === 0 && live && (
              <span className="shimmer text-muted-foreground">Thinking…</span>
            )}
            {segments.map((segment, i) =>
              segment.kind === "text" ? (
                <MarkdownContent key={`text-${i}`} text={segment.text} />
              ) : (
                <ToolActivity
                  key={segment.call.callId}
                  call={segment.call}
                  result={segment.result}
                />
              )
            )}
          </BubbleContent>
        </Bubble>
        {footer && <MessageFooter>{footer}</MessageFooter>}
      </MessageContent>
    </Message>
  )
}
