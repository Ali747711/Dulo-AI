// src/fileTools.ts
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { Tool } from "./types.js";

// All file tools are sandboxed to the project root (where you run `npm start`)
const ROOT = process.cwd();
const IGNORED = new Set(["node_modules", ".git", "dist"]);

// Resolve a user-supplied path and refuse anything that escapes ROOT
const resolveSafe = (relativePath: string): string => {
  const resolved = path.resolve(ROOT, relativePath);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    throw new Error(`Path "${relativePath}" is outside the project root`);
  }
  return resolved;
};

// Tools return error text instead of throwing so the model can recover
const toErrorText = (error: unknown): string =>
  `Error: ${error instanceof Error ? error.message : String(error)}`;

export const fileTools: Tool[] = [
  {
    name: "list_files",
    description:
      "List files and folders inside a directory of the project. Use '.' for the root.",
    parameters: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description: "Directory path relative to the project root",
        },
      },
      required: ["dir"],
    },
    execute: async ({ dir }: { dir: string }) => {
      try {
        const entries = await readdir(resolveSafe(dir), { withFileTypes: true });
        const lines = entries
          .filter((entry) => !IGNORED.has(entry.name))
          .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
        return lines.length > 0 ? lines.join("\n") : "(empty directory)";
      } catch (error) {
        return toErrorText(error);
      }
    },
  },
  {
    name: "read_file",
    description: "Read the full text content of a file in the project.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the project root",
        },
      },
      required: ["path"],
    },
    execute: async ({ path: filePath }: { path: string }) => {
      try {
        return await readFile(resolveSafe(filePath), "utf8");
      } catch (error) {
        return toErrorText(error);
      }
    },
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a file in the project with the given text content. Parent folders are created automatically.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the project root",
        },
        content: { type: "string", description: "Full text content to write" },
      },
      required: ["path", "content"],
    },
    execute: async ({ path: filePath, content }: { path: string; content: string }) => {
      try {
        const target = resolveSafe(filePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
        return `Wrote ${content.length} characters to ${filePath}`;
      } catch (error) {
        return toErrorText(error);
      }
    },
  },
];
