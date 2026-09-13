// src/agents.ts
// A named agent is a Markdown file in agents/: frontmatter overrides the model
// and narrows the tool list, the body replaces the system prompt. That makes a
// persona something you commit to the repo instead of re-specifying on every
// API call.
import type { Tool } from "./types.js";
import { loadMarkdownDir } from "./markdown.js";

export const AGENTS_DIR = "agents";

export interface AgentProfile {
  name: string;
  description: string;
  /** Replaces the default system prompt. */
  prompt: string;
  model?: string;
  temperature?: number;
  maxSteps?: number;
  /**
   * Tool allow/deny map. The key "*" sets the default for tools not named,
   * so `{"*": false, read_file: true}` means "read_file only".
   */
  tools?: Record<string, boolean>;
  file: string;
}

const asBoolMap = (raw: unknown): Record<string, boolean> | undefined => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const asNumber = (raw: unknown): number | undefined =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;

export const loadAgents = async (): Promise<AgentProfile[]> =>
  (await loadMarkdownDir(AGENTS_DIR))
    .filter((doc) => doc.body.length > 0)
    .map((doc) => ({
      name: doc.name,
      description: doc.description,
      prompt: doc.body,
      model: typeof doc.data.model === "string" ? doc.data.model : undefined,
      temperature: asNumber(doc.data.temperature),
      maxSteps: asNumber(doc.data.maxSteps),
      tools: asBoolMap(doc.data.tools),
      file: doc.file,
    }));

/**
 * Narrow a tool list with an agent's allow/deny map. Absent map means every
 * tool; "*" sets the default for anything not named explicitly.
 */
export const applyToolPolicy = (
  tools: Tool[],
  policy: Record<string, boolean> | undefined,
): Tool[] => {
  if (!policy) return tools;
  const fallback = policy["*"] ?? true;
  return tools.filter((tool) => policy[tool.name] ?? fallback);
};
