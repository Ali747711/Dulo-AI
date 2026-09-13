// Any .ts file in this folder that default-exports a Tool is registered at
// startup. Export an array to add several. Delete this file if you do not
// want it — nothing else references it.
import type { Tool } from "../../src/types.js";

const wordCount: Tool = {
  name: "word_count",
  description: "Count words, lines and characters in a piece of text.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to measure" },
    },
    required: ["text"],
  },
  execute: async ({ text }: { text: string }) => {
    if (typeof text !== "string") throw new Error("text must be a string");
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return `${words} words, ${text.split("\n").length} lines, ${text.length} characters`;
  },
};

export default wordCount;
