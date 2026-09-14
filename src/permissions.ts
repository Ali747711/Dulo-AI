// src/permissions.ts
// The gate that runs before a tool that can change something or reach the
// network. A request parks a promise keyed by id and publishes an event; the
// answer arrives out of band (an HTTP reply, or a keypress in the CLI) and
// resolves it. Without this, by the time a tool.call event reached the browser
// the shell command had already run.
//
// Deliberately not a rule language: no wildcards, no globs, no persistence
// across runs. "always" is a Set that lives as long as the run.
import type { PermissionDecision } from "./events.js";

/** Nobody answered. Denying is the only safe default. */
export const PERMISSION_TIMEOUT_MS = 5 * 60_000;

/**
 * Tools gated unless config says otherwise: anything that writes to disk,
 * runs a command, or reaches the network.
 */
export const DEFAULT_GATED_TOOLS = [
  "shell",
  "write_file",
  "edit_file",
  "file_compress",
  "file_extract",
  "http_request",
  "make_dir",
  "move_path",
  "remove_path",
  "scaffold_project",
  "dev_server",
];

export interface PermissionAsk {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface Gate {
  /** Resolves to true when the tool may run. */
  request: (ask: PermissionAsk) => Promise<boolean>;
  /** Answer a pending request. False when the id is unknown or already settled. */
  resolve: (id: string, decision: PermissionDecision) => boolean;
  /** Deny everything still waiting, e.g. when a run is cancelled. */
  abandon: () => void;
  pending: () => PermissionAsk[];
}

export interface GateOptions {
  /** Tool names that need approval. Everything else runs unasked. */
  gated: string[];
  /** Called when a decision is needed; the UI renders from this. */
  onAsk: (ask: PermissionAsk) => void;
  /** Called once a request settles, so the UI can clear the prompt. */
  onSettled: (id: string, tool: string, decision: PermissionDecision) => void;
  timeoutMs?: number;
}

interface Waiting {
  ask: PermissionAsk;
  settle: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
}

/**
 * A gate scoped to one run. `alwaysAllow` accumulates tool names the user has
 * waved through for the rest of that run only.
 */
export const createGate = (options: GateOptions): Gate => {
  const gated = new Set(options.gated);
  const alwaysAllow = new Set<string>();
  const waiting = new Map<string, Waiting>();
  const timeoutMs = options.timeoutMs ?? PERMISSION_TIMEOUT_MS;

  const settle = (id: string, decision: PermissionDecision): boolean => {
    const entry = waiting.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    waiting.delete(id);
    if (decision === "always") alwaysAllow.add(entry.ask.tool);
    entry.settle(decision);
    options.onSettled(id, entry.ask.tool, decision);
    return true;
  };

  return {
    request: (ask) => {
      if (!gated.has(ask.tool) || alwaysAllow.has(ask.tool)) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        // Deliberately not unref'd: while a request is pending the run is
        // blocked on it, and letting the process exit instead would make the
        // run vanish rather than finish as denied.
        const timer = setTimeout(() => settle(ask.id, "timeout"), timeoutMs);
        waiting.set(ask.id, {
          ask,
          settle: (decision) => resolve(decision === "allow" || decision === "always"),
          timer,
        });
        options.onAsk(ask);
      });
    },
    resolve: settle,
    abandon: () => {
      for (const id of [...waiting.keys()]) settle(id, "deny");
    },
    pending: () => [...waiting.values()].map((w) => w.ask),
  };
};
