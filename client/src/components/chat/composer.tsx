// client/src/components/chat/composer.tsx
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Delete02Icon,
  Edit02Icon,
  SentIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import type { QueuedMessage } from "@/lib/session-types"

const textOf = (message: QueuedMessage): string =>
  message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ")

/**
 * One message waiting to send — queued behind a running turn (auto-sends the
 * instant that turn finishes) or held after a cancel/failure (stays until
 * acted on). "Send now" only succeeds while idle, so it's disabled while
 * `running` — clicking it during a running turn would just 409.
 */
function QueuedMessageChip({
  message,
  canSendNow,
  onSendNow,
  onEdit,
  onRemove,
}: {
  message: QueuedMessage
  canSendNow: boolean
  onSendNow: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
      <Badge variant="outline">queued</Badge>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {textOf(message)}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="ghost" disabled={!canSendNow} onClick={onSendNow}>
          Send now
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Edit queued message" onClick={onEdit}>
          <HugeiconsIcon icon={Edit02Icon} />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Remove queued message" onClick={onRemove}>
          <HugeiconsIcon icon={Delete02Icon} />
        </Button>
      </div>
    </div>
  )
}

interface ComposerProps {
  value: string
  onChange: (text: string) => void
  onSend: () => void
  onStop: () => void
  /** A turn is running: show Stop, keep the input live for the next message. */
  running: boolean
  /** Why sending is unavailable (offline, no session); disables Send. */
  disabledReason?: string
  /** Messages waiting to be sent — queued while running, held after cancel/fail. */
  queue: QueuedMessage[]
  onSendNow: (id: string) => void
  onEdit: (message: QueuedMessage) => void
  onRemove: (id: string) => void
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabledReason,
  queue,
  onSendNow,
  onEdit,
  onRemove,
}: ComposerProps) {
  const canSend = value.trim().length > 0 && !disabledReason

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend) onSend()
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      {queue.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5">
          {queue.map((message) => (
            <QueuedMessageChip
              key={message.id}
              message={message}
              canSendNow={!running}
              onSendNow={() => onSendNow(message.id)}
              onEdit={() => onEdit(message)}
              onRemove={() => onRemove(message.id)}
            />
          ))}
        </div>
      )}
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={disabledReason ?? "Message Dulo…"}
        rows={3}
        className="min-h-20 resize-none"
        aria-label="Message"
      />
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="hidden text-xs text-muted-foreground sm:flex sm:items-center sm:gap-1">
          <KbdGroup>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          to send ·
          <KbdGroup>
            <Kbd>Shift</Kbd>
            <Kbd>Enter</Kbd>
          </KbdGroup>
          for a new line
        </span>
        <div className="ml-auto flex items-center gap-2">
          {running && (
            <Button variant="outline" size="sm" onClick={onStop}>
              <HugeiconsIcon icon={StopIcon} data-icon="inline-start" />
              Stop
            </Button>
          )}
          <Button size="sm" disabled={!canSend} onClick={onSend}>
            <HugeiconsIcon icon={SentIcon} data-icon="inline-start" />
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
