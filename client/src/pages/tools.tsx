import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { CodeIcon, RefreshIcon, ToolsIcon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { CodeBlock } from "@/components/code-block"
import { useHealth } from "@/components/health-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fetchTools } from "@/lib/agent-client"
import { categoryFor, DISABLED_BY_DEFAULT } from "@/lib/defaults"
import { formatJson } from "@/lib/format"
import { useStore } from "@/lib/store"
import type { ServerTool, ToolCategory, ToolDef } from "@/lib/types"

type Filter = "all" | ToolCategory

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "files", label: "Files" },
  { value: "system", label: "System" },
  { value: "network", label: "Network" },
  { value: "utility", label: "Utility" },
]

/** Merge the harness tool list with the enabled flags the user already set. */
const mergeTools = (server: ServerTool[], current: ToolDef[]): ToolDef[] =>
  server.map((tool) => {
    const known = current.find((t) => t.name === tool.name)
    return {
      ...tool,
      category: categoryFor(tool.name),
      enabled: known ? known.enabled : !DISABLED_BY_DEFAULT.has(tool.name),
    }
  })

function SchemaDialog({ tool }: { tool: ToolDef }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Schema for ${tool.name}`}
          />
        }
      >
        <HugeiconsIcon icon={CodeIcon} />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono">{tool.name}</DialogTitle>
          <DialogDescription>{tool.description}</DialogDescription>
        </DialogHeader>
        <CodeBlock className="max-h-96 border bg-muted/30 p-3">
          {formatJson(tool.parameters)}
        </CodeBlock>
      </DialogContent>
    </Dialog>
  )
}

export function ToolsPage() {
  const { state, dispatch } = useStore()
  const health = useHealth()
  const [filter, setFilter] = React.useState<Filter>("all")
  const [syncing, setSyncing] = React.useState(false)
  const [syncError, setSyncError] = React.useState<string | null>(null)

  const apiBaseUrl = state.settings.apiBaseUrl
  const toolsRef = React.useRef(state.tools)
  React.useEffect(() => {
    toolsRef.current = state.tools
  }, [state.tools])

  const sync = React.useCallback(async () => {
    setSyncing(true)
    try {
      const server = await fetchTools(apiBaseUrl)
      dispatch({
        type: "tools/replace",
        tools: mergeTools(server, toolsRef.current),
      })
      setSyncError(null)
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncing(false)
    }
  }, [apiBaseUrl, dispatch])

  React.useEffect(() => {
    // Pull the live tool list once the API URL is known
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync()
  }, [sync])

  const visible =
    filter === "all"
      ? state.tools
      : state.tools.filter((t) => t.category === filter)
  const enabledCount = state.tools.filter((t) => t.enabled).length

  const setEnabled = (tool: ToolDef, enabled: boolean) => {
    dispatch({ type: "tools/toggle", name: tool.name, enabled })
    toast(`${tool.name} ${enabled ? "enabled" : "disabled"}`)
  }

  const setAll = (enabled: boolean) => {
    visible.forEach((tool) =>
      dispatch({ type: "tools/toggle", name: tool.name, enabled })
    )
    toast(`${visible.length} tools ${enabled ? "enabled" : "disabled"}`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tools</CardTitle>
        <CardDescription>
          {enabledCount} of {state.tools.length} tools are sent to the model on
          each run.
        </CardDescription>
        <CardAction className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sync()}
            disabled={syncing}
          >
            <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
            {syncing ? "Syncing" : "Sync"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAll(true)}>
            Enable all
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAll(false)}>
            Disable all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {(syncError || health.status === "offline") && (
          <Alert>
            <AlertTitle>Showing the last known tool list</AlertTitle>
            <AlertDescription>{syncError ?? health.error}</AlertDescription>
          </Alert>
        )}

        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as Filter)}
        >
          <TabsList variant="line">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={ToolsIcon} />
              </EmptyMedia>
              <EmptyTitle>No tools in this category</EmptyTitle>
              <EmptyDescription>
                Add one to tools.ts in the harness.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead className="hidden md:table-cell">
                  Description
                </TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="w-24 text-right">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((tool) => (
                <TableRow key={tool.name}>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-medium">{tool.name}</span>
                      <SchemaDialog tool={tool} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-md truncate text-muted-foreground md:table-cell">
                    {tool.description}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{tool.category}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={tool.enabled}
                      onCheckedChange={(checked) => setEnabled(tool, checked)}
                      aria-label={`Toggle ${tool.name}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
