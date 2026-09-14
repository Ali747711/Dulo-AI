// src/config.ts
// One optional file at the project root, dulo.config.json. Deliberately flat:
// no global config directory, no walk-up-and-merge, no per-key precedence.
// Dulo is one repo for one developer, so there is no second project for a
// global tier to serve.
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { CONFIG_FILE } from "./paths.js";

export { CONFIG_FILE };

const McpServer = z
  .object({
    /** Local server: a command to spawn, talked to over stdio. */
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    /** Remote server: a Streamable HTTP endpoint. */
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((s) => Boolean(s.command) !== Boolean(s.url), {
    message: "an MCP server needs exactly one of `command` or `url`",
  });

const Approval = z.object({
  /**
   * "tiers" judges each call from the tool and its arguments (src/risk.ts):
   * ordinary work inside the workspace runs, anything reaching outside asks,
   * anything that cannot be undone asks every time. "ask" is the older flat
   * name-based policy. "auto" runs everything unasked, which is how Dulo
   * behaved before the gate existed — deliberate, for unattended runs only.
   */
  mode: z.enum(["tiers", "ask", "auto"]).default("tiers"),
  /** Tool names that need approval under "ask". Omit to use the built-in list. */
  tools: z.array(z.string()).optional(),
  /** Under "tiers": names forced to run unasked. */
  allowTools: z.array(z.string()).default([]),
  /** Under "tiers": names forced to ask every time. Wins over allowTools. */
  confirmTools: z.array(z.string()).default([]),
  /** Under "ask": also gate every tool coming from an MCP server. */
  gateMcpTools: z.boolean().default(true),
});

const Loop = z.object({
  /** How many rejected done-claims a single turn may make before it must stop. */
  maxIterations: z.number().int().positive().max(10).default(3),
  /** Run a second role over the finished work before accepting a done claim. */
  independentReview: z.boolean().default(true),
  /** Which agent profile reviews. */
  reviewer: z.string().min(1).default("frontend-reviewer"),
});

const ConfigSchema = z.object({
  /** Tool names to leave out of the registry entirely. */
  disabledTools: z.array(z.string()).default([]),
  approval: Approval.default({
    mode: "tiers",
    allowTools: [],
    confirmTools: [],
    gateMcpTools: true,
  }),
  loop: Loop.default({ maxIterations: 3, independentReview: true, reviewer: "frontend-reviewer" }),
  mcpServers: z.record(z.string(), McpServer).default({}),
});

export type McpServerConfig = z.infer<typeof McpServer>;
export type DuloConfig = z.infer<typeof ConfigSchema>;

export type ApprovalConfig = z.infer<typeof Approval>;
export type LoopConfig = z.infer<typeof Loop>;

export const DEFAULT_CONFIG: DuloConfig = {
  disabledTools: [],
  approval: { mode: "tiers", allowTools: [], confirmTools: [], gateMcpTools: true },
  loop: { maxIterations: 3, independentReview: true, reviewer: "frontend-reviewer" },
  mcpServers: {},
};

/**
 * Read dulo.config.json. A missing file is normal and yields defaults; a
 * malformed one throws, because silently ignoring a config the user wrote is
 * worse than refusing to start.
 */
export const loadConfig = async (): Promise<DuloConfig> => {
  let raw: string;
  try {
    raw = await readFile(CONFIG_FILE, "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `dulo.config.json is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`dulo.config.json is invalid — ${issues}`);
  }
  return result.data;
};
