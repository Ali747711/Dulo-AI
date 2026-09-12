import { HugeiconsIcon } from "@hugeicons/react"
import {
  Activity01Icon,
  CheckmarkCircle02Icon,
  Timer01Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import { RunStatusBadge } from "@/components/run-status-badge"
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
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDuration, formatRelative, shortModel } from "@/lib/format"
import { useStore } from "@/lib/store"
import type { Page, Run } from "@/lib/types"

const chartConfig = {
  runs: { label: "Runs", color: "var(--chart-1)" },
} satisfies ChartConfig

const DAY_MS = 24 * 60 * 60 * 1000

/** Runs per day for the last 7 days, oldest first. */
const runsPerDay = (runs: Run[]) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const dayStart = today.getTime() - (6 - i) * DAY_MS
    const count = runs.filter((r) => {
      const t = new Date(r.startedAt).getTime()
      return t >= dayStart && t < dayStart + DAY_MS
    }).length
    return {
      day: new Date(dayStart).toLocaleDateString(undefined, {
        weekday: "short",
      }),
      runs: count,
    }
  })
}

interface StatCardProps {
  title: string
  value: string
  hint: string
  icon: typeof Activity01Icon
}

function StatCard({ title, value, hint, icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        <CardAction>
          <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <HugeiconsIcon icon={icon} />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

export function DashboardPage({
  onNavigate,
}: {
  onNavigate: (page: Page) => void
}) {
  const { state } = useStore()
  const { runs, tools } = state

  const finished = runs.filter((r) => r.status !== "running")
  const completed = finished.filter((r) => r.status === "completed")
  const successRate =
    finished.length === 0
      ? 0
      : Math.round((completed.length / finished.length) * 100)
  const toolCalls = runs.reduce(
    (sum, r) => sum + r.steps.reduce((s, step) => s + step.toolCalls.length, 0),
    0
  )
  const avgDuration =
    finished.length === 0
      ? 0
      : Math.round(
          finished.reduce((s, r) => s + r.durationMs, 0) / finished.length
        )
  const enabledTools = tools.filter((t) => t.enabled).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total runs"
          value={String(runs.length)}
          hint="Across all models"
          icon={Activity01Icon}
        />
        <StatCard
          title="Success rate"
          value={`${successRate}%`}
          hint={`${completed.length} of ${finished.length} finished runs`}
          icon={CheckmarkCircle02Icon}
        />
        <StatCard
          title="Tool calls"
          value={String(toolCalls)}
          hint={`${enabledTools} of ${tools.length} tools enabled`}
          icon={ToolsIcon}
        />
        <StatCard
          title="Avg duration"
          value={formatDuration(avgDuration)}
          hint="Per finished run"
          icon={Timer01Icon}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Runs per day, last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-48 w-full">
              <BarChart data={runsPerDay(runs)} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel />}
                />
                <Bar dataKey="runs" fill="var(--color-runs)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>Latest queries sent to the agent</CardDescription>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate("playground")}
              >
                Open playground
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon icon={Activity01Icon} />
                  </EmptyMedia>
                  <EmptyTitle>No runs yet</EmptyTitle>
                  <EmptyDescription>
                    Send a query from the playground to see it here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead className="hidden xl:table-cell">
                      Model
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">
                      Duration
                    </TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.slice(0, 6).map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="max-w-64 truncate font-medium">
                        {run.query}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground xl:table-cell">
                        {shortModel(run.model)}
                      </TableCell>
                      <TableCell>
                        <RunStatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">
                        {formatDuration(run.durationMs)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatRelative(run.startedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
