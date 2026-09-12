import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import type { RunStatus } from "@/lib/types"

export function RunStatusBadge({ status }: { status: RunStatus }) {
  switch (status) {
    case "running":
      return (
        <Badge variant="outline">
          <Spinner />
          Running
        </Badge>
      )
    case "failed":
      return <Badge variant="destructive">Failed</Badge>
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>
    case "completed":
      return <Badge variant="secondary">Completed</Badge>
  }
}
