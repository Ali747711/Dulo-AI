// client/src/components/chat/composer.tsx
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { SentIcon, StopIcon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"

interface ComposerProps {
  value: string
  onChange: (text: string) => void
  onSend: () => void
  onStop: () => void
  /** A turn is running: show Stop, keep the input live for the next message. */
  running: boolean
  /** Why sending is unavailable (offline, no session); disables Send. */
  disabledReason?: string
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabledReason,
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
