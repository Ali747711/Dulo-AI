import { HugeiconsIcon } from "@hugeicons/react"
import {
  DashboardSquare01Icon,
  PlayIcon,
  Robot01Icon,
  Settings01Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { shortModel } from "@/lib/format"
import { useStore } from "@/lib/store"
import type { Page } from "@/lib/types"

interface NavItem {
  page: Page
  label: string
  icon: typeof PlayIcon
}

const NAV_ITEMS: NavItem[] = [
  { page: "dashboard", label: "Dashboard", icon: DashboardSquare01Icon },
  { page: "playground", label: "Playground", icon: PlayIcon },
  { page: "tools", label: "Tools", icon: ToolsIcon },
  { page: "settings", label: "Settings", icon: Settings01Icon },
]

interface AppSidebarProps {
  page: Page
  onNavigate: (page: Page) => void
}

export function AppSidebar({ page, onNavigate }: AppSidebarProps) {
  const { state } = useStore()
  const enabledTools = state.tools.filter((t) => t.enabled).length
  const running = state.runs.filter((r) => r.status === "running").length

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => onNavigate("dashboard")}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <HugeiconsIcon icon={Robot01Icon} />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">Dulo</span>
                <span className="truncate text-xs text-muted-foreground">
                  Harness control panel
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.page}>
                  <SidebarMenuButton
                    tooltip={item.label}
                    isActive={page === item.page}
                    onClick={() => onNavigate(item.page)}
                  >
                    <HugeiconsIcon icon={item.icon} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.page === "tools" && (
                    <SidebarMenuBadge>{enabledTools}</SidebarMenuBadge>
                  )}
                  {item.page === "playground" && running > 0 && (
                    <SidebarMenuBadge>{running}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex flex-col gap-1 px-2 py-1 group-data-[collapsible=icon]:hidden">
          <span className="text-xs text-muted-foreground">Active model</span>
          <Badge variant="outline" className="w-fit max-w-full">
            <span className="truncate">{shortModel(state.settings.model)}</span>
          </Badge>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
