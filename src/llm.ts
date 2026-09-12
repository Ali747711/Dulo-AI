// src/llm.ts
import type { Message, Tool } from "./types.js";

// Override to point at a local stub during testing
const OPENROUTER_URL =
  process.env.OPENROUTER_URL ?? "https://openrouter.ai/api/v1/chat/completions";

// Free models that support tools (as of Sep 2026). Override with OPENROUTER_MODEL in .env
// You can also use "openrouter/free" (auto-picks a free model)
export const MODEL =
  process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free";
// If MODEL is down or rate-limited, OpenRouter tries these in order (max 3 total)
export const FALLBACK_MODELS = [
  "nex-agi/nex-n2.5-pro:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];

export interface CallOptions {
  /** Override the default model for this request. */
  model?: string;
  /** Sampling temperature, defaults to 0.2. */
  temperature?: number;
  /** Aborts the HTTP request. */
  signal?: AbortSignal;
}

interface ChatCompletionRequest {
  model: string;
  models: string[];
  messages: Message[];
  temperature: number;
  tools?: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }[];
  tool_choice?: "auto";
}

export async function callLLM(
  messages: Message[],
  tools: Tool[] = [],
  options: CallOptions = {},
): Promise<Message> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const model = options.model ?? MODEL;
  // Keep the primary first and avoid duplicates; OpenRouter caps the list at 3
  const models = [...new Set([model, ...FALLBACK_MODELS])].slice(0, 3);

  const body: ChatCompletionRequest = {
    model,
    models,
    messages,
    temperature: options.temperature ?? 0.2,
  };

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = "auto";
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5173", // optional
      "X-Title": "Dulo", // optional
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices?: { message: Message }[];
    error?: { message: string; code?: number };
  };
  if (data.error) {
    throw new Error(
      `OpenRouter error ${data.error.code ?? ""}: ${data.error.message}`,
    );
  }
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error(
      `OpenRouter returned no choices: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  return message;
}
