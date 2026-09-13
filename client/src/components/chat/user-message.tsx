// client/src/components/chat/user-message.tsx
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Edit02Icon,
} from "@hugeicons/core-free-icons"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ChatMessage } from "@/lib/session-types"

export interface SiblingSwitcher {
  /** This message's position among its siblings, 0-based. */
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
}

/**
 * The user's text, right-aligned. Edit and the sibling switcher live in a
 * footer row that only shows on hover/focus (`group/message`, already carried
 * by the Message wrapper) — the same reveal pattern used for sidebar row
 * actions, so a message bubble doesn't compete with the text at rest.
 * Attachment chips arrive in Plan 5.
 */
export function UserMessage({
  message,
  sibling,
  onEdit,
}: {
  message: ChatMessage
  /** Present only when this message has more than one sibling. */
  sibling?: SiblingSwitcher
  onEdit: () => void
}) {
  const text = message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
  return (
    <Message align="end">
      <MessageContent>
        <Bubble variant="default" align="end">
          <BubbleContent className="text-sm/relaxed whitespace-pre-wrap">
            {text}
          </BubbleContent>
        </Bubble>
        <MessageFooter className="gap-1 pt-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
          {sibling && sibling.total > 1 && (
            <ButtonGroup>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Previous version"
                disabled={sibling.index === 0}
                onClick={sibling.onPrev}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} />
              </Button>
              <ButtonGroupText className="tabular-nums">
                {`${sibling.index + 1}/${sibling.total}`}
              </ButtonGroupText>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Next version"
                disabled={sibling.index === sibling.total - 1}
                onClick={sibling.onNext}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} />
              </Button>
            </ButtonGroup>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Edit message"
                  onClick={onEdit}
                />
              }
            >
              <HugeiconsIcon icon={Edit02Icon} />
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
        </MessageFooter>
      </MessageContent>
    </Message>
  )
}
