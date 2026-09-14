// src/permissions.ts
// The gate that runs before a tool acts. A request parks a promise keyed by id
// and publishes an event; the answer arrives out of band (an HTTP reply, or a
// keypress in the CLI) and resolves it. Without this, by the time a tool.call
// event reached the browser the shell command had already run.
//
// What to ask about is not this file's business: `classify` (src/risk.ts) looks
// at the tool AND its arguments and answers allowed / ask / confirm. This file
// only turns that into a question, or into silence.
//
// Deliberately not a rule language: no wildcards, no globs, no persistence
// across turns. "always" is a Set that lives as long as the turn — and it never
// applies to `confirm`, because a blanket yes is exactly what that tier exists
// to prevent.
import type { PermissionDecision } from "./events.js";
import type { RiskAssessment } from "./risk.js";

/** Nobody answered. Denying is the only safe default. */
export const PERMISSION_TIMEOUT_MS = 5 * 60_000;

/**
 * The names gated under the older flat policy (`approval.mode: "ask"`), kept so
 * that mode still behaves exactly as it did. `mode: "tiers"` ignores this and
 * asks src/risk.ts instead.
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

/** A parked request, with the plain-language reasons the prompt needs. */
export interface PendingAsk extends PermissionAsk, RiskAssessment {}

export interface Gate {
  /** Resolves to true when the tool may run. */
  request: (ask: PermissionAsk) => Promise<boolean>;
  /** Answer a pending request. False when the id is unknown or already settled. */
  resolve: (id: string, decision: PermissionDecision) => boolean;
  /** Deny everything still waiting, e.g. when a run is cancelled. */
  abandon: () => void;
  pending: () => PendingAsk[];
}

export interface GateOptions {
  /** What a call would do. Throwing is treated as "unknown", i.e. confirm. */
  classify: (tool: string, args: Record<string, unknown>) => RiskAssessment;
  /** Called when a decision is needed; the UI renders from this. */
  onAsk: (ask: PendingAsk) => void;
  /** Called when a call ran without asking, so the log stays complete. */
  onAuto?: (ask: PendingAsk) => void;
  /** Called once a request settles, so the UI can clear the prompt. */
  onSettled: (id: string, tool: string, decision: PermissionDecision) => void;
  timeoutMs?: number;
}

interface Waiting {
  ask: PendingAsk;
  settle: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
}

/** Used when the classifier itself fails: never a silent yes. */
const UNREADABLE: RiskAssessment = {
  tier: "confirm",
  what: "Dulo wants to do something the safety check could not read",
  where: "unknown",
  undo: "Unknown. Look at the technical details before allowing it.",
};

/**
 * A gate scoped to one turn. `alwaysAllow` accumulates tool names the user has
 * waved through for the rest of that turn only, and only for `ask`.
 */
export const createGate = (options: GateOptions): Gate => {
  const alwaysAllow = new Set<string>();
  const waiting = new Map<string, Waiting>();
  const timeoutMs = options.timeoutMs ?? PERMISSION_TIMEOUT_MS;

  const assess = (ask: PermissionAsk): RiskAssessment => {
    try {
      return options.classify(ask.tool, ask.args);
    } catch {
      return UNREADABLE;
    }
  };

  const settle = (id: string, decision: PermissionDecision): boolean => {
    const entry = waiting.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    waiting.delete(id);
    // "always" is a shortcut for the rest of the turn, and a shortcut is
    // precisely what a confirm must not have.
    if (decision === "always" && entry.ask.tier === "ask") alwaysAllow.add(entry.ask.tool);
    entry.settle(decision);
    options.onSettled(id, entry.ask.tool, decision);
    return true;
  };

  return {
    request: (ask) => {
      const risk = assess(ask);
      const pending: PendingAsk = { ...ask, ...risk };

      if (risk.tier === "allowed" || (risk.tier === "ask" && alwaysAllow.has(ask.tool))) {
        options.onAuto?.(pending);
        return Promise.resolve(true);
      }

      return new Promise<boolean>((resolve) => {
        // Deliberately not unref'd: while a request is pending the run is
        // blocked on it, and letting the process exit instead would make the
        // run vanish rather than finish as denied.
        const timer = setTimeout(() => settle(ask.id, "timeout"), timeoutMs);
        waiting.set(ask.id, {
          ask: pending,
          settle: (decision) => resolve(decision === "allow" || decision === "always"),
          timer,
        });
        options.onAsk(pending);
      });
    },
    resolve: settle,
    abandon: () => {
      for (const id of [...waiting.keys()]) settle(id, "deny");
    },
    pending: () => [...waiting.values()].map((w) => w.ask),
  };
};

/**
 * The classifier for `approval.mode: "ask"` and `"auto"`: name-based, exactly
 * as the gate behaved before tiers existed.
 */
export const flatClassifier =
  (gated: string[]) =>
  (tool: string): RiskAssessment =>
    gated.includes(tool)
      ? {
          tier: "ask",
          what: `Dulo wants to run "${tool}"`,
          where: tool,
          undo: "Check the technical details before allowing it.",
        }
      : {
          tier: "allowed",
          what: `Dulo wants to run "${tool}"`,
          where: tool,
          undo: "",
        };
