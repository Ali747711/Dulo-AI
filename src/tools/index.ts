// src/tools/index.ts
import type { Tool } from "../types.js";
import { fileTools } from "./file.js";
import { systemTools } from "./system.js";
import { networkTools } from "./network.js";
import { utilityTools } from "./utility.js";

export * from "./file.js";
export * from "./system.js";
export * from "./network.js";
export * from "./utility.js";

export const tools: Tool[] = [
  ...fileTools,
  ...systemTools,
  ...networkTools,
  ...utilityTools,
];
