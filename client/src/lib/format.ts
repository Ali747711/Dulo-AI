export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export const formatRelative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

/** Short label for an OpenRouter model id like "vendor/name:free". */
export const shortModel = (id: string): string => {
  const name = id.split("/").pop() ?? id
  return name.replace(/:free$/, "")
}

export const formatJson = (value: unknown): string =>
  JSON.stringify(value, null, 2)
