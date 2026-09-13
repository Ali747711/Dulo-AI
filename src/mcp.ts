// src/mcp.ts
// MCP servers are just more entries in the same Tool[] the agent already
// iterates. Connect once at startup (sessions are stateful and spawning a child
// process per request would be absurd), merge their tools into the registry,
// and close every client on shutdown so stdio servers are not orphaned.
//
// OpenRouter does nothing for MCP server-side — see docs/mcp-research.md — so
// the client lives here.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import type { McpServerConfig } from "./config.js";
import type { Tool } from "./types.js";

/** OpenAI-style tool names must match this; MCP names are not so constrained. */
const NAME_OK = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_NAME = 64;
const CONNECT_TIMEOUT_MS = 20_000;

export interface McpRegistry {
  tools: Tool[];
  close: () => Promise<void>;
}

/**
 * Prefix a tool with its server so two servers can both expose "search", while
 * staying inside the 64-character limit models enforce.
 */
export const prefixName = (server: string, tool: string): string => {
  const raw = `${server}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (raw.length <= MAX_NAME) return raw;
  // Keep it deterministic and collision-resistant when truncation is needed.
  let hash = 0;
  for (const char of raw) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const suffix = `_${hash.toString(36)}`;
  return raw.slice(0, MAX_NAME - suffix.length) + suffix;
};

/**
 * MCP results are content blocks, but Tool.execute returns a string. Text is
 * concatenated; anything else is named rather than silently dropped, so the
 * model knows something came back that it cannot see.
 */
export const flattenContent = (result: unknown): string => {
  const r = result as {
    content?: { type?: string; text?: string; [k: string]: unknown }[];
    isError?: boolean;
    structuredContent?: unknown;
  };
  const blocks = Array.isArray(r?.content) ? r.content : [];
  const parts = blocks.map((block) => {
    if (block.type === "text" && typeof block.text === "string") return block.text;
    return `[${block.type ?? "unknown"} content omitted]`;
  });
  if (parts.length === 0 && r?.structuredContent !== undefined) {
    return JSON.stringify(r.structuredContent);
  }
  return parts.join("\n").trim() || "(no content)";
};

/** MCP input schemas are JSON Schema already, but may be missing or empty. */
const toParameters = (schema: unknown): Record<string, unknown> => {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return { type: "object", properties: {} };
};

const connect = async (
  name: string,
  config: McpServerConfig,
): Promise<{ client: Client; tools: Tool[] }> => {
  const client = new Client({ name: "dulo", version: "1.0.0" });

  const transport = config.command
    ? new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
      })
    : new StreamableHTTPClientTransport(new URL(config.url as string), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });

  await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS } as never);

  const listed = await client.listTools();
  const tools: Tool[] = (listed.tools ?? []).map((tool) => {
    const exposed = NAME_OK.test(tool.name)
      ? prefixName(name, tool.name)
      : prefixName(name, tool.name.replace(/[^a-zA-Z0-9_-]/g, "_"));
    return {
      name: exposed,
      // A remote server's description is untrusted text the model will read.
      // Naming the server makes its provenance visible in the prompt.
      description: `[mcp:${name}] ${tool.description ?? tool.name}`,
      parameters: toParameters(tool.inputSchema),
      execute: async (args: Record<string, unknown>) => {
        const result = await client.callTool({
          name: tool.name,
          arguments: args,
        });
        const text = flattenContent(result);
        if ((result as { isError?: boolean }).isError) throw new Error(text);
        return text;
      },
    };
  });

  return { client, tools };
};

/**
 * Connect every configured server. One server failing to start must not stop
 * the harness: it is reported and skipped, and the rest still load.
 */
export const loadMcpTools = async (
  servers: Record<string, McpServerConfig>,
): Promise<McpRegistry> => {
  const entries = Object.entries(servers).filter(
    ([, config]) => config.enabled !== false,
  );
  if (entries.length === 0) {
    return { tools: [], close: async () => {} };
  }

  const clients: Client[] = [];
  const tools: Tool[] = [];

  const results = await Promise.all(
    entries.map(async ([name, config]) => {
      try {
        return { name, ...(await connect(name, config)) };
      } catch (error) {
        console.warn(
          `[dulo] MCP server "${name}" failed to start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }
    }),
  );

  for (const result of results) {
    if (!result) continue;
    clients.push(result.client);
    tools.push(...result.tools);
    console.log(
      `[dulo] MCP "${result.name}": ${result.tools.length} tool(s)`,
    );
  }

  return {
    tools,
    close: async () => {
      await Promise.all(
        clients.map((client) => client.close().catch(() => {})),
      );
    },
  };
};
