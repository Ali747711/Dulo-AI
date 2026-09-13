// client/src/components/chat/message-thread.tsx
import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatIcon } from "@hugeicons/core-free-icons"

import { AssistantMessage } from "@/components/chat/assistant-message"
import { UserMessage } from "@/components/chat/user-message"
import { PermissionPrompt, type PermissionChoice } from "@/components/permission-prompt"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { siblingsOf } from "@/lib/tree"
import type { ChatMessage } from "@/lib/session-types"
import type { PendingPermission } from "@/lib/types"

interface MessageThreadProps {
  /** Completed messages on the current branch, root first. */
  messages: ChatMessage[]
  /** Every message in the session, every branch — for sibling lookups only. */
  allMessages: ChatMessage[]
  /** The assistant message being written right now, if any. */
  liveAssistant?: ChatMessage
  permissions: PendingPermission[]
  lastError?: string
  onDecide: (requestId: string, decision: PermissionChoice) => void
  onEdit: (message: ChatMessage) => void
  onSwitchBranch: (messageId: string) => void
  /** Present only when the last turn failed and can be retried. */
  onRetry?: () => void
}

/**
 * The conversation. MessageScroller owns following the live edge, holding the
 * user's turn in view, and the jump-to-latest button — nothing here touches
 * scrollTop.
 */
export function MessageThread({
  messages,
  allMessages,
  liveAssistant,
  permissions,
  lastError,
  onDecide,
  onEdit,
  onSwitchBranch,
  onRetry,
}: MessageThreadProps) {
  const empty = messages.length === 0 && !liveAssistant
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport className="px-1">
          <MessageScrollerContent className="mx-auto w-full max-w-3xl py-4">
            {empty && (
              <MessageScrollerItem messageId="empty">
                <Empty className="min-h-60">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={BubbleChatIcon} />
                    </EmptyMedia>
                    <EmptyTitle>Start the conversation</EmptyTitle>
                    <EmptyDescription>
                      Ask something. The agent keeps everything in this session in
                      mind for your next message.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            )}
            {messages.map((message) => {
              const sib =
                message.role === "user"
                  ? siblingsOf(allMessages, message.id)
                  : null
              return (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  {message.role === "user" ? (
                    <UserMessage
                      message={message}
                      onEdit={() => onEdit(message)}
                      sibling={
                        sib && sib.total > 1
                          ? {
                              index: sib.index,
                              total: sib.total,
                              onPrev: () =>
                                onSwitchBranch(sib.ids[sib.index - 1]),
                              onNext: () =>
                                onSwitchBranch(sib.ids[sib.index + 1]),
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <AssistantMessage message={message} live={false} />
                  )}
                </MessageScrollerItem>
              )
            })}
            {liveAssistant && (
              <MessageScrollerItem key={liveAssistant.id} messageId={liveAssistant.id}>
                <AssistantMessage message={liveAssistant} live />
              </MessageScrollerItem>
            )}
            {permissions.map((permission) => (
              <MessageScrollerItem key={permission.id} messageId={`permission-${permission.id}`}>
                <PermissionPrompt
                  permission={permission}
                  onDecide={(decision) => onDecide(permission.id, decision)}
                />
              </MessageScrollerItem>
            ))}
            {lastError && (
              <MessageScrollerItem messageId="turn-error">
                <Alert variant="destructive">
                  <AlertTitle>The turn failed</AlertTitle>
                  <AlertDescription className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 break-words">{lastError}</span>
                    {onRetry && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={onRetry}
                      >
                        Retry
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
