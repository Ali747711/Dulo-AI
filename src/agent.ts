// src/agent.ts
import { callLLM, MODEL } from "./llm.js";
import { applyToolPolicy } from "./agents.js";
import { getAgent, getRegistry } from "./registry.js";
import type { RunEvent, RunResult, RunUsage } from "./events.js";
import type { Message, Tool } from "./types.js";

const SYSTEM_PROMPT = `You are a helpful assistant with access to tools.
Use tools when needed. When you have the final answer, just reply normally without calling tools.`;

const DEFAULT_MAX_STEPS = 8;

/**
 * Rough token budget for the conversation. Dulo does not track per-model
 * context windows, so this is a conservative constant: better to condense
 * early than to have a long run die on an opaque provider error.
 */
const TOKEN_BUDGET = 24_000;
/** Bytes per token. Crude, but the error only needs to be in the right direction. */
const CHARS_PER_TOKEN = 4;
/** Messages kept verbatim when condensing; older ones become a digest. */
const KEEP_RECENT_MESSAGES = 6;
const CONDENSED_CHARS = 500;
/** Cap applied to kept messages when folding the middle was not enough. */
const MAX_KEPT_MESSAGE_CHARS = 8_000;

// Asked for on the final allowed step, with no tools offered, so a run that hits
// the limit returns what it learned instead of a bare "reached max steps" error.
const WRAP_UP_PROMPT = `You have reached the step limit and cannot call any more tools.
Answer now using only what you already know from this conversation.
State what you found, what you could not finish, and what the next step would be.`;

export interface RunOptions {
  /** Tools the model may call. Defaults to every registered tool. */
  tools?: Tool[];
  /** Name of a profile in agents/: its prompt, model and tool policy win. */
  agent?: string;
  /** OpenRouter model id. Defaults to the harness default. */
  model?: string;
  /** Safety limit on model round-trips. */
  maxSteps?: number;
  /** Sampling temperature, 0 to 2. */
  temperature?: number;
  /** Receives progress events as the run advances. */
  onEvent?: (event: RunEvent) => void;
  /** Cancels the run between steps and aborts the in-flight LLM request. */
  signal?: AbortSignal;
  /**
   * Asked before a gated tool runs. Resolving false turns the call into a
   * denial the model sees, so it can choose a different approach. Omit to run
   * every tool unasked.
   */
  requestPermission?: (
    call: { id: string; tool: string; args: Record<string, unknown> },
  ) => Promise<boolean>;
}

const estimateTokens = (messages: Message[]): number =>
  Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN);

const summarise = (message: Message): string => {
  const label = message.name ? `${message.role}(${message.name})` : message.role;
  const body = message.content ?? JSON.stringify(message.tool_calls ?? []);
  return `${label}: ${body.slice(0, CONDENSED_CHARS)}${
    body.length > CONDENSED_CHARS ? "…" : ""
  }`;
};

/** Shorten one oversized tool or assistant message, leaving the prompt alone. */
const clip = (message: Message): Message => {
  if (message.role === "system" || message.role === "user") return message;
  const body = message.content;
  if (!body || body.length <= MAX_KEPT_MESSAGE_CHARS) return message;
  return {
    ...message,
    content:
      `${body.slice(0, MAX_KEPT_MESSAGE_CHARS)}\n\n[truncated: ${body.length} ` +
      `characters total. Read a smaller range or search instead of re-reading.]`,
  };
};

/**
 * Keep the system prompt, the original question and the most recent exchanges
 * verbatim; fold everything in between into one digest. If that is still over
 * budget — one read_file or http_request can exceed it on its own — clip the
 * oversized messages that remain.
 *
 * The cheap version on purpose: opencode asks the model for a summary, which is
 * a second LLM call per compaction and only earns its keep once there are real
 * multi-turn conversations to protect.
 */
const condense = (messages: Message[]): Message[] => {
  const head = messages.slice(0, 2); // system + original user query
  const tailStart = Math.max(2, messages.length - KEEP_RECENT_MESSAGES);
  const middle = messages.slice(2, tailStart);
  const tail = messages.slice(tailStart);

  const folded: Message[] =
    middle.length > 0
      ? [
          ...head,
          {
            role: "user",
            content:
              `[Earlier steps were condensed to stay within the context ` +
              `window. Summary of what happened:]\n${middle.map(summarise).join("\n")}`,
          },
          ...tail,
        ]
      : [...head, ...tail];

  if (estimateTokens(folded) <= TOKEN_BUDGET) return folded;
  return folded.map(clip);
};

interface ToolOutcome {
  result: string;
  isError: boolean;
  /** Set only when the tool threw; the raw message, no "Error: " prefix. */
  errorMessage?: string;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const parseArgs = (raw: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(raw || "{}");
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
};

const failed = (message: string): ToolOutcome => ({
  result: `Error: ${message}`,
  isError: true,
  errorMessage: message,
});

// A throwing tool must never crash the run: the model gets the error text back.
// Failure is whether the tool threw, never what its output happens to start with.
const executeTool = async (
  tools: Tool[],
  name: string,
  rawArgs: string,
  signal?: AbortSignal,
  approve?: (args: Record<string, unknown>) => Promise<boolean>,
): Promise<{ args: Record<string, unknown>; outcome: ToolOutcome }> => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return { args: {}, outcome: failed(`Tool "${name}" not found`) };
  }
  let args: Record<string, unknown>;
  try {
    args = parseArgs(rawArgs);
  } catch (error) {
    return {
      args: { raw: rawArgs },
      outcome: failed(`invalid arguments (${messageOf(error)})`),
    };
  }
  if (signal?.aborted) {
    return { args, outcome: failed("cancelled before the tool started") };
  }
  if (approve && !(await approve(args))) {
    // A denial is a normal outcome the model should react to, not a crash.
    return {
      args,
      outcome: failed(
        `the user denied permission to run "${name}". Do not retry it; ` +
          `either continue without it or explain what you need.`,
      ),
    };
  }
  try {
    return { args, outcome: { result: await tool.execute(args, signal), isError: false } };
  } catch (error) {
    return { args, outcome: failed(messageOf(error)) };
  }
};

/** Everything a turn needs decided before the loop starts. */
export interface RunConfig {
  model: string;
  agent?: string;
  temperature?: number;
  maxSteps: number;
  tools: Tool[];
  systemPrompt: string;
}

/**
 * Explicit options win over the agent profile, which wins over the defaults.
 * Throws for an unknown agent name so callers can turn it into a 400.
 */
export const resolveRunConfig = (
  options: Pick<RunOptions, "tools" | "agent" | "model" | "temperature" | "maxSteps">,
): RunConfig => {
  const registry = getRegistry();
  const profile = options.agent ? getAgent(options.agent) : undefined;
  if (options.agent && !profile) {
    throw new Error(
      `No agent named "${options.agent}". Available: ${
        registry.agents.map((a) => a.name).join(", ") || "(none)"
      }`,
    );
  }
  return {
    model: options.model ?? profile?.model ?? MODEL,
    agent: profile?.name,
    temperature: options.temperature ?? profile?.temperature,
    maxSteps: options.maxSteps ?? profile?.maxSteps ?? DEFAULT_MAX_STEPS,
    tools: applyToolPolicy(options.tools ?? registry.tools, profile?.tools),
    // A profile's body replaces the prompt entirely; the skills catalogue is
    // appended either way so load_skill is discoverable.
    systemPrompt: (profile?.prompt ?? SYSTEM_PROMPT) + registry.skillsPrompt,
  };
};

/**
 * Run the agent loop over an already-built history. `history[0]` must be the
 * system message; the last entry is the message the model should respond to.
 * This is the primitive; runAgent below is the one-shot convenience.
 */
export async function runTurn(
  history: Message[],
  options: RunOptions = {},
): Promise<RunResult> {
  const config = resolveRunConfig(options);
  const { model, temperature, maxSteps, tools } = config;
  const { onEvent = () => {}, signal, requestPermission } = options;

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const usage: RunUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const addUsage = (u?: RunUsage) => {
    if (!u) return;
    usage.promptTokens += u.promptTokens;
    usage.completionTokens += u.completionTokens;
    usage.totalTokens += u.totalTokens;
  };
  const seen = () => (usage.totalTokens > 0 ? usage : undefined);

  const messages: Message[] = [...history];

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) {
      return {
        status: "cancelled",
        steps: step - 1,
        durationMs: elapsed(),
        usage: seen(),
      };
    }
    onEvent({ type: "step.start", step });

    const estimated = estimateTokens(messages);
    if (estimated > TOKEN_BUDGET) {
      const beforeCount = messages.length;
      const condensed = condense(messages);
      const after = estimateTokens(condensed);
      // Only accept it if it actually bought something, so a conversation that
      // cannot be shrunk further is not rewritten on every single step.
      if (after < estimated) {
        messages.length = 0;
        messages.push(...condensed);
        onEvent({
          type: "context.condensed",
          step,
          droppedMessages: beforeCount - condensed.length,
          estimatedTokens: after,
        });
      }
    }

    let response: Message;
    try {
      const call = await callLLM(messages, tools, {
        model,
        temperature,
        signal,
        onDelta: (text) => onEvent({ type: "assistant.delta", step, text }),
      });
      response = call.message;
      addUsage(call.usage);
    } catch (error) {
      if (signal?.aborted) {
        return { status: "cancelled", steps: step, durationMs: elapsed(), usage: seen() };
      }
      return {
        status: "failed",
        error: messageOf(error),
        steps: step,
        durationMs: elapsed(),
        usage: seen(),
      };
    }
    messages.push(response);

    // Case 1: the model wants to call tools
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Emit tool.call events upfront so UI shows pending state for all calls
      for (const toolCall of response.tool_calls) {
        let args: Record<string, unknown>;
        try {
          args = parseArgs(toolCall.function.arguments);
        } catch {
          args = { raw: toolCall.function.arguments };
        }
        onEvent({
          type: "tool.call",
          step,
          callId: toolCall.id,
          tool: toolCall.function.name,
          args,
        });
      }

      // Execute tool calls concurrently
      const outcomes = await Promise.all(
        response.tool_calls.map(async (toolCall) => {
          const toolName = toolCall.function.name;
          const callId = toolCall.id;
          const t0 = Date.now();
          const { outcome } = await executeTool(
            tools,
            toolName,
            toolCall.function.arguments,
            signal,
            requestPermission
              ? (args) =>
                  requestPermission({ id: callId, tool: toolName, args })
              : undefined,
          );
          onEvent({
            type: "tool.result",
            step,
            callId,
            tool: toolName,
            result: outcome.result,
            durationMs: Date.now() - t0,
            isError: outcome.isError,
            ...(outcome.errorMessage
              ? { error: { message: outcome.errorMessage } }
              : {}),
          });
          return {
            callId,
            name: toolName,
            content: outcome.result,
          };
        }),
      );

      for (const item of outcomes) {
        messages.push({
          role: "tool",
          tool_call_id: item.callId,
          name: item.name,
          content: item.content,
        });
      }
      continue;
    }

    // Case 2: the model gave a final answer
    if (response.content) {
      onEvent({ type: "assistant", step, text: response.content });
      return {
        status: "completed",
        finalAnswer: response.content,
        reason: "answered",
        steps: step,
        durationMs: elapsed(),
        usage: seen(),
      };
    }
  }

  // Out of steps. Every tool result is still sitting in `messages`, so ask for a
  // summary with no tools offered rather than throwing that work away.
  if (signal?.aborted) {
    return { status: "cancelled", steps: maxSteps, durationMs: elapsed(), usage: seen() };
  }
  try {
    const wrapUp = await callLLM(
      [...messages, { role: "user", content: WRAP_UP_PROMPT }],
      [],
      {
        model,
        temperature,
        signal,
        onDelta: (text) =>
          onEvent({ type: "assistant.delta", step: maxSteps, text }),
      },
    );
    addUsage(wrapUp.usage);
    if (wrapUp.message.content) {
      onEvent({ type: "assistant", step: maxSteps, text: wrapUp.message.content });
      return {
        status: "completed",
        finalAnswer: wrapUp.message.content,
        reason: "step-limit",
        steps: maxSteps,
        durationMs: elapsed(),
        usage: seen(),
      };
    }
  } catch (error) {
    if (signal?.aborted) {
      return { status: "cancelled", steps: maxSteps, durationMs: elapsed(), usage: seen() };
    }
    // Fall through to the plain failure below; the wrap-up is best-effort.
  }

  return {
    status: "failed",
    error: `Reached max steps (${maxSteps}) without a final answer.`,
    reason: "step-limit",
    steps: maxSteps,
    durationMs: elapsed(),
    usage: seen(),
  };
}

/** One-shot: a fresh conversation with a single user message. Used by the CLI. */
export async function runAgent(
  userQuery: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const config = resolveRunConfig(options);
  return runTurn(
    [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: userQuery },
    ],
    { ...options, agent: undefined, tools: config.tools, model: config.model,
      temperature: config.temperature, maxSteps: config.maxSteps },
  );
}
