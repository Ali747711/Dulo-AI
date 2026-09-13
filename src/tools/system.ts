// src/tools/system.ts
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "../types.js";
import { resolveSafe } from "./file.js";

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

/**
 * Tokenize a command line string into binary and arguments respecting quotes.
 */
export function parseCommandLine(cmdStr: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < cmdStr.length; i++) {
    const char = cmdStr[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export const shellTool: Tool = {
  name: "shell",
  description:
    "Execute a command with safety limits (timeout, output size, allowed commands). " +
    "Only a predefined set of safe commands are allowed. The command is NOT run through a shell, " +
    "so pipes, redirects, globs, and && chaining do not work. Arguments can be passed via the command string or as an array.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute (e.g., 'ls -la', 'npm test', 'git status')",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Optional explicit argument list if preferred over quoting in the command string",
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
  execute: async (
    {
      command,
      args: explicitArgs,
      cwd = ".",
      timeout = SHELL_TIMEOUT_MS,
    }: {
      command: string;
      args?: string[];
      cwd?: string;
      timeout?: number;
    },
    signal?: AbortSignal,
  ) => {
    if (!command || typeof command !== "string") {
      throw new Error("command string is required");
    }

    const parsedTokens = parseCommandLine(command.trim());
    if (parsedTokens.length === 0) {
      throw new Error("empty command");
    }

    const baseCmd = parsedTokens[0].toLowerCase();
    const baseCmdName = baseCmd.split("/").pop() || baseCmd;

    if (!ALLOWED_COMMANDS.has(baseCmdName)) {
      throw new Error(
        `Command "${baseCmdName}" is not in the allowed list. Allowed: ${Array.from(ALLOWED_COMMANDS).join(", ")}`,
      );
    }

    const finalArgs: string[] = Array.isArray(explicitArgs) && explicitArgs.length > 0
      ? explicitArgs
      : parsedTokens.slice(1);

    const blocked = finalArgs.find((a) => BLOCKED_FLAGS.has(a));
    if (blocked) {
      throw new Error(`Flag "${blocked}" is not allowed (inline code execution)`);
    }

    if (timeout > SHELL_TIMEOUT_MS) {
      throw new Error(`Timeout cannot exceed ${SHELL_TIMEOUT_MS}ms`);
    }

    let resolvedCwd: string;
    try {
      resolvedCwd = await resolveSafe(cwd);
    } catch (err: any) {
      throw new Error(
        `Working directory "${cwd}" is invalid or outside the project root`,
      );
    }

    try {
      const { stdout, stderr } = await execFileAsync(baseCmdName, finalArgs, {
        cwd: resolvedCwd,
        timeout,
        maxBuffer: SHELL_MAX_OUTPUT,
        shell: false,
        // Cancelling the run kills the child instead of letting it run out its
        // timeout after the client has already been told the run stopped.
        signal,
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
      if (signal?.aborted) {
        throw new Error("Command cancelled");
      }
      if (error.killed && error.signal === "SIGTERM") {
        throw new Error(`Command timed out after ${timeout}ms`);
      }
      if (error.message?.includes("maxBuffer")) {
        throw new Error(`Output exceeded ${SHELL_MAX_OUTPUT} bytes limit`);
      }

      // execFile rejects on any non-zero exit, but still attaches the output.
      // Compilers, test runners and git report what went wrong on stdout/stderr,
      // so returning only error.message tells the model it failed but not why.
      const out = [error.stdout, error.stderr && `stderr: ${error.stderr}`]
        .filter(Boolean)
        .join("\n")
        .trim();
      if (out) {
        const code = error.code ?? "unknown";
        return `Command exited with code ${code}:\n${out}`.slice(
          0,
          SHELL_MAX_OUTPUT,
        );
      }
      throw new Error(error.message || String(error));
    }
  },
};

export const getSystemInfoTool: Tool = {
  name: "get_system_info",
  description: "Get basic system information (OS, Node version, etc.)",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    return JSON.stringify(
      {
        platform: os.platform(),
        arch: os.arch(),
        totalmem: os.totalmem(),
        freemem: os.freemem(),
        cpus: os.cpus().length,
        nodeVersion: process.version,
        uptime: os.uptime(),
      },
      null,
      2
    );
  },
};

export const getEnvTool: Tool = {
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
      .filter(([key]) => !sensitiveKeys.some((s) => key.toUpperCase().includes(s)))
      .reduce<Record<string, string>>(
        (acc, [key, value]) => ({ ...acc, [key]: value ?? "" }),
        {}
      );
    return JSON.stringify(env, null, 2);
  },
};

export const systemTools: Tool[] = [
  shellTool,
  getSystemInfoTool,
  getEnvTool,
];
