// src/tools/custom.ts
// Drop a .ts file in src/tools/custom/ that default-exports a Tool (or an array
// of them) and it is registered at startup. No build step, no registration list:
// tsx already runs TypeScript at runtime. This is the whole of Dulo's plugin
// system, and the Tool type was already as simple as it needed to be — the gap
// was only discovery.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Tool } from "../types.js";

export const CUSTOM_TOOLS_DIR = "src/tools/custom";

const LOADABLE = /\.(ts|mts|js|mjs)$/;

const isTool = (value: unknown): value is Tool => {
  const t = value as Partial<Tool> | null;
  return (
    Boolean(t) &&
    typeof t?.name === "string" &&
    t.name.length > 0 &&
    typeof t.description === "string" &&
    typeof t.execute === "function" &&
    Boolean(t.parameters) &&
    typeof t.parameters === "object"
  );
};

/**
 * Load every tool module in src/tools/custom/. One bad file is skipped with a
 * warning rather than stopping the harness: a broken plugin should not make
 * the whole agent unavailable.
 */
export const loadCustomTools = async (): Promise<Tool[]> => {
  const dir = path.join(process.cwd(), CUSTOM_TOOLS_DIR);
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter(
      (f) => LOADABLE.test(f) && !f.endsWith(".d.ts"),
    );
  } catch {
    return []; // the folder is optional
  }

  const loaded: Tool[] = [];
  for (const entry of entries.sort()) {
    const file = path.join(dir, entry);
    try {
      const module: unknown = await import(pathToFileURL(file).href);
      const exported = (module as { default?: unknown }).default;
      const candidates = Array.isArray(exported) ? exported : [exported];
      const tools = candidates.filter(isTool);

      if (tools.length === 0) {
        console.warn(
          `[dulo] ${CUSTOM_TOOLS_DIR}/${entry}: default export is not a Tool ` +
            `({ name, description, parameters, execute }) or an array of them`,
        );
        continue;
      }
      loaded.push(...tools);
    } catch (error) {
      console.warn(
        `[dulo] could not load ${CUSTOM_TOOLS_DIR}/${entry}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return loaded;
};
