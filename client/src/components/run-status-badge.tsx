import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import type { RunEndReason, RunStatus } from "@/lib/types"

export function RunStatusBadge({
  status,
  reason,
}: {
  status: RunStatus
  reason?: RunEndReason
}) {
  // A run that hit the step limit still answered, but from what it had rather
  // than from finishing the job. Worth telling apart from a real completion.
  if (status === "completed" && reason === "step-limit") {
    return <Badge variant="outline">Step limit</Badge>
  }
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
