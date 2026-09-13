// client/src/components/chat/session-list.tsx
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { formatRelative } from "@/lib/format"
import type { SessionSummary } from "@/lib/session-types"

interface SessionListProps {
  sessions: SessionSummary[]
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

export function SessionList({
  sessions,
  selectedId,
  loading,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SessionListProps) {
  const [renaming, setRenaming] = React.useState<SessionSummary | null>(null)
  const [deleting, setDeleting] = React.useState<SessionSummary | null>(null)
  const [title, setTitle] = React.useState("")

  const openRename = (session: SessionSummary) => {
    setTitle(session.title)
    setRenaming(session)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <Button variant="outline" onClick={onCreate}>
        <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
        New chat
      </Button>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
        {loading && sessions.length === 0 && (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        )}
        {!loading && sessions.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">No chats yet.</p>
        )}
        {sessions.map((session) => (
          <div key={session.id} className="group/row flex min-w-0 items-center gap-1">
            <Button
              variant={session.id === selectedId ? "secondary" : "ghost"}
              className="h-auto min-w-0 flex-1 justify-start py-2 text-left"
              onClick={() => onSelect(session.id)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate">{session.title}</span>
                <span className="flex items-center gap-1 text-[0.625rem] text-muted-foreground">
                  {session.status === "running" && <Spinner />}
                  {formatRelative(session.updatedAt)}
                </span>
              </div>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${session.title}`}
                  />
                }
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => openRename(session)}>Rename</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting(session)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>The title is only a label; it does not change the conversation.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (renaming && title.trim()) onRename(renaming.id, title.trim())
              setRenaming(null)
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="session-title">Title</FieldLabel>
                <Input
                  id="session-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  autoFocus
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this chat?</DialogTitle>
            <DialogDescription>
              “{deleting?.title}” and every message in it will be removed from the harness.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) onDelete(deleting.id)
                setDeleting(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
