import { HugeiconsIcon } from "@hugeicons/react"
import {
  WifiConnected01Icon,
  WifiDisconnected01Icon,
} from "@hugeicons/core-free-icons"

import { useHealth } from "@/components/health-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { shortModel } from "@/lib/format"
import { useStore } from "@/lib/store"
import type { Page } from "@/lib/types"

const PAGE_TITLES: Record<Page, string> = {
  dashboard: "Dashboard",
  playground: "Playground",
  tools: "Tools",
  settings: "Settings",
}

function ConnectionBadge() {
  const health = useHealth()
  const { state } = useStore()

  if (health.status === "checking") {
    return (
      <Badge variant="outline">
        <Spinner />
        Connecting
      </Badge>
    )
  }
  if (health.status === "offline") {
    return (
      <Tooltip>
        <TooltipTrigger render={<Badge variant="destructive" />}>
          <HugeiconsIcon icon={WifiDisconnected01Icon} />
          Harness offline
        </TooltipTrigger>
        <TooltipContent>{health.error}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant="secondary" />}>
        <HugeiconsIcon icon={WifiConnected01Icon} />
        <span className="hidden sm:inline">
          {shortModel(health.info?.model ?? state.settings.model)}
        </span>
        <span className="sm:hidden">Online</span>
      </TooltipTrigger>
      <TooltipContent>
        Connected to {state.settings.apiBaseUrl} · {health.info?.toolCount}{" "}
        tools
      </TooltipContent>
    </Tooltip>
  )
}

export function SiteHeader({ page }: { page: Page }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden md:block">Dulo</BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{PAGE_TITLES[page]}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2">
        <ConnectionBadge />
        <ThemeToggle />
      </div>
    </header>
  )
}
