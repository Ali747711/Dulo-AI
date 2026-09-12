import type { ModelOption, Settings, ToolCategory, ToolDef } from "./types"

/** Free OpenRouter models with tool support (mirrors src/llm.ts in the harness). */
export const MODELS: ModelOption[] = [
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron 3 Ultra 550B",
    context: "1M",
  },
  { id: "nex-agi/nex-n2.5-pro:free", label: "Nex N2.5 Pro", context: "262K" },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super 120B",
    context: "262K",
  },
  { id: "thinkingmachines/inkling:free", label: "Inkling", context: "1M" },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B", context: "262K" },
  {
    id: "cohere/north-mini-code:free",
    label: "North Mini Code",
    context: "256K",
  },
]

export const DEFAULT_SETTINGS: Settings = {
  model: MODELS[0].id,
  fallbackModels: [MODELS[1].id, MODELS[2].id],
  temperature: 0.2,
  maxSteps: 8,
  apiBaseUrl: "http://localhost:3001",
}

/** The harness does not know categories; the client groups tools by name. */
export const CATEGORY_BY_NAME: Record<string, ToolCategory> = {
  list_files: "files",
  read_file: "files",
  write_file: "files",
  glob: "files",
  shell: "system",
  get_system_info: "system",
  get_env: "system",
  file_compress: "files",
  file_extract: "files",
  http_request: "network",
  get_weather: "network",
  dns_lookup: "network",
  ping: "network",
  port_check: "network",
}

/** Tools that start switched off until the user opts in. */
export const DISABLED_BY_DEFAULT = new Set(["get_env"])

export const categoryFor = (name: string): ToolCategory =>
  CATEGORY_BY_NAME[name] ?? "utility"

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = []
) => ({ type: "object", properties, required })

/**
 * Last-known tool list, used until the harness answers GET /api/tools.
 * Mirrors src/tools.ts and src/fileTools.ts in the harness.
 */
export const DEFAULT_TOOLS: ToolDef[] = [
  {
    name: "list_files",
    description: "List files and folders inside a project directory.",
    category: "files",
    enabled: true,
    parameters: objectSchema({ dir: { type: "string" } }, ["dir"]),
  },
  {
    name: "read_file",
    description: "Read the full text content of a file in the project.",
    category: "files",
    enabled: true,
    parameters: objectSchema({ path: { type: "string" } }, ["path"]),
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given text content.",
    category: "files",
    enabled: true,
    parameters: objectSchema(
      { path: { type: "string" }, content: { type: "string" } },
      ["path", "content"]
    ),
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern, relative to the root.",
    category: "files",
    enabled: true,
    parameters: objectSchema({ pattern: { type: "string" } }, ["pattern"]),
  },
  {
    name: "shell",
    description:
      "Run one allow-listed command without a shell. No pipes or chaining.",
    category: "system",
    enabled: true,
    parameters: objectSchema({ command: { type: "string" } }, ["command"]),
  },
  {
    name: "get_system_info",
    description: "Platform, memory, CPU count, Node version and uptime.",
    category: "system",
    enabled: true,
    parameters: objectSchema({}),
  },
  {
    name: "get_env",
    description: "Environment variables with secret-looking keys removed.",
    category: "system",
    enabled: false,
    parameters: objectSchema({}),
  },
  {
    name: "http_request",
    description:
      "Make an HTTP request to a public URL. Private networks are blocked.",
    category: "network",
    enabled: true,
    parameters: objectSchema({ url: { type: "string" } }, ["url"]),
  },
  {
    name: "get_weather",
    description: "Fake weather for a city (demo data).",
    category: "network",
    enabled: true,
    parameters: objectSchema({ city: { type: "string" } }, ["city"]),
  },
  {
    name: "get_current_time",
    description: "Current date and time on the harness machine.",
    category: "utility",
    enabled: true,
    parameters: objectSchema({}),
  },
  {
    name: "calculate",
    description: "Evaluate a simple math expression.",
    category: "utility",
    enabled: true,
    parameters: objectSchema({ expression: { type: "string" } }, [
      "expression",
    ]),
  },
  {
    name: "get_random_number",
    description: "Random integer between min and max, inclusive.",
    category: "utility",
    enabled: true,
    parameters: objectSchema(
      { min: { type: "number" }, max: { type: "number" } },
      ["min", "max"]
    ),
  },
  {
    name: "get_uuid",
    description: "Generate a UUID v4.",
    category: "utility",
    enabled: true,
    parameters: objectSchema({}),
  },
]
