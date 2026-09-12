// src/agent.ts
import { callLLM } from "./llm.js";
import { tools as defaultTools } from "./tools.js";
import type { RunEvent, RunResult } from "./events.js";
import type { Message, Tool } from "./types.js";

const SYSTEM_PROMPT = `You are a helpful assistant with access to tools.
Use tools when needed. When you have the final answer, just reply normally without calling tools.`;

const DEFAULT_MAX_STEPS = 8;

export interface RunOptions {
  /** Tools the model may call. Defaults to every registered tool. */
  tools?: Tool[];
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
}

const parseArgs = (raw: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(raw || "{}");
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
};

// A throwing tool must never crash the run: the model gets the error text back
const executeTool = async (
  tools: Tool[],
  name: string,
  rawArgs: string,
): Promise<{ args: Record<string, unknown>; outcome: ToolOutcome }> => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      args: {},
      outcome: { result: `Error: Tool "${name}" not found`, isError: true },
    };
  }
  let args: Record<string, unknown>;
  try {
    args = parseArgs(rawArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      args: { raw: rawArgs },
      outcome: { result: `Error: invalid arguments (${message})`, isError: true },
    };
  }
  try {
    const result = await tool.execute(args);
    return { args, outcome: { result, isError: result.startsWith("Error:") } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { args, outcome: { result: `Error: ${message}`, isError: true } };
  }
};

export async function runAgent(
  userQuery: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const {
    tools = defaultTools,
    model,
    maxSteps = DEFAULT_MAX_STEPS,
    temperature,
    onEvent = () => {},
    signal,
  } = options;

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userQuery },
  ];

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) {
      return { status: "cancelled", steps: step - 1, durationMs: elapsed() };
    }
    onEvent({ type: "step.start", step });

    let response: Message;
    try {
      response = await callLLM(messages, tools, { model, temperature, signal });
    } catch (error) {
      if (signal?.aborted) {
        return { status: "cancelled", steps: step, durationMs: elapsed() };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { status: "failed", error: message, steps: step, durationMs: elapsed() };
    }
    messages.push(response);

    // Case 1: the model wants to call tools
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.function.name;
        const callId = toolCall.id;
        const t0 = Date.now();
        const { args, outcome } = await executeTool(
          tools,
          toolName,
          toolCall.function.arguments,
        );
        // Emit the call once args are parsed so the UI shows what was requested
        onEvent({ type: "tool.call", step, callId, tool: toolName, args });
        onEvent({
          type: "tool.result",
          step,
          callId,
          tool: toolName,
          result: outcome.result,
          durationMs: Date.now() - t0,
          isError: outcome.isError,
        });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          name: toolName,
          content: outcome.result,
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
        steps: step,
        durationMs: elapsed(),
      };
    }
  }

  return {
    status: "failed",
    error: `Reached max steps (${maxSteps}) without a final answer.`,
    steps: maxSteps,
    durationMs: elapsed(),
  };
}
