import * as React from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import type { Page } from "@/lib/types"
import { ChatPage } from "@/pages/chat"
import { DashboardPage } from "@/pages/dashboard"
import { PlaygroundPage } from "@/pages/playground"
import { SettingsPage } from "@/pages/settings"
import { ToolsPage } from "@/pages/tools"

export function App() {
  const [page, setPage] = React.useState<Page>("dashboard")

  return (
    <SidebarProvider>
      <AppSidebar page={page} onNavigate={setPage} />
      {/* min-w-0 keeps wide tool output inside the page instead of
          stretching the layout and forcing a horizontal scrollbar. */}
      <SidebarInset className="min-w-0">
        <SiteHeader page={page} />
        <main className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
          {page === "dashboard" && <DashboardPage onNavigate={setPage} />}
          {page === "chat" && <ChatPage />}
          {page === "playground" && <PlaygroundPage />}
          {page === "tools" && <ToolsPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
