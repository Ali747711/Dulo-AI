import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { HealthProvider } from "@/components/health-provider"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { StoreProvider } from "@/lib/store"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <StoreProvider>
          <HealthProvider>
            <App />
            <Toaster />
          </HealthProvider>
        </StoreProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
