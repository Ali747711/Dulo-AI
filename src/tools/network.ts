// src/tools/network.ts
import { lookup, resolve4, resolve6, resolveAny, resolveMx, resolveNs, resolveTxt, resolveSrv, resolveCname } from "node:dns/promises";
import net from "node:net";
import type { Tool } from "../types.js";

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

/**
 * Validates if an IP address belongs to loopback, link-local, or private RFC ranges.
 */
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  const lower = ip.toLowerCase();
  if (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  ) {
    return true;
  }

  return false;
}

/** Check hostname and resolved IP for SSRF defense. */
async function validateUrlSecurity(urlString: string): Promise<{ ok: boolean; error?: string; parsed?: URL }> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, error: "Error: Invalid URL" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Error: Only http:// and https:// URLs are allowed" };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // Hostname heuristics
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  ) {
    return { ok: false, error: "Error: Requests to localhost or private network addresses are not allowed" };
  }

  // If already an IP address, check directly
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { ok: false, error: "Error: Requests to localhost or private network addresses are not allowed" };
    }
    return { ok: true, parsed };
  }

  // Pre-resolve hostname to check for DNS rebinding/private CNAMEs
  try {
    const { address } = await lookup(hostname);
    if (isPrivateIp(address)) {
      return { ok: false, error: "Error: Requests to localhost or private network addresses are not allowed" };
    }
  } catch (error: any) {
    return { ok: false, error: `Error: Cannot resolve hostname "${hostname}" (${error.message})` };
  }

  return { ok: true, parsed };
}

export const httpRequestTool: Tool = {
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
    const check = await validateUrlSecurity(url);
    if (!check.ok || !check.parsed) {
      return check.error || "Error: Access to URL is prohibited";
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

      const location =
        response.url && response.url !== url ? `\nredirected to ${response.url}` : "";

      if (text.length <= limit) {
        return `${head}${location}\n\n${text}`;
      }
      return (
        `${head}${location}\n\n${text.slice(0, limit)}\n\n` +
        `[truncated: showing ${limit} of ${text.length} characters. ` +
        `Call again with a larger maxChars, or a more specific URL.]`
      );
    } catch (error) {
      const err = error as { name?: string; message?: string };
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        return `Error: Request timed out after ${HTTP_TIMEOUT_MS}ms`;
      }
      return `Error: ${err.message ?? String(error)}`;
    }
  },
};

export const dnsLookupTool: Tool = {
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
  execute: async ({ hostname, recordType = "A" }: { hostname: string; recordType?: string }) => {
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
};

export const pingTool: Tool = {
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
  execute: async ({ host, port = 80, timeout = 5000 }: { host: string; port?: number; timeout?: number }) => {
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
};

export const portCheckTool: Tool = {
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
  execute: async ({ host, port, timeout = 3000 }: { host: string; port: number; timeout?: number }) => {
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
};

export const getWeatherTool: Tool = {
  name: "get_weather",
  description: "Get fake weather for a city (demo)",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string" },
    },
    required: ["city"],
  },
  execute: async ({ city }: { city: string }) => {
    return `Weather in ${city}: 22°C, partly cloudy`;
  },
};

export const networkTools: Tool[] = [
  httpRequestTool,
  dnsLookupTool,
  pingTool,
  portCheckTool,
  getWeatherTool,
];
