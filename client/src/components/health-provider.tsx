/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

import { fetchHealth } from "@/lib/agent-client"
import { useStore } from "@/lib/store"
import type { HealthInfo } from "@/lib/types"

const POLL_MS = 10_000

export type HealthStatus = "checking" | "online" | "offline"

interface HealthState {
  status: HealthStatus
  info?: HealthInfo
  error?: string
  /** Re-check now, e.g. after the user changes the API URL. */
  refresh: () => Promise<void>
}

const HealthContext = React.createContext<HealthState | undefined>(undefined)

/** Polls the harness health endpoint so every page shares one connection status. */
export function HealthProvider({ children }: { children: React.ReactNode }) {
  const { state } = useStore()
  const apiBaseUrl = state.settings.apiBaseUrl
  const [health, setHealth] = React.useState<Omit<HealthState, "refresh">>({
    status: "checking",
  })

  const refresh = React.useCallback(async () => {
    try {
      const info = await fetchHealth(apiBaseUrl)
      setHealth({ status: "online", info })
    } catch (error) {
      setHealth({
        status: "offline",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [apiBaseUrl])

  React.useEffect(() => {
    // refresh() only sets state after the network response arrives
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const value = React.useMemo(() => ({ ...health, refresh }), [health, refresh])

  return (
    <HealthContext.Provider value={value}>{children}</HealthContext.Provider>
  )
}

export const useHealth = (): HealthState => {
  const context = React.useContext(HealthContext)
  if (context === undefined) {
    throw new Error("useHealth must be used within a HealthProvider")
  }
  return context
}
