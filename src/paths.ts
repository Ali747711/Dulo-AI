// src/paths.ts
// Every directory the harness needs, resolved once. The harness knows where it
// lives (this file's own location); the process's working directory says
// nothing useful, and a harness started from elsewhere used to load no roles,
// no skills, no config, and rooted its file tools in the wrong place.
//
// Two kinds of paths:
//   - the harness's own resources (roles, skills, custom tools, templates,
//     config, .env) — always under HARNESS_ROOT, the checkout this file is in;
//   - the harness's data (workspace, sessions) — under HARNESS_ROOT by default,
//     each overridable with an env var so a scratch instance can be isolated.
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout this file belongs to: src/paths.ts → one level up. */
export const HARNESS_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const fromEnv = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value && value.trim() ? path.resolve(value) : fallback;
};

/** Where the agent's own files live: generated projects and `.dulo/` briefs. */
export const WORKSPACE_ROOT = fromEnv(
  "DULO_WORKSPACE_DIR",
  path.join(HARNESS_ROOT, "workspace"),
);

/** Session data. A second harness MUST set DULO_SESSIONS_DIR (see context.md §5). */
export const SESSIONS_DIR = fromEnv("DULO_SESSIONS_DIR", path.join(HARNESS_ROOT, "sessions"));

/** `dulo.config.json`, or the file DULO_CONFIG points at. */
export const CONFIG_FILE = fromEnv("DULO_CONFIG", path.join(HARNESS_ROOT, "dulo.config.json"));

/** Loaded by dotenv at startup, so a harness started elsewhere still finds its key. */
export const ENV_FILE = path.join(HARNESS_ROOT, ".env");

export const AGENTS_DIR = path.join(HARNESS_ROOT, "src", "agents");
export const SKILLS_DIR = path.join(HARNESS_ROOT, "src", "skills");
export const CUSTOM_TOOLS_DIR = path.join(HARNESS_ROOT, "src", "tools", "custom");
export const TEMPLATES_DIR = path.join(HARNESS_ROOT, "templates");
