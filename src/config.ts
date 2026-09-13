// src/config.ts
// One optional file at the project root, dulo.config.json. Deliberately flat:
// no global config directory, no walk-up-and-merge, no per-key precedence.
// Dulo is one repo for one developer, so there is no second project for a
// global tier to serve.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const CONFIG_FILE = path.join(process.cwd(), "dulo.config.json");

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
   * "ask" pauses a gated tool until a human answers. "auto" runs everything
   * unasked, which is how Dulo behaved before the gate existed.
   */
  mode: z.enum(["ask", "auto"]).default("ask"),
  /** Tool names that need approval. Omit to use the built-in list. */
  tools: z.array(z.string()).optional(),
  /** Also gate every tool coming from an MCP server. They are unsandboxed. */
  gateMcpTools: z.boolean().default(true),
});

const ConfigSchema = z.object({
  /** Tool names to leave out of the registry entirely. */
  disabledTools: z.array(z.string()).default([]),
  approval: Approval.default({ mode: "ask", gateMcpTools: true }),
  mcpServers: z.record(z.string(), McpServer).default({}),
});

export type McpServerConfig = z.infer<typeof McpServer>;
export type DuloConfig = z.infer<typeof ConfigSchema>;

export type ApprovalConfig = z.infer<typeof Approval>;

export const DEFAULT_CONFIG: DuloConfig = {
  disabledTools: [],
  approval: { mode: "ask", gateMcpTools: true },
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
