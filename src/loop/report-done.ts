// src/loop/report-done.ts
// The gate a build has to pass before it may call itself done.
//
// Loop Engineering's rule is that a model's impression of its own work proves
// nothing: a checklist item passes only on evidence it quoted from a tool it
// ran. This is where that stops being a request in a prompt and becomes
// something the harness enforces — an empty evidence field is a rejection, and
// a second pair of eyes with fresh context has to agree before "accepted".
//
// Built per turn, not per process: the reviewer runs inside the caller's turn,
// so it needs that turn's abort signal and permission function.
import { z } from "zod";

import { applyToolPolicy, type AgentProfile } from "../agents.js";
import type { RunOptions } from "../agent.js";
import { getAgent, getRegistry } from "../registry.js";
import type { Message, Tool } from "../types.js";

/** Checklist ids the frontend definition of done defines. */
export const DOD_IDS = ["DOD-1", "DOD-2", "DOD-3", "DOD-4", "DOD-5", "DOD-6"] as const;

const ChecklistItem = z.object({
  id: z.string().min(1),
  status: z.enum(["pass", "fail"]),
  evidence: z.string(),
});

const DoneClaim = z.object({
  projectPath: z.string().min(1),
  runCommand: z.string().min(1),
  summary: z.string().min(1),
  checklist: z.array(ChecklistItem).min(1),
});

const Finding = z.object({
  id: z.string().min(1),
  severity: z.enum(["must-fix", "should-fix"]),
  what: z.string().min(1),
  where: z.string().default(""),
  fix: z.string().default(""),
});

const Verdict = z.object({
  verdict: z.enum(["pass", "fail"]),
  findings: z.array(Finding).default([]),
});

export type ReviewVerdict = z.infer<typeof Verdict>;

export interface LoopConfig {
  maxIterations: number;
  independentReview: boolean;
  reviewer: string;
}

export interface LoopToolDeps {
  loop: LoopConfig;
  /** The turn's cancellation signal, so a cancelled turn cancels its review. */
  signal?: AbortSignal;
  /** The turn's permission function: the reviewer's tools are gated like any other. */
  requestPermission?: RunOptions["requestPermission"];
  /** Injected so tests can drive the reviewer without a real model. */
  runTurn: (history: Message[], options: RunOptions) => Promise<{ status: string; error?: string }>;
  /** Where the reviewer profile comes from. Defaults to the live registry. */
  getProfile?: (name: string) => AgentProfile | undefined;
  /** The tool set the reviewer picks from. Defaults to the live registry. */
  availableTools?: () => Tool[];
  /** The skills catalogue appended to the reviewer's prompt. Defaults to the registry's. */
  skillsPrompt?: () => string;
}

const checklistProblems = (claim: z.infer<typeof DoneClaim>): string[] => {
  const problems: string[] = [];
  const seen = new Map(claim.checklist.map((item) => [item.id, item]));
  for (const id of DOD_IDS) {
    const item = seen.get(id);
    if (!item) {
      problems.push(`${id}: missing from the checklist`);
      continue;
    }
    if (item.status !== "pass") problems.push(`${id}: status is "${item.status}", not "pass"`);
    else if (!item.evidence.trim()) problems.push(`${id}: no evidence quoted`);
  }
  return problems;
};

const describeFindings = (verdict: ReviewVerdict): string =>
  verdict.findings
    .map((f) => `${f.id} (${f.severity}): ${f.what}${f.where ? ` [${f.where}]` : ""}${f.fix ? ` → ${f.fix}` : ""}`)
    .join("\n") || "no specific findings given";

const reviewRequest = (claim: z.infer<typeof DoneClaim>, brief: string): string =>
  [
    `Review this finished build against the definition of done. Load the skill`,
    `"frontend-definition-of-done" first, then check the project yourself.`,
    ``,
    `Project folder: ${claim.projectPath}`,
    `Run command: ${claim.runCommand}`,
    ``,
    `What the builder says it did:`,
    claim.summary,
    ``,
    `The builder's checklist and evidence:`,
    ...claim.checklist.map((i) => `- ${i.id}: ${i.status} — ${i.evidence}`),
    ``,
    brief,
    ``,
    `Judge only these ids: ${DOD_IDS.join(", ")}. Verify the claims against the real`,
    `project and the running page rather than trusting them. When you are done,`,
    `call review_verdict exactly once.`,
  ].join("\n");

/**
 * Build the per-turn loop tools. `report_done` is the gate; `review_verdict` is
 * how the nested reviewer answers, and is only ever reachable inside that
 * nested run.
 */
export const createLoopTools = (deps: LoopToolDeps): Tool[] => {
  const { loop } = deps;
  let rejections = 0;

  const reviewVerdictTool = (capture: (verdict: ReviewVerdict) => void): Tool => ({
    name: "review_verdict",
    description:
      "Record your review verdict. Call this exactly once, at the end of your review. " +
      "Pass only when every hard check in the definition of done passed with evidence you verified.",
    parameters: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["pass", "fail"], description: "Your overall judgment" },
        findings: {
          type: "array",
          description: "What is wrong, one entry per checklist id. Empty when everything passed.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: `One of ${DOD_IDS.join(", ")}` },
              severity: { type: "string", enum: ["must-fix", "should-fix"] },
              what: { type: "string", description: "The problem, in one sentence" },
              where: { type: "string", description: "File, line, or the part of the page" },
              fix: { type: "string", description: "The concrete change that resolves it" },
            },
            required: ["id", "severity", "what"],
          },
        },
      },
      required: ["verdict"],
    },
    execute: async (args: unknown) => {
      const parsed = Verdict.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `The verdict is not in the expected shape: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
        );
      }
      capture(parsed.data);
      return `Verdict recorded: ${parsed.data.verdict}.`;
    },
  });

  const getProfile = deps.getProfile ?? getAgent;
  const availableTools = deps.availableTools ?? (() => getRegistry().tools);
  const skillsPrompt = deps.skillsPrompt ?? (() => getRegistry().skillsPrompt);

  const runReview = async (
    claim: z.infer<typeof DoneClaim>,
    brief: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const profile = getProfile(loop.reviewer);
    if (!profile) {
      return {
        ok: false,
        reason: `the reviewer role "${loop.reviewer}" is not installed, so the work could not be reviewed`,
      };
    }

    let verdict: ReviewVerdict | undefined;
    const tools = [...availableTools(), reviewVerdictTool((v) => (verdict = v))];

    let result: { status: string; error?: string };
    try {
      // runTurn takes an already-built history: the system message is the
      // caller's job. Without this the reviewer would run with no role at all.
      const history: Message[] = [
        { role: "system", content: profile.prompt + skillsPrompt() },
        { role: "user", content: reviewRequest(claim, brief) },
      ];
      result = await deps.runTurn(history, {
        agent: loop.reviewer,
        tools: applyToolPolicy(tools, profile.tools),
        signal: deps.signal,
        requestPermission: deps.requestPermission,
      });
    } catch (error) {
      return {
        ok: false,
        reason: `the review could not run: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (result.status === "cancelled") return { ok: false, reason: "the review was cancelled" };
    if (!verdict) {
      return {
        ok: false,
        reason:
          result.status === "failed"
            ? `the review failed before reaching a verdict: ${result.error ?? "unknown error"}`
            : "the reviewer finished without giving a verdict",
      };
    }
    if (verdict.verdict === "fail") {
      return { ok: false, reason: `the reviewer found problems:\n${describeFindings(verdict)}` };
    }
    return { ok: true };
  };

  const reportDoneTool: Tool = {
    name: "report_done",
    description:
      "Claim the work is finished. Send the filled definition-of-done checklist with the " +
      "evidence you quoted for every item. The claim is checked, and an independent reviewer " +
      "looks at the project, before it is accepted. A rejection tells you what to fix; treat " +
      "it as a failed review and improve.",
    parameters: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "The project folder, relative to the workspace root",
        },
        runCommand: {
          type: "string",
          description: "The command the person runs to see the page, e.g. npm run dev",
        },
        summary: { type: "string", description: "One paragraph, in plain language, for the user" },
        checklist: {
          type: "array",
          description: `One entry per definition-of-done item: ${DOD_IDS.join(", ")}`,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: `One of ${DOD_IDS.join(", ")}` },
              status: { type: "string", enum: ["pass", "fail"] },
              evidence: {
                type: "string",
                description: "The command or browser output you quoted when you checked it",
              },
            },
            required: ["id", "status", "evidence"],
          },
        },
        brief: {
          type: "string",
          description: "Optional: the brief's key points, so the reviewer judges against it",
        },
      },
      required: ["projectPath", "runCommand", "summary", "checklist"],
    },
    execute: async (args: unknown) => {
      const parsed = DoneClaim.safeParse(args);
      if (!parsed.success) {
        rejections += 1;
        throw new Error(
          `Rejected: the claim is not in the expected shape — ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
        );
      }
      const claim = parsed.data;
      const brief = typeof (args as { brief?: unknown }).brief === "string"
        ? `The brief:\n${(args as { brief: string }).brief}`
        : "";

      if (rejections >= loop.maxIterations) {
        return (
          `Cap reached (${rejections}/${loop.maxIterations}). Stop here and report honestly that ` +
          `the work is not finished: list the items that still fail, what the evidence showed, and ` +
          `what the next attempt would try. Do not call this tool again in this turn.`
        );
      }

      const problems = checklistProblems(claim);
      if (problems.length > 0) {
        rejections += 1;
        throw new Error(
          `Rejected (${rejections}/${loop.maxIterations}): the checklist does not show the work is ` +
            `done.\n${problems.join("\n")}\nFix these, re-run the checks, and claim again.`,
        );
      }

      if (!loop.independentReview) {
        return `Accepted. Every checklist item passed with evidence. Write the pass report now.`;
      }

      const review = await runReview(claim, brief);
      if (!review.ok) {
        rejections += 1;
        throw new Error(
          `Rejected by review (${rejections}/${loop.maxIterations}): ${review.reason}\n` +
            `Fix what the reviewer found, re-run the checks, and claim again.`,
        );
      }
      return (
        `Accepted. The checklist is complete and the reviewer agreed. Write the pass report now: ` +
        `what you built, the assumptions you made, the run command, and the checklist in plain words.`
      );
    },
  };

  // Only report_done reaches the builder. review_verdict exists solely inside
  // the nested review, bound to that review's verdict.
  return [reportDoneTool];
};
