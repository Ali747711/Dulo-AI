// src/tools/edit.ts
import { readFile, writeFile } from "node:fs/promises";

import type { Tool } from "../types.js";
import { resolveSafe } from "./file.js";

const countOccurrences = (haystack: string, needle: string): number => {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
};

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Replace an exact snippet of text inside an existing file. " +
    "Prefer this over write_file for changing part of a file: it does not " +
    "rewrite the parts you are not touching. oldString must match the file " +
    "byte for byte, including indentation, and must be unique unless " +
    "replaceAll is true.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the project root",
      },
      oldString: {
        type: "string",
        description:
          "Exact text to replace. Include enough surrounding lines to make it unique.",
      },
      newString: {
        type: "string",
        description: "Text to put in its place. Use an empty string to delete.",
      },
      replaceAll: {
        type: "boolean",
        description:
          "Replace every occurrence instead of requiring exactly one. Default: false",
        default: false,
      },
    },
    required: ["path", "oldString", "newString"],
  },
  execute: async ({
    path: filePath,
    oldString,
    newString,
    replaceAll = false,
  }: {
    path: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
  }) => {
    if (typeof oldString !== "string" || oldString.length === 0) {
      throw new Error("oldString is required and cannot be empty");
    }
    if (typeof newString !== "string") {
      throw new Error("newString is required (use an empty string to delete)");
    }
    if (oldString === newString) {
      throw new Error("oldString and newString are identical, nothing to change");
    }

    const target = await resolveSafe(filePath);
    const content = await readFile(target, "utf8");
    const count = countOccurrences(content, oldString);

    // Reject ambiguity rather than guessing which occurrence was meant. The
    // wording matters: it is what the model reads to correct itself.
    if (count === 0) {
      throw new Error(
        `oldString was not found in ${filePath}. It must match the file exactly, ` +
          `including whitespace and indentation. Read the file first and copy the text verbatim.`,
      );
    }
    if (count > 1 && !replaceAll) {
      throw new Error(
        `oldString appears ${count} times in ${filePath}. Add surrounding lines to make ` +
          `it unique, or pass replaceAll: true to change every occurrence.`,
      );
    }

    // split/join and manual splicing, never String.replace: "$&" and friends in
    // newString would otherwise be treated as replacement patterns.
    let updated: string;
    if (replaceAll) {
      updated = content.split(oldString).join(newString);
    } else {
      const at = content.indexOf(oldString);
      updated = content.slice(0, at) + newString + content.slice(at + oldString.length);
    }

    await writeFile(target, updated, "utf8");
    const where = count === 1 ? "1 occurrence" : `${count} occurrences`;
    return `Replaced ${where} in ${filePath} (${content.length} -> ${updated.length} characters)`;
  },
};

export const editTools: Tool[] = [editFileTool];
