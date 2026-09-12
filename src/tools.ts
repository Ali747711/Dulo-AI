import { fileTools } from "./fileTools.js";
import type { Tool } from "./types.js";
import os from "os";
import crypto from "crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip, createGunzip, createDeflate, createInflate } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { lookup, resolve4, resolve6, resolveAny, resolveMx, resolveNs, resolveTxt, resolveSrv, resolveCname } from "node:dns/promises";
import net from "node:net";

const execFileAsync = promisify(execFile);

// Safety limits for shell commands
const SHELL_TIMEOUT_MS = 30_000; // 30 seconds
const SHELL_MAX_OUTPUT = 10_000; // 10KB max output
const ALLOWED_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "grep", "find", "wc", "echo", "pwd",
  "date", "whoami", "id", "uname", "df", "du", "ps", "top", "free",
  "node", "npm", "npx", "tsx", "tsc", "git",
  "python3", "python", "go", "cargo", "rustc", "make",
]);
// Flags that turn an allowed interpreter into "run arbitrary code"
const BLOCKED_FLAGS = new Set(["-e", "--eval", "-p", "--print", "-c"]);

// Safety limits for HTTP requests
const HTTP_TIMEOUT_MS = 15_000; // 15 seconds
const HTTP_MAX_DOWNLOAD_BYTES = 5_000_000; // stop reading the socket past 5MB
const HTTP_DEFAULT_CHARS = 8_000; // text returned to the model by default
const HTTP_MAX_CHARS = 100_000; // ceiling the model may ask for

const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Read a response body but stop once `cap` bytes have arrived. */
const readCapped = async (response: Response, cap: number): Promise<Uint8Array> => {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
      if (total >= cap) break;
    }
  } finally {
    // Releasing early tells the server to stop sending
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, Math.min(total, cap));
};

/** Strip markup so the model reads prose instead of a wall of HTML. */
const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

// Block SSRF-style requests to the local machine or LAN
const isPrivateHost = (hostname: string): boolean => {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) {
    return true;
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

export const tools: Tool[] = [
  ...fileTools,
  {
    name: "get_current_time",
    description: "Get the current date and time",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => {
      return new Date().toLocaleString();
    },
  },
  {
    name: "calculate",
    description: "Evaluate a simple math expression (e.g. 12 * 7 + 3)",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Math expression" },
      },
      required: ["expression"],
    },
    execute: async ({ expression }) => {
      // Very basic & safe for demo only
      const result = Function(`"use strict"; return (${expression})`)();
      return String(result);
    },
  },
  {
    name: "get_weather",
    description: "Get fake weather for a city (demo)",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string" },
      },
      required: ["city"],
    },
    execute: async ({ city }) => {
      // Fake data for demo
      return `Weather in ${city}: 22°C, partly cloudy`;
    },
  },
  // New tools
  {
    name: "get_system_info",
    description: "Get basic system information (OS, Node version, etc.)",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => {
      return JSON.stringify({
        platform: os.platform(),
        arch: os.arch(),
        totalmem: os.totalmem(),
        freemem: os.freemem(),
        cpus: os.cpus().length,
        nodeVersion: process.version,
        uptime: os.uptime(),
      }, null, 2);
    },
  },
  {
    name: "get_env",
    description: "Get environment variables (excluding sensitive ones)",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => {
      const sensitiveKeys = [
        "KEY", "TOKEN", "SECRET", "PASSWORD", "PASS", "AWS", "GOOGLE", "GITHUB", "NPM_TOKEN"
      ];
      const env = Object.entries(process.env)
        .filter(([key]) => !sensitiveKeys.some(s => key.toUpperCase().includes(s)))
        .reduce<Record<string, string>>(
          (acc, [key, value]) => ({ ...acc, [key]: value ?? "" }),
          {},
        );
      return JSON.stringify(env, null, 2);
    },
  },
  {
    name: "get_random_number",
    description: "Get a random integer between min and max (inclusive)",
    parameters: {
      type: "object",
      properties: {
        min: { type: "number", description: "Minimum value" },
        max: { type: "number", description: "Maximum value" },
      },
      required: ["min", "max"],
    },
    execute: async ({ min, max }) => {
      if (min > max) [min, max] = [max, min];
      const random = Math.floor(Math.random() * (max - min + 1)) + min;
      return String(random);
    },
  },
  {
    name: "get_uuid",
    description: "Generate a UUID v4",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async () => {
      return crypto.randomUUID();
    },
  },

  // ============ NEW TOOLS ============

  // Shell command execution with safety limits
  {
    name: "shell",
    description:
      "Execute a command with safety limits (timeout, output size, allowed commands). " +
      "Only a predefined set of safe commands are allowed. The command is NOT run through a shell, " +
      "so pipes, redirects, globs, and && chaining do not work: pass one command and its arguments.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute (e.g., 'ls -la', 'npm test', 'git status')",
        },
        cwd: {
          type: "string",
          description: "Working directory (relative to project root). Defaults to project root.",
        },
        timeout: {
          type: "number",
          description: `Timeout in milliseconds (max ${SHELL_TIMEOUT_MS}). Default: 30000`,
        },
      },
      required: ["command"],
    },
    execute: async ({ command, cwd = ".", timeout = SHELL_TIMEOUT_MS }) => {
      // Validate command is allowed
      const cmdParts = command.trim().split(/\s+/);
      const baseCmd = cmdParts[0].toLowerCase();
      const baseCmdName = baseCmd.split("/").pop() || baseCmd;

      if (!ALLOWED_COMMANDS.has(baseCmdName)) {
        return `Error: Command "${baseCmdName}" is not in the allowed list. Allowed: ${Array.from(ALLOWED_COMMANDS).join(", ")}`;
      }
      const args: string[] = cmdParts.slice(1);
      const blocked = args.find((a) => BLOCKED_FLAGS.has(a));
      if (blocked) {
        return `Error: Flag "${blocked}" is not allowed (inline code execution)`;
      }

      // Validate timeout
      if (timeout > SHELL_TIMEOUT_MS) {
        return `Error: Timeout cannot exceed ${SHELL_TIMEOUT_MS}ms`;
      }

      // Resolve working directory safely
      const ROOT = process.cwd();
      const resolvedCwd = path.resolve(ROOT, cwd);
      if (resolvedCwd !== ROOT && !resolvedCwd.startsWith(ROOT + path.sep)) {
        return `Error: Working directory "${cwd}" is outside the project root`;
      }

      try {
        const { stdout, stderr } = await execFileAsync(baseCmdName, args, {
          cwd: resolvedCwd,
          timeout,
          maxBuffer: SHELL_MAX_OUTPUT,
          shell: false,
        });

        let output = stdout;
        if (stderr) {
          output += (output ? "\n" : "") + `stderr: ${stderr}`;
        }

        if (output.length > SHELL_MAX_OUTPUT) {
          output = output.slice(0, SHELL_MAX_OUTPUT) + "\n... (output truncated)";
        }

        return output || "(no output)";
      } catch (error: any) {
        if (error.killed && error.signal === "SIGTERM") {
          return `Error: Command timed out after ${timeout}ms`;
        }
        if (error.message?.includes("maxBuffer")) {
          return `Error: Output exceeded ${SHELL_MAX_OUTPUT} bytes limit`;
        }
        return `Error: ${error.message || String(error)}`;
      }
    },
  },

  // HTTP requests
  {
    name: "http_request",
    description:
      "Fetch a URL and return its content as readable text. HTML pages are " +
      "stripped to plain text. Long responses are truncated, never rejected. " +
      "Supports GET, POST, PUT, PATCH, DELETE with optional headers and body.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to request (must use http:// or https://)",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
          description: "HTTP method. Default: GET",
          default: "GET",
        },
        headers: {
          type: "object",
          description: "HTTP headers as key-value pairs",
          additionalProperties: { type: "string" },
        },
        body: {
          type: "string",
          description: "Request body (for POST, PUT, PATCH)",
        },
        maxChars: {
          type: "number",
          description: `How much text to return, up to ${HTTP_MAX_CHARS}. Default: ${HTTP_DEFAULT_CHARS}`,
        },
        raw: {
          type: "boolean",
          description: "Return the body as-is instead of converting HTML to text",
        },
      },
      required: ["url"],
    },
    execute: async ({
      url,
      method = "GET",
      headers = {},
      body,
      maxChars = HTTP_DEFAULT_CHARS,
      raw = false,
    }: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      maxChars?: number;
      raw?: boolean;
    }) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return "Error: Invalid URL";
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return "Error: Only http:// and https:// URLs are allowed";
      }
      if (isPrivateHost(parsedUrl.hostname)) {
        return "Error: Requests to localhost or private network addresses are not allowed";
      }

      const limit = Math.min(Math.max(1, maxChars), HTTP_MAX_CHARS);

      try {
        const response = await fetch(url, {
          method,
          headers: { "User-Agent": "Dulo/1.0", ...headers },
          body:
            body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())
              ? body
              : undefined,
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
          redirect: "follow",
        });

        const contentType = response.headers.get("content-type") ?? "unknown";
        const bytes = await readCapped(response, HTTP_MAX_DOWNLOAD_BYTES);
        const decoded = new TextDecoder().decode(bytes);
        const text =
          raw || !/html/i.test(contentType) ? decoded : htmlToText(decoded);

        const head = [
          `${response.status} ${response.statusText || ""}`.trim(),
          contentType.split(";")[0],
          `${formatBytes(bytes.length)} received`,
        ].join(" · ");
        // response.url reflects the final hop after redirects
        const location =
          response.url && response.url !== url ? `\nredirected to ${response.url}` : "";

        // A big HTML payload that yields almost no text is client-rendered:
        // refetching it will not help, so say so instead of letting the
        // model retry the same URL.
        const hint =
          /html/i.test(contentType) && bytes.length > 50_000 && text.length < 2_000
            ? "\n\n[This page renders its content with JavaScript, so the HTML holds " +
              "only navigation text. Refetching will return the same thing. Look for " +
              "a JSON API on the same site instead.]"
            : "";

        if (text.length <= limit) {
          return `${head}${location}\n\n${text}${hint}`;
        }
        return (
          `${head}${location}\n\n${text.slice(0, limit)}\n\n` +
          `[truncated: showing ${limit} of ${text.length} characters. ` +
          `Call again with a larger maxChars, or a more specific URL.]${hint}`
        );
      } catch (error) {
        const err = error as { name?: string; message?: string };
        if (err.name === "TimeoutError" || err.name === "AbortError") {
          return `Error: Request timed out after ${HTTP_TIMEOUT_MS}ms`;
        }
        return `Error: ${err.message ?? String(error)}`;
      }
    },
  },
  // File search/glob
  {
    name: "glob",
    description:
      "Find files matching a glob pattern (e.g., '**/*.ts', 'src/**/*.test.ts', '*.json'). " +
      "Returns a list of matching file paths relative to the project root. " +
      "Supports standard glob patterns: *, **, ?, [...], {...}.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.test.ts')",
        },
        cwd: {
          type: "string",
          description: "Base directory to search from (relative to project root). Default: project root",
        },
        ignore: {
          type: "array",
          items: { type: "string" },
          description: "Additional patterns to ignore (e.g., ['node_modules/**', 'dist/**'])",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return. Default: 100",
          default: 100,
        },
      },
      required: ["pattern"],
    },
    execute: async ({ pattern, cwd = ".", ignore = [], maxResults = 100 }) => {
      const ROOT = process.cwd();
      const resolvedCwd = path.resolve(ROOT, cwd);

      if (resolvedCwd !== ROOT && !resolvedCwd.startsWith(ROOT + path.sep)) {
        return `Error: Search directory "${cwd}" is outside the project root`;
      }

      // Default ignore patterns
      const defaultIgnore = ["node_modules", "node_modules/**", ".git", ".git/**", "dist", "dist/**", "build", "build/**", "*.log"];
      const allIgnore: string[] = [...defaultIgnore, ...ignore];

      try {
        const matches: string[] = [];
        // Node's built-in glob only supports cwd, withFileTypes and exclude
        for await (const entry of glob(pattern, {
          cwd: resolvedCwd,
          withFileTypes: true,
          exclude: allIgnore,
        })) {
          if (!entry.isFile()) continue; // files only, not directories
          matches.push(path.join(entry.parentPath, entry.name));
          if (matches.length >= maxResults) break;
        }

        if (matches.length === 0) {
          return `(no files matching "${pattern}")`;
        }

        const relativePaths = matches.map((m) => path.relative(ROOT, m));
        let output = relativePaths.join("\n");

        if (matches.length >= maxResults) {
          output += `\n... (truncated to ${maxResults} results)`;
        }

        return output;
      } catch (error: any) {
        return `Error: ${error.message || String(error)}`;
      }
    },
  },

  // ============ REQUESTED TOOLS ============

  // File compression (gzip)
  {
    name: "file_compress",
    description:
      "Compress a file using gzip or deflate. " +
      "Input and output paths must be within the project root.",
    parameters: {
      type: "object",
      properties: {
        inputPath: {
          type: "string",
          description: "Path to the file to compress (relative to project root)",
        },
        outputPath: {
          type: "string",
          description: "Path for the compressed output file (relative to project root)",
        },
        algorithm: {
          type: "string",
          enum: ["gzip", "deflate"],
          description: "Compression algorithm. Default: gzip",
          default: "gzip",
        },
      },
      required: ["inputPath", "outputPath"],
    },
    execute: async ({ inputPath, outputPath, algorithm = "gzip" }) => {
      const ROOT = process.cwd();
      const resolvedInput = path.resolve(ROOT, inputPath);
      const resolvedOutput = path.resolve(ROOT, outputPath);

      // Safety: ensure paths are within project root
      if (!resolvedInput.startsWith(ROOT + path.sep) && resolvedInput !== ROOT) {
        return `Error: Input path "${inputPath}" is outside the project root`;
      }
      if (!resolvedOutput.startsWith(ROOT + path.sep) && resolvedOutput !== ROOT) {
        return `Error: Output path "${outputPath}" is outside the project root`;
      }

      try {
        const inputStream = createReadStream(resolvedInput);
        const outputStream = createWriteStream(resolvedOutput);
        const compressor = algorithm === "gzip" ? createGzip({ level: 9 }) : createDeflate({ level: 9 });

        await pipeline(inputStream, compressor, outputStream);

        const stats = await import("node:fs/promises").then(fs => fs.stat(resolvedOutput));
        return `Compressed ${inputPath} -> ${outputPath} (${stats.size} bytes, ${algorithm})`;
      } catch (error: any) {
        return `Error: ${error.message || String(error)}`;
      }
    },
  },

  // File extraction (gzip/deflate)
  {
    name: "file_extract",
    description:
      "Extract a gzip or deflate compressed file. " +
      "Input and output paths must be within the project root.",
    parameters: {
      type: "object",
      properties: {
        inputPath: {
          type: "string",
          description: "Path to the compressed file (relative to project root)",
        },
        outputPath: {
          type: "string",
          description: "Path for the extracted output file (relative to project root)",
        },
        algorithm: {
          type: "string",
          enum: ["gzip", "deflate"],
          description: "Compression algorithm used. Default: gzip",
          default: "gzip",
        },
      },
      required: ["inputPath", "outputPath"],
    },
    execute: async ({ inputPath, outputPath, algorithm = "gzip" }) => {
      const ROOT = process.cwd();
      const resolvedInput = path.resolve(ROOT, inputPath);
      const resolvedOutput = path.resolve(ROOT, outputPath);

      // Safety: ensure paths are within project root
      if (!resolvedInput.startsWith(ROOT + path.sep) && resolvedInput !== ROOT) {
        return `Error: Input path "${inputPath}" is outside the project root`;
      }
      if (!resolvedOutput.startsWith(ROOT + path.sep) && resolvedOutput !== ROOT) {
        return `Error: Output path "${outputPath}" is outside the project root`;
      }

      try {
        const inputStream = createReadStream(resolvedInput);
        const outputStream = createWriteStream(resolvedOutput);
        const decompressor = algorithm === "gzip" ? createGunzip() : createInflate();

        await pipeline(inputStream, decompressor, outputStream);

        const stats = await import("node:fs/promises").then(fs => fs.stat(resolvedOutput));
        return `Extracted ${inputPath} -> ${outputPath} (${stats.size} bytes, ${algorithm})`;
      } catch (error: any) {
        return `Error: ${error.message || String(error)}`;
      }
    },
  },

  // DNS lookup
  {
    name: "dns_lookup",
    description:
      "Perform DNS lookups for a domain. Supports A, AAAA, MX, NS, TXT, SRV, CNAME, and ANY records.",
    parameters: {
      type: "object",
      properties: {
        hostname: {
          type: "string",
          description: "The domain name to look up (e.g., 'example.com')",
        },
        recordType: {
          type: "string",
          enum: ["A", "AAAA", "MX", "NS", "TXT", "SRV", "CNAME", "ANY"],
          description: "DNS record type to query. Default: A",
          default: "A",
        },
      },
      required: ["hostname"],
    },
    execute: async ({ hostname, recordType = "A" }) => {
      // Basic validation
      if (!hostname || hostname.length > 255) {
        return "Error: Invalid hostname";
      }

      try {
        let results: any;
        switch (recordType) {
          case "A":
            results = await resolve4(hostname);
            break;
          case "AAAA":
            results = await resolve6(hostname);
            break;
          case "MX":
            results = await resolveMx(hostname);
            break;
          case "NS":
            results = await resolveNs(hostname);
            break;
          case "TXT":
            results = await resolveTxt(hostname);
            break;
          case "SRV":
            results = await resolveSrv(hostname);
            break;
          case "CNAME":
            results = await resolveCname(hostname);
            break;
          case "ANY":
            results = await resolveAny(hostname);
            break;
          default:
            results = await lookup(hostname);
        }
        return JSON.stringify(results, null, 2);
      } catch (error: any) {
        return `Error: ${error.message || String(error)}`;
      }
    },
  },

  // Ping (TCP connect to port 80/443 as ICMP ping requires root)
  {
    name: "ping",
    description:
      "Check if a host is reachable via TCP connection (to port 80 or 443). " +
      "Note: This uses TCP connect, not ICMP ping, so it works without root privileges.",
    parameters: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "Hostname or IP address to ping",
        },
        port: {
          type: "number",
          description: "Port to connect to (default: 80 for HTTP, 443 for HTTPS)",
          default: 80,
        },
        timeout: {
          type: "number",
          description: "Connection timeout in milliseconds. Default: 5000",
          default: 5000,
        },
      },
      required: ["host"],
    },
    execute: async ({ host, port = 80, timeout = 5000 }) => {
      // Validate host
      if (!host || host.length > 255) {
        return "Error: Invalid host";
      }
      if (port < 1 || port > 65535) {
        return "Error: Port must be between 1 and 65535";
      }
      if (timeout > 30000) {
        return "Error: Timeout cannot exceed 30000ms";
      }

      const start = Date.now();
      return new Promise<string>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);

        socket.on("connect", () => {
          const latency = Date.now() - start;
          socket.destroy();
          resolve(`Host ${host}:${port} is reachable (TCP connect in ${latency}ms)`);
        });

        socket.on("timeout", () => {
          socket.destroy();
          resolve(`Error: Connection to ${host}:${port} timed out after ${timeout}ms`);
        });

        socket.on("error", (err: Error) => {
          const latency = Date.now() - start;
          resolve(`Error: Cannot reach ${host}:${port} (${err.message}, ${latency}ms)`);
        });

        socket.connect(port, host);
      });
    },
  },

  // Port check
  {
    name: "port_check",
    description:
      "Check if a specific TCP port is open on a host. " +
      "Returns whether the port is open, closed, or filtered.",
    parameters: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "Hostname or IP address to check",
        },
        port: {
          type: "number",
          description: "Port number to check (1-65535)",
        },
        timeout: {
          type: "number",
          description: "Connection timeout in milliseconds. Default: 3000",
          default: 3000,
        },
      },
      required: ["host", "port"],
    },
    execute: async ({ host, port, timeout = 3000 }) => {
      // Validate host
      if (!host || host.length > 255) {
        return "Error: Invalid host";
      }
      if (port < 1 || port > 65535) {
        return "Error: Port must be between 1 and 65535";
      }
      if (timeout > 30000) {
        return "Error: Timeout cannot exceed 30000ms";
      }

      const start = Date.now();
      return new Promise<string>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);

        socket.on("connect", () => {
          const latency = Date.now() - start;
          socket.destroy();
          resolve(`Port ${port} on ${host} is OPEN (connected in ${latency}ms)`);
        });

        socket.on("timeout", () => {
          socket.destroy();
          resolve(`Port ${port} on ${host} is FILTERED/TIMEOUT (no response after ${timeout}ms)`);
        });

        socket.on("error", (err: Error) => {
          const latency = Date.now() - start;
          if (err.message.includes("ECONNREFUSED")) {
            resolve(`Port ${port} on ${host} is CLOSED (connection refused, ${latency}ms)`);
          } else if (err.message.includes("ENOTFOUND") || err.message.includes("EAI_AGAIN")) {
            resolve(`Error: Cannot resolve host "${host}"`);
          } else if (err.message.includes("EHOSTUNREACH") || err.message.includes("ENETUNREACH")) {
            resolve(`Port ${port} on ${host} is FILTERED/UNREACHABLE (${err.message}, ${latency}ms)`);
          } else {
            resolve(`Error: ${err.message} (${latency}ms)`);
          }
        });

        socket.connect(port, host);
      });
    },
  },

  // Generate password
  {
    name: "generate_password",
    description:
      "Generate a cryptographically secure random password with configurable options.",
    parameters: {
      type: "object",
      properties: {
        length: {
          type: "number",
          description: "Password length (8-128). Default: 16",
          default: 16,
          minimum: 8,
          maximum: 128,
        },
        includeUppercase: {
          type: "boolean",
          description: "Include uppercase letters (A-Z). Default: true",
          default: true,
        },
        includeLowercase: {
          type: "boolean",
          description: "Include lowercase letters (a-z). Default: true",
          default: true,
        },
        includeNumbers: {
          type: "boolean",
          description: "Include numbers (0-9). Default: true",
          default: true,
        },
        includeSymbols: {
          type: "boolean",
          description: "Include special symbols (!@#$%^&*). Default: true",
          default: true,
        },
        excludeSimilar: {
          type: "boolean",
          description: "Exclude similar-looking characters (l, 1, I, O, 0, etc.). Default: false",
          default: false,
        },
      },
      required: [],
    },
    execute: async ({
      length = 16,
      includeUppercase = true,
      includeLowercase = true,
      includeNumbers = true,
      includeSymbols = true,
      excludeSimilar = false,
    }) => {
      // Validate length
      if (length < 8 || length > 128) {
        return "Error: Length must be between 8 and 128";
      }

      // Character sets
      let uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      let lowercase = "abcdefghijklmnopqrstuvwxyz";
      let numbers = "0123456789";
      let symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";

      if (excludeSimilar) {
        uppercase = uppercase.replace(/[IL]/g, "");
        lowercase = lowercase.replace(/[il]/g, "");
        numbers = numbers.replace(/[01]/g, "");
        symbols = symbols.replace(/[|]/g, "");
      }

      let charset = "";
      if (includeUppercase) charset += uppercase;
      if (includeLowercase) charset += lowercase;
      if (includeNumbers) charset += numbers;
      if (includeSymbols) charset += symbols;

      if (charset.length === 0) {
        return "Error: At least one character type must be enabled";
      }

      // Generate password using crypto.randomBytes for cryptographic security
      const bytes = crypto.randomBytes(length);
      let password = "";
      for (let i = 0; i < length; i++) {
        password += charset[bytes[i] % charset.length];
      }

      // Ensure at least one character from each enabled set
      const checks = [
        { enabled: includeUppercase, set: uppercase, name: "uppercase" },
        { enabled: includeLowercase, set: lowercase, name: "lowercase" },
        { enabled: includeNumbers, set: numbers, name: "number" },
        { enabled: includeSymbols, set: symbols, name: "symbol" },
      ];

      for (const check of checks) {
        if (check.enabled && !check.set.split("").some(c => password.includes(c))) {
          // Replace a random position with a character from this set
          const pos = crypto.randomInt(0, length);
          const char = check.set[crypto.randomInt(0, check.set.length)];
          password = password.slice(0, pos) + char + password.slice(pos + 1);
        }
      }

      return password;
    },
  },
];