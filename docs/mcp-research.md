# Adding MCP tool support to the harness (research, not implemented)

Date: 2026-09-13

## 1. Key finding: OpenRouter does nothing for MCP server-side

OpenRouter's chat completions API only understands OpenAI-style `tools` (function
definitions) and `tool_calls`. It does **not** connect to MCP servers for you. Its own
docs say the client must "establish and maintain the connection to MCP servers, handle
session management, and route tool calls" itself.

Consequence for this project: **`llm.ts` needs no changes.** MCP tools become extra
entries in the existing `Tool[]` array. The model never knows a tool came from MCP.

```
MCP server  <--(stdio / HTTP)-->  src/mcp.ts (MCP Client)  -->  Tool[]  -->  callLLM
                                        ^                                     |
                                        '------- execute(args) <--- tool_calls'
```

## 2. Two implementation paths

### Path A (recommended): official MCP client SDK, hand-wired into `Tool[]`

Package: `@modelcontextprotocol/client` v2.0.0 (published 2026-07-27, needs Node >= 20).

| Import | Path |
| --- | --- |
| `Client` | `@modelcontextprotocol/client` |
| `StreamableHTTPClientTransport` (remote servers) | `@modelcontextprotocol/client` (root) |
| `SSEClientTransport` (legacy remote) | `@modelcontextprotocol/client` (root) |
| `StdioClientTransport` (local child process) | `@modelcontextprotocol/client/stdio` |

Core calls:

```ts
const client = new Client({ name: "harness", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
// each: { name: string; description?: string; inputSchema: JSONSchema }

const result = await client.callTool({ name, arguments: args });
// result.content: [{ type: "text", text: string } | image | resource ...]
// result.isError?: true

await client.close(); // always in finally – stdio spawns a child process
```

Mapping to this project's `Tool` type is one function:

```ts
// pseudo-code, not implemented
mcpTool -> {
  name:        `${serverName}_${mcpTool.name}`,        // prefix avoids collisions
  description: mcpTool.description ?? "",
  parameters:  mcpTool.inputSchema,                    // already JSON Schema
  execute:     async (args) => {
    const r = await client.callTool({ name: mcpTool.name, arguments: args });
    const text = r.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    return r.isError ? `Error: ${text}` : text;        // agent expects a string
  },
}
```

The older v1 package `@modelcontextprotocol/sdk` (1.30.0, still maintained) works the
same way but with deep imports (`.../client/index.js`, `.../client/stdio.js`,
`.../client/streamableHttp.js`). Most tutorials online still show v1. Prefer v2 for new code.

### Path B: OpenRouter's own helper `@openrouter/agent/mcp`

`createMCPTools({ url, auth })` connects, lists, converts schemas to Zod, caches, and
returns tools. But:

- It returns tools for **`@openrouter/agent`'s `callModel`**, not plain JSON. Adopting it
  means replacing this harness's `callLLM` / `agent.ts` loop with their agent framework.
- **Remote servers only** (Streamable HTTP / SSE). stdio is "intentionally out of scope",
  so local servers like the filesystem server won't work.
- `@openrouter/mcp` is now a compatibility facade; the canonical import is
  `@openrouter/agent/mcp`.

Verdict: not a fit for a learning harness whose point is owning the loop. Worth knowing
about if the project later moves to their agent package.

## 3. Proposed design for this codebase

New file `src/mcp.ts`:

- `loadMcpTools(config): Promise<{ tools: Tool[]; close: () => Promise<void> }>`
- One `Client` per server, kept alive for the whole run (MCP sessions are stateful).
- Config file `mcp.json` at the project root, same shape as Claude Desktop / Cursor:

```json
{
  "mcpServers": {
    "fs":   { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "docs": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ..." } }
  }
}
```

  Entries with `command` -> stdio transport. Entries with `url` -> Streamable HTTP.

Changes to existing files:

- `agent.ts`: `runAgent(query, tools)` takes tools as a parameter instead of importing
  the static list; wrap `tool.execute` in try/catch and return the error text as the
  tool result (right now a throwing tool crashes the process).
- `index.ts`: `const mcp = await loadMcpTools(config)`, pass
  `[...tools, ...mcp.tools]`, call `mcp.close()` in `finally`.
- `types.ts`: unchanged. `Tool.parameters` is already `Record<string, any>` JSON Schema.

## 4. Servers to test with

| Server | Transport | Command / URL |
| --- | --- | --- |
| Filesystem (official) | stdio | `npx -y @modelcontextprotocol/server-filesystem .` |
| Everything (official test server, many tool types) | stdio | `npx -y @modelcontextprotocol/server-everything` |
| OpenRouter's own remote MCP (13 tools: model search, pricing, etc.) | HTTP | `https://mcp.openrouter.ai/mcp` (OAuth, so harder as a first test) |

Start with the filesystem server: it overlaps with the hand-written `fileTools.ts`, which
makes it easy to compare behaviour.

## 5. Caveats and gotchas

1. **Tool name rules.** OpenAI-style names must match `^[a-zA-Z0-9_-]{1,64}$`. Prefixing
   with the server name can push past 64 chars; truncate or hash if needed. Keep a map
   from the prefixed name back to `{ server, originalName }`.
2. **Schema compatibility.** MCP `inputSchema` can use `anyOf`, `$ref`, `oneOf`. OpenRouter
   passes them through untouched; some free models reject or ignore them. Consider
   stripping to a plain `object` schema when conversion fails.
3. **Token cost.** Every tool schema is sent on every request. The filesystem server
   alone adds ~10 tools. Free models handle 10 to 20 tools fine; beyond that use an
   include list per server.
4. **Non-text results.** Images, audio, and embedded resources come back as content
   blocks. The harness's `Tool.execute` returns a string, so summarise them as
   `[image omitted]` or similar.
5. **Lifecycle.** stdio servers are child processes. Without `close()` in `finally`, a
   crash leaves orphans. Also connect once at startup, not per request.
6. **Security.** A remote MCP server's tool descriptions are untrusted text the model
   reads. Same for its results. Keep `write_file` and similar sandboxing; do not let an
   MCP filesystem server point above the project root.
7. **Missing peer.** If you ever use `@openrouter/agent/mcp`, `@modelcontextprotocol/client`
   is an optional peer and the first connection throws `MCPMissingPeerDependencyError`
   when it is absent.

## 6. Sources

- OpenRouter cookbook, "Using MCP Servers with OpenRouter":
  https://openrouter.ai/docs/cookbook/coding-agents/mcp-servers
- OpenRouter blog, "The OpenRouter MCP Server" (remote server at mcp.openrouter.ai):
  https://openrouter.ai/blog/announcements/openrouter-mcp-server/
- `@openrouter/mcp` README (npm registry, v1.1.1, 2026-08-22)
- MCP TypeScript SDK v2 docs: https://ts.sdk.modelcontextprotocol.io/v2/
- "Build your first client": https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-client
- `@modelcontextprotocol/client@2.0.0` type declarations (export list verified on jsDelivr)
- MCP TypeScript SDK repo: https://github.com/modelcontextprotocol/typescript-sdk
