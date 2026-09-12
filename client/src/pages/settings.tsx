import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { RefreshIcon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { useHealth } from "@/components/health-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DEFAULT_SETTINGS, MODELS } from "@/lib/defaults"
import { shortModel } from "@/lib/format"
import { useStore } from "@/lib/store"
import type { Settings } from "@/lib/types"

const MAX_FALLBACKS = 2 // OpenRouter allows at most 3 models per request

const modelItems = MODELS.map((m) => ({ label: m.label, value: m.id }))

function ConnectionStatus() {
  const health = useHealth()
  if (health.status === "checking") {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner />
        Checking…
      </span>
    )
  }
  if (health.status === "offline") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Harness offline</AlertTitle>
        <AlertDescription>{health.error}</AlertDescription>
      </Alert>
    )
  }
  const info = health.info
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Connected</Badge>
        <span className="text-muted-foreground">
          {info?.toolCount} tools · default model{" "}
          {shortModel(info?.model ?? "")}
        </span>
      </div>
      {info && !info.hasApiKey && (
        <Alert variant="destructive">
          <AlertTitle>No OpenRouter key on the harness</AlertTitle>
          <AlertDescription>
            Add OPENROUTER_API_KEY to the harness .env file and restart the
            server.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

export function SettingsPage() {
  const { state, dispatch } = useStore()
  const health = useHealth()
  const [draft, setDraft] = React.useState<Settings>(state.settings)

  const update = (patch: Partial<Settings>) =>
    setDraft((current) => ({ ...current, ...patch }))

  const fallbackOptions = MODELS.filter((m) => m.id !== draft.model)
  const isDirty = JSON.stringify(draft) !== JSON.stringify(state.settings)
  const tooManyFallbacks = draft.fallbackModels.length > MAX_FALLBACKS

  const save = () => {
    if (tooManyFallbacks) return
    dispatch({ type: "settings/update", patch: draft })
    toast.success("Settings saved")
  }

  const reset = () => {
    setDraft(DEFAULT_SETTINGS)
    dispatch({ type: "settings/reset" })
    toast("Settings reset to defaults")
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>
            Sent with every run. The harness default applies when a field is
            left as is.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="model">Primary model</FieldLabel>
              <Select
                items={modelItems}
                value={draft.model}
                onValueChange={(value) => {
                  if (typeof value !== "string") return
                  update({
                    model: value,
                    fallbackModels: draft.fallbackModels.filter(
                      (id) => id !== value
                    ),
                  })
                }}
              >
                <SelectTrigger id="model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {modelItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field data-invalid={tooManyFallbacks || undefined}>
              <FieldLabel>Fallback models</FieldLabel>
              <ToggleGroup
                multiple
                value={draft.fallbackModels}
                onValueChange={(value) =>
                  update({ fallbackModels: value as string[] })
                }
                className="flex-wrap justify-start"
              >
                {fallbackOptions.map((m) => (
                  <ToggleGroupItem key={m.id} value={m.id} aria-label={m.label}>
                    {shortModel(m.id)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>
                {tooManyFallbacks
                  ? `Pick at most ${MAX_FALLBACKS}. OpenRouter limits a request to 3 models.`
                  : "Configured on the harness in llm.ts; shown here for reference."}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="temperature">
                Temperature{" "}
                <span className="text-muted-foreground tabular-nums">
                  {draft.temperature.toFixed(1)}
                </span>
              </FieldLabel>
              <Slider
                id="temperature"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature}
                onValueChange={(value) =>
                  update({ temperature: value as number })
                }
              />
              <FieldDescription>
                Lower is more deterministic. 0.2 is a good default for tools.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="maxSteps">Max steps</FieldLabel>
              <Input
                id="maxSteps"
                type="number"
                min={1}
                max={50}
                value={draft.maxSteps}
                onChange={(e) =>
                  update({ maxSteps: Number(e.target.value) || 1 })
                }
              />
              <FieldDescription>
                Safety limit on model round-trips per run.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>Where Dulo sends runs.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="apiBaseUrl">Harness API URL</FieldLabel>
                <Input
                  id="apiBaseUrl"
                  placeholder="http://localhost:3001"
                  value={draft.apiBaseUrl}
                  onChange={(e) => update({ apiBaseUrl: e.target.value })}
                />
                <FieldDescription>
                  Start it with <code>npm run serve</code> in the harness
                  folder. The OpenRouter key lives in the harness{" "}
                  <code>.env</code>, not here.
                </FieldDescription>
              </Field>
            </FieldGroup>
            <ConnectionStatus />
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void health.refresh()}
              disabled={health.status === "checking"}
            >
              <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" />
              Test connection
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardFooter className="justify-end gap-2">
            <Button variant="outline" onClick={reset}>
              Reset
            </Button>
            <Button disabled={!isDirty || tooManyFallbacks} onClick={save}>
              Save changes
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
