import { HugeiconsIcon } from "@hugeicons/react"
import { BubbleChatIcon } from "@hugeicons/core-free-icons"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

// Replaced by the real page in Task 8. Exists so the app compiles with the
// new "chat" page registered.
export function ChatPage() {
  return (
    <Empty className="min-h-72 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={BubbleChatIcon} />
        </EmptyMedia>
        <EmptyTitle>Chat is being built</EmptyTitle>
        <EmptyDescription>
          Sessions, streaming and Markdown arrive in the next tasks.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
