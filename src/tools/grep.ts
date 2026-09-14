// src/tools/grep.ts
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Tool } from "../types.js";
import { resolveSafe } from "./file.js";
import { WORKSPACE_ROOT } from "../paths.js";

const ROOT = WORKSPACE_ROOT;
const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

const DEFAULT_MAX_MATCHES = 200;
/** Files larger than this are almost never worth scanning line by line. */
const MAX_FILE_BYTES = 2_000_000;
/** Stops a broad search from walking a huge tree forever. */
const MAX_FILES_SCANNED = 5000;
const MAX_LINE_CHARS = 400;

const REGEX_SPECIAL = ".+^${}()|[]\\";

/**
 * Translate a path glob into a regex. A pattern with no slash is matched
 * against the file name alone, so "*.ts" means "any .ts file anywhere", the
 * way it behaves in a shell, not "a .ts file in the root directory".
 */
const globToRegExp = (
  pattern: string,
): { re: RegExp; basenameOnly: boolean } => {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?"; // "**/" spans zero or more directories
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (REGEX_SPECIAL.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return { re: new RegExp(`^${out}$`), basenameOnly: !pattern.includes("/") };
};

const looksBinary = (buffer: Buffer): boolean =>
  buffer.subarray(0, 8000).includes(0);

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory, skip rather than fail the whole search
  }
  for (const entry of entries) {
    if (IGNORED.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export const grepFilesTool: Tool = {
  name: "grep_files",
  description:
    "Search file CONTENTS for a regular expression and return matching lines " +
    "with their file and line number. Use this to find where something is " +
    "defined or used. Use glob instead when you want to match file NAMES.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "JavaScript regular expression to match against each line",
      },
      dir: {
        type: "string",
        description:
          "Directory to search, relative to the project root. Default: '.'",
      },
      include: {
        type: "string",
        description:
          "Only search files whose path matches this glob, for example '*.ts'",
      },
      ignoreCase: {
        type: "boolean",
        description: "Match case-insensitively. Default: false",
        default: false,
      },
      maxResults: {
        type: "number",
        description: `Maximum matching lines to return. Default: ${DEFAULT_MAX_MATCHES}`,
        default: DEFAULT_MAX_MATCHES,
      },
    },
    required: ["pattern"],
  },
  execute: async (
    {
      pattern,
      dir = ".",
      include,
      ignoreCase = false,
      maxResults = DEFAULT_MAX_MATCHES,
    }: {
      pattern: string;
      dir?: string;
      include?: string;
      ignoreCase?: boolean;
      maxResults?: number;
    },
    signal?: AbortSignal,
  ) => {
    if (!pattern || typeof pattern !== "string") {
      throw new Error("pattern is required");
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, ignoreCase ? "i" : "");
    } catch (error) {
      throw new Error(
        `Invalid regular expression: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    let matcher: { re: RegExp; basenameOnly: boolean } | undefined;
    if (include) {
      try {
        matcher = globToRegExp(include);
      } catch {
        throw new Error(`Invalid include pattern "${include}"`);
      }
    }

    const limit = Math.min(Math.max(1, maxResults), 1000);
    const searchRoot = await resolveSafe(dir);

    const byFile = new Map<string, string[]>();
    let total = 0;
    let scanned = 0;
    let truncated = false;

    for await (const file of walk(searchRoot)) {
      if (signal?.aborted) throw new Error("Search cancelled");
      if (scanned >= MAX_FILES_SCANNED) {
        truncated = true;
        break;
      }
      const relative = path.relative(ROOT, file);
      if (
        matcher &&
        !matcher.re.test(matcher.basenameOnly ? path.basename(relative) : relative)
      ) {
        continue;
      }

      try {
        const info = await stat(file);
        if (info.size > MAX_FILE_BYTES) continue;
        const buffer = await readFile(file);
        if (looksBinary(buffer)) continue;
        scanned++;

        const lines = buffer.toString("utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (!regex.test(lines[i])) continue;
          const text = lines[i].trim().slice(0, MAX_LINE_CHARS);
          const bucket = byFile.get(relative) ?? [];
          bucket.push(`  Line ${i + 1}: ${text}`);
          byFile.set(relative, bucket);
          total++;
          if (total >= limit) {
            truncated = true;
            break;
          }
        }
      } catch {
        continue; // unreadable file, skip
      }
      if (total >= limit) break;
    }

    if (total === 0) {
      return `No matches for /${pattern}/${ignoreCase ? "i" : ""} in ${dir}`;
    }

    const header =
      `Found ${total} match${total === 1 ? "" : "es"} in ` +
      `${byFile.size} file${byFile.size === 1 ? "" : "s"}`;
    const body = [...byFile.entries()]
      .map(([file, lines]) => `${file}:\n${lines.join("\n")}`)
      .join("\n\n");
    const note = truncated
      ? `\n\n(truncated at ${limit} matches, narrow the pattern or set include)`
      : "";
    return `${header}\n\n${body}${note}`;
  },
};

export const grepTools: Tool[] = [grepFilesTool];
