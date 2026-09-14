// src/tools/file.ts
import { readdir, readFile, writeFile, mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { glob } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip, createGunzip, createDeflate, createInflate } from "node:zlib";
import { pipeline } from "node:stream/promises";
import type { Tool } from "../types.js";
import { WORKSPACE_ROOT } from "../paths.js";

// Every file tool is confined to the workspace, never to Dulo's own checkout.
const ROOT = WORKSPACE_ROOT;
const IGNORED = new Set(["node_modules", ".git", "dist", "build"]);

/** Caps on read_file, so one oversized log cannot flood the context window. */
const MAX_READ_BYTES = 200_000;
const MAX_READ_LINES = 2000;

/**
 * Resolve a user-supplied path safely.
 * Checks path boundaries and traverses real paths to prevent symlink bypasses.
 */
export const resolveSafe = async (relativePath: string): Promise<string> => {
  const resolved = path.resolve(ROOT, relativePath);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    throw new Error(`Path "${relativePath}" is outside the workspace`);
  }

  // Follow symlinks on existing target or nearest existing ancestor directory
  try {
    let checkPath = resolved;
    while (!existsSync(checkPath)) {
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }
    const real = await realpath(checkPath);
    const realRoot = await realpath(ROOT);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new Error(`Path "${relativePath}" resolves outside the workspace via symlink`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("outside the workspace")) {
      throw error;
    }
  }

  return resolved;
};

/** Re-throw as a plain Error; the agent formats it for the model. */
const rethrow = (error: unknown): never => {
  throw error instanceof Error ? error : new Error(String(error));
};

export const listFilesTool: Tool = {
  name: "list_files",
  description: "List files and folders inside a directory of the project. Use '.' for the root.",
  parameters: {
    type: "object",
    properties: {
      dir: {
        type: "string",
        description: "Directory path relative to the workspace root",
      },
    },
    required: ["dir"],
  },
  execute: async ({ dir }: { dir: string }) => {
    try {
      const safeDir = await resolveSafe(dir);
      const entries = await readdir(safeDir, { withFileTypes: true });
      const lines = entries
        .filter((entry) => !IGNORED.has(entry.name))
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
      return lines.length > 0 ? lines.join("\n") : "(empty directory)";
    } catch (error) {
      return rethrow(error);
    }
  },
};

export const readFileTool: Tool = {
  name: "read_file",
  description:
    `Read the text content of a file in the project. Output is capped at ` +
    `${MAX_READ_LINES} lines; use grep_files to find what you need in a larger file.`,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the workspace root",
      },
      offset: {
        type: "number",
        description: "1-based line to start from. Default: 1",
        default: 1,
      },
    },
    required: ["path"],
  },
  execute: async ({
    path: filePath,
    offset = 1,
  }: {
    path: string;
    offset?: number;
  }) => {
    try {
      const safePath = await resolveSafe(filePath);
      const info = await stat(safePath);
      if (info.isDirectory()) {
        throw new Error(`"${filePath}" is a directory, use list_files instead`);
      }

      const buffer = await readFile(safePath);
      // A NUL byte early in the file means this is not text; decoding it would
      // hand the model a page of mojibake that looks like real content.
      if (buffer.subarray(0, 8000).includes(0)) {
        throw new Error(
          `"${filePath}" looks like a binary file (${info.size} bytes), not text`,
        );
      }

      const lines = buffer.toString("utf8").split("\n");
      const start = Math.max(1, Math.floor(offset)) - 1;
      if (start >= lines.length && lines.length > 0) {
        throw new Error(
          `offset ${offset} is past the end of ${filePath} (${lines.length} lines)`,
        );
      }

      let text = lines.slice(start, start + MAX_READ_LINES).join("\n");
      let clipped = start + MAX_READ_LINES < lines.length;
      if (text.length > MAX_READ_BYTES) {
        text = text.slice(0, MAX_READ_BYTES);
        clipped = true;
      }
      if (!clipped && start === 0) return text;

      const shown = `${start + 1}-${Math.min(start + MAX_READ_LINES, lines.length)}`;
      return (
        `${text}\n\n[showing lines ${shown} of ${lines.length}. ` +
        `Read again with a larger offset, or use grep_files to jump to what you need.]`
      );
    } catch (error) {
      return rethrow(error);
    }
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Create or overwrite a file in the project with the given text content. Parent folders are created automatically.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the workspace root",
      },
      content: { type: "string", description: "Full text content to write" },
    },
    required: ["path", "content"],
  },
  execute: async ({ path: filePath, content }: { path: string; content: string }) => {
    try {
      const target = await resolveSafe(filePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return `Wrote ${content.length} characters to ${filePath}`;
    } catch (error) {
      return rethrow(error);
    }
  },
};

export const globTool: Tool = {
  name: "glob",
  description:
    "Find files matching a glob pattern (e.g., '**/*.ts', 'src/**/*.test.ts', '*.json'). " +
    "Returns a list of matching file paths relative to the workspace root. " +
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
    try {
      const safeCwd = await resolveSafe(cwd);
      const defaultIgnore = ["node_modules", "node_modules/**", ".git", ".git/**", "dist", "dist/**", "build", "build/**", "*.log"];
      const allIgnore: string[] = [...defaultIgnore, ...ignore];

      const rootWithSep = ROOT + path.sep;
      const matches: string[] = [];
      for await (const entry of glob(pattern, {
        cwd: safeCwd,
        withFileTypes: true,
        exclude: allIgnore,
      })) {
        if (!entry.isFile()) continue;
        const matchPath = path.join(entry.parentPath, entry.name);
        // A pattern containing "../" can walk the match outside the project
        // root even though safeCwd itself is validated — skip those.
        if (matchPath !== ROOT && !matchPath.startsWith(rootWithSep)) continue;
        matches.push(matchPath);
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
    } catch (error) {
      return rethrow(error);
    }
  },
};

export const fileCompressTool: Tool = {
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
    try {
      const resolvedInput = await resolveSafe(inputPath);
      const resolvedOutput = await resolveSafe(outputPath);

      await mkdir(path.dirname(resolvedOutput), { recursive: true });
      const inputStream = createReadStream(resolvedInput);
      const outputStream = createWriteStream(resolvedOutput);
      const compressor = algorithm === "gzip" ? createGzip({ level: 9 }) : createDeflate({ level: 9 });

      await pipeline(inputStream, compressor, outputStream);
      const stats = await stat(resolvedOutput);
      return `Compressed ${inputPath} -> ${outputPath} (${stats.size} bytes, ${algorithm})`;
    } catch (error) {
      return rethrow(error);
    }
  },
};

export const fileExtractTool: Tool = {
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
    try {
      const resolvedInput = await resolveSafe(inputPath);
      const resolvedOutput = await resolveSafe(outputPath);

      await mkdir(path.dirname(resolvedOutput), { recursive: true });
      const inputStream = createReadStream(resolvedInput);
      const outputStream = createWriteStream(resolvedOutput);
      const decompressor = algorithm === "gzip" ? createGunzip() : createInflate();

      await pipeline(inputStream, decompressor, outputStream);
      const stats = await stat(resolvedOutput);
      return `Extracted ${inputPath} -> ${outputPath} (${stats.size} bytes, ${algorithm})`;
    } catch (error) {
      return rethrow(error);
    }
  },
};

export const makeDirTool: Tool = {
  name: "make_dir",
  description: "Create a folder, and any missing parent folders, inside the workspace.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Folder path relative to the workspace root" },
    },
    required: ["path"],
  },
  execute: async ({ path: dirPath }: { path: string }) => {
    try {
      const target = await resolveSafe(dirPath);
      await mkdir(target, { recursive: true });
      return `Created folder ${dirPath}`;
    } catch (error) {
      return rethrow(error);
    }
  },
};

export const movePathTool: Tool = {
  name: "move_path",
  description:
    "Move or rename a file or folder inside the workspace. Missing parent folders of the destination are created.",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "Current path, relative to the workspace root" },
      to: { type: "string", description: "New path, relative to the workspace root" },
    },
    required: ["from", "to"],
  },
  execute: async ({ from, to }: { from: string; to: string }) => {
    try {
      const source = await resolveSafe(from);
      const target = await resolveSafe(to);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(source, target);
      return `Moved ${from} to ${to}`;
    } catch (error) {
      return rethrow(error);
    }
  },
};

export const removePathTool: Tool = {
  name: "remove_path",
  description:
    "Delete a file, or a folder and its contents with recursive: true, inside the workspace. The workspace root itself is never removed.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace root" },
      recursive: {
        type: "boolean",
        description: "Required to delete a folder together with everything in it",
      },
    },
    required: ["path"],
  },
  execute: async ({ path: target, recursive = false }: { path: string; recursive?: boolean }) => {
    try {
      const resolved = await resolveSafe(target || ".");
      const [realTarget, realRoot] = await Promise.all([
        realpath(resolved).catch(() => resolved),
        realpath(ROOT),
      ]);
      if (resolved === ROOT || realTarget === realRoot) {
        throw new Error("Refusing to remove the workspace root");
      }
      const info = await stat(resolved);
      if (info.isDirectory() && !recursive) {
        throw new Error(
          `"${target}" is a folder; pass recursive: true to delete it and everything in it`,
        );
      }
      await rm(resolved, { recursive, force: false });
      return `Removed ${target}`;
    } catch (error) {
      return rethrow(error);
    }
  },
};

export const fileTools: Tool[] = [
  listFilesTool,
  readFileTool,
  writeFileTool,
  globTool,
  fileCompressTool,
  fileExtractTool,
  makeDirTool,
  movePathTool,
  removePathTool,
];
