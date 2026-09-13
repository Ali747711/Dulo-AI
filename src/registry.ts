// src/registry.ts
// Everything the agent can use, resolved once at startup: built-in tools, tools
// dropped into src/tools/custom/, tools exposed by MCP servers, the skills
// catalogue, and named agent profiles. The agent loop never learns where a tool
// came from — it still just iterates a Tool[].
import { loadAgents, type AgentProfile } from "./agents.js";
import { loadConfig, type DuloConfig, DEFAULT_CONFIG } from "./config.js";
import { loadMcpTools, type McpRegistry } from "./mcp.js";
import { DEFAULT_GATED_TOOLS } from "./permissions.js";
import { createSkillTool, describeSkills, loadSkills, type Skill } from "./skills.js";
import { builtinTools } from "./tools/index.js";
import { loadCustomTools } from "./tools/custom.js";
import type { Tool } from "./types.js";

export interface Registry {
  tools: Tool[];
  /** Tool names the permission gate should stop on, resolved from config. */
  gatedTools: string[];
  skills: Skill[];
  agents: AgentProfile[];
  config: DuloConfig;
  /** Appended to the system prompt so the model knows which skills exist. */
  skillsPrompt: string;
  close: () => Promise<void>;
}

const EMPTY: Registry = {
  tools: builtinTools,
  gatedTools: DEFAULT_GATED_TOOLS,
  skills: [],
  agents: [],
  config: DEFAULT_CONFIG,
  skillsPrompt: "",
  close: async () => {},
};

let current: Registry = EMPTY;

/** The resolved registry. Falls back to built-ins before init() has run. */
export const getRegistry = (): Registry => current;
export const getTools = (): Tool[] => current.tools;
export const getAgent = (name: string): AgentProfile | undefined =>
  current.agents.find((a) => a.name === name);

const dedupe = (tools: Tool[]): Tool[] => {
  const seen = new Map<string, Tool>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      console.warn(`[dulo] duplicate tool "${tool.name}" ignored`);
      continue;
    }
    seen.set(tool.name, tool);
  }
  return [...seen.values()];
};

/**
 * Build the registry. Called once at startup by the server and the CLI.
 * A failure in any optional source is reported and skipped rather than
 * preventing the harness from starting at all.
 */
export const initRegistry = async (): Promise<Registry> => {
  let config = DEFAULT_CONFIG;
  try {
    config = await loadConfig();
  } catch (error) {
    console.warn(
      `[dulo] ${error instanceof Error ? error.message : String(error)} — using defaults`,
    );
  }

  const [custom, skills, agents] = await Promise.all([
    loadCustomTools(),
    loadSkills(),
    loadAgents(),
  ]);

  let mcp: McpRegistry = { tools: [], close: async () => {} };
  try {
    mcp = await loadMcpTools(config.mcpServers);
  } catch (error) {
    console.warn(
      `[dulo] MCP setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const disabled = new Set(config.disabledTools);
  const tools = dedupe([
    ...builtinTools,
    ...custom,
    ...mcp.tools,
    ...(skills.length > 0 ? [createSkillTool(skills)] : []),
  ]).filter((tool) => !disabled.has(tool.name));

  // MCP tools are outside Dulo's sandbox, so they are gated with the rest
  // unless the config explicitly says otherwise.
  const gatedTools =
    config.approval.mode === "auto"
      ? []
      : [
          ...(config.approval.tools ?? DEFAULT_GATED_TOOLS),
          ...(config.approval.gateMcpTools ? mcp.tools.map((t) => t.name) : []),
        ].filter((name) => tools.some((t) => t.name === name));

  current = {
    tools,
    gatedTools,
    skills,
    agents,
    config,
    skillsPrompt: describeSkills(skills),
    close: mcp.close,
  };

  const extras = [
    custom.length > 0 && `${custom.length} custom`,
    mcp.tools.length > 0 && `${mcp.tools.length} from MCP`,
    skills.length > 0 && `${skills.length} skill(s)`,
    agents.length > 0 && `${agents.length} agent(s)`,
    disabled.size > 0 && `${disabled.size} disabled by config`,
    gatedTools.length > 0 && `${gatedTools.length} need approval`,
  ].filter(Boolean);
  console.log(
    `[dulo] ${tools.length} tools ready` +
      (extras.length > 0 ? ` (${extras.join(", ")})` : ""),
  );

  return current;
};

export const closeRegistry = async (): Promise<void> => {
  await current.close();
  current = EMPTY;
};
