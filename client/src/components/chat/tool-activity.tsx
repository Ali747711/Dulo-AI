// client/src/components/chat/tool-activity.tsx
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { CodeBlock } from "@/components/code-block"
import { TodoList } from "@/components/todo-list"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { formatDuration, formatJson } from "@/lib/format"
import type { ToolCallPart, ToolResultPart } from "@/lib/session-types"

/** One tool call and, once it has one, its result. Closed by default. */
export function ToolActivity({
  call,
  result,
}: {
  call: ToolCallPart
  result?: ToolResultPart
}) {
  const argsPreview = formatJson(call.args).replace(/\s+/g, " ")
  return (
    <Collapsible className="min-w-0 rounded-md border bg-muted/30">
      <CollapsibleTrigger className="group/trigger flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs">
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="shrink-0 transition-transform group-data-[panel-open]/trigger:rotate-90"
        />
        <Badge variant={result?.isError ? "destructive" : "outline"}>{call.tool}</Badge>
        {result ? (
          <span className="text-muted-foreground tabular-nums">
            {formatDuration(result.durationMs)}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Spinner />
            running
          </span>
        )}
        <code className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
          {argsPreview}
        </code>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex min-w-0 flex-col gap-2 border-t px-3 py-2">
        <CodeBlock>{formatJson(call.args)}</CodeBlock>
        {result &&
          (call.tool === "manage_todos" && !result.isError ? (
            <TodoList text={result.result} />
          ) : (
            <CodeBlock>{result.result}</CodeBlock>
          ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
