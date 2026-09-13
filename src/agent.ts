// src/agent.ts
import { callLLM } from "./llm.js";
import { applyToolPolicy } from "./agents.js";
import { getAgent, getRegistry } from "./registry.js";
import type { RunEvent, RunResult, RunUsage } from "./events.js";
import type { Message, Tool } from "./types.js";

const SYSTEM_PROMPT = `You are a helpful assistant with access to tools.
Use tools when needed. When you have the final answer, just reply normally without calling tools.`;

const DEFAULT_MAX_STEPS = 8;

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
}

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
  try {
    return { args, outcome: { result: await tool.execute(args, signal), isError: false } };
  } catch (error) {
    return { args, outcome: failed(messageOf(error)) };
  }
};

export async function runAgent(
  userQuery: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const registry = getRegistry();
  const profile = options.agent ? getAgent(options.agent) : undefined;
  if (options.agent && !profile) {
    throw new Error(
      `No agent named "${options.agent}". Available: ${
        registry.agents.map((a) => a.name).join(", ") || "(none)"
      }`,
    );
  }

  const {
    onEvent = () => {},
    signal,
  } = options;
  // Explicit options win over the profile, which wins over the defaults.
  const model = options.model ?? profile?.model;
  const temperature = options.temperature ?? profile?.temperature;
  const maxSteps = options.maxSteps ?? profile?.maxSteps ?? DEFAULT_MAX_STEPS;
  const tools = applyToolPolicy(
    options.tools ?? registry.tools,
    profile?.tools,
  );
  // A profile's body replaces the prompt entirely; the skills catalogue is
  // appended either way so load_skill is discoverable.
  const systemPrompt = (profile?.prompt ?? SYSTEM_PROMPT) + registry.skillsPrompt;

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
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userQuery },
  ];

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
