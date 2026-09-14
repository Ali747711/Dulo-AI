// client/src/components/permission-prompt.tsx
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons"

import { CodeBlock } from "@/components/code-block"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { formatJson } from "@/lib/format"
import type { PendingPermission } from "@/lib/types"

export type PermissionChoice = "allow" | "deny" | "always"

/**
 * A gated tool call, paused until the user answers.
 *
 * Written for someone who is not an engineer: what Dulo wants to do, where, and
 * whether it can be taken back. The tool name and arguments are still there, a
 * click away, for someone who wants them. An older harness sends none of the
 * plain-language fields, so the tool name is the fallback.
 */
export function PermissionPrompt({
  permission,
  onDecide,
}: {
  permission: PendingPermission
  onDecide: (decision: PermissionChoice) => void
}) {
  // A "confirm" cannot be undone, so it never offers a blanket yes — the
  // harness would refuse to record one anyway.
  const irreversible = permission.tier === "confirm"

  return (
    <Alert variant={irreversible ? "destructive" : "default"}>
      {irreversible && <HugeiconsIcon icon={Alert01Icon} />}
      <AlertTitle className="min-w-0 text-pretty">
        {permission.what ?? (
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline">{permission.tool}</Badge>
            wants to run
          </span>
        )}
      </AlertTitle>

      <AlertDescription className="flex min-w-0 flex-col gap-3">
        {permission.where && (
          <p className="min-w-0 font-medium break-words">{permission.where}</p>
        )}
        {permission.undo && <p className="min-w-0 break-words">{permission.undo}</p>}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecide("allow")}>
            {irreversible ? "Yes, do it" : "Allow once"}
          </Button>
          {!irreversible && (
            <Button size="sm" variant="outline" onClick={() => onDecide("always")}>
              Always in this chat
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onDecide("deny")}>
            {irreversible ? "No" : "Don't"}
          </Button>
        </div>

        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                className="group/details -ml-2 self-start text-muted-foreground"
              />
            }
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              className="transition-transform group-data-[panel-open]/details:rotate-180"
            />
            Technical details
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <p className="pb-1 text-xs text-muted-foreground">{permission.tool}</p>
            <CodeBlock>{formatJson(permission.args)}</CodeBlock>
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  )
}
