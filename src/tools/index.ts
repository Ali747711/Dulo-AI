// src/tools/index.ts
import type { Tool } from "../types.js";
import { fileTools } from "./file.js";
import { editTools } from "./edit.js";
import { grepTools } from "./grep.js";
import { todoTools } from "./todo.js";
import { systemTools } from "./system.js";
import { networkTools } from "./network.js";
import { utilityTools } from "./utility.js";

export * from "./file.js";
export * from "./edit.js";
export * from "./grep.js";
export * from "./todo.js";
export * from "./system.js";
export * from "./network.js";
export * from "./utility.js";

/**
 * Tools compiled into the harness. The full set the agent sees comes from
 * src/registry.ts, which adds src/tools/custom/, MCP servers and skills on top.
 */
export const builtinTools: Tool[] = [
  ...fileTools,
  ...editTools,
  ...grepTools,
  ...todoTools,
  ...systemTools,
  ...networkTools,
  ...utilityTools,
];
