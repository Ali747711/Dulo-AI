// client/src/components/permission-prompt.tsx
import { CodeBlock } from "@/components/code-block"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatJson } from "@/lib/format"
import type { PendingPermission } from "@/lib/types"

export type PermissionChoice = "allow" | "deny" | "always"

/** A gated tool is paused until the user answers. */
export function PermissionPrompt({
  permission,
  onDecide,
}: {
  permission: PendingPermission
  onDecide: (decision: PermissionChoice) => void
}) {
  return (
    <Alert>
      <AlertTitle className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="outline">{permission.tool}</Badge>
        wants to run
      </AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-3">
        <CodeBlock>{formatJson(permission.args)}</CodeBlock>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecide("allow")}>
            Allow once
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide("always")}>
            Always in this run
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide("deny")}>
            Deny
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
