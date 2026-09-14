// src/llm.ts
import type { Message, Tool, ToolCall } from "./types.js";

// Read per call, not once at import, so a test can point it at a local stub
// after this module has already been loaded.
const openRouterUrl = (): string =>
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

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

/**
 * Bounds on one request. A provider can accept the connection and then send
 * nothing, and fetch will wait forever; the turn then hangs until someone
 * cancels it (this happened for 28 minutes on the first real Frontend Engineer
 * run). Both bounds fire as a retryable network failure, so the normal attempt
 * loop treats them exactly like a dropped socket.
 */
const DEFAULT_STALL_MS = 90_000;
const DEFAULT_TOTAL_MS = 600_000;

const positiveEnv = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};
/** Longest silence tolerated before the first byte or between chunks. */
export const stallMs = (): number => positiveEnv("LLM_STALL_MS", DEFAULT_STALL_MS);
/** Longest a single request may live, bytes or not. */
export const totalMs = (): number => positiveEnv("LLM_TOTAL_MS", DEFAULT_TOTAL_MS);

type Bound = "stall" | "total";

/** Aborts `controller` on silence or on the total bound; `touch()` on every byte. */
const watchRequest = (controller: AbortController) => {
  const stall = stallMs();
  const total = totalMs();
  let fired: Bound | undefined;
  const fire = (why: Bound) => {
    if (fired) return;
    fired = why;
    controller.abort();
  };
  const arm = (): NodeJS.Timeout => {
    const t = setTimeout(() => fire("stall"), stall);
    t.unref();
    return t;
  };
  const totalTimer = setTimeout(() => fire("total"), total);
  totalTimer.unref();
  let stallTimer = arm();
  return {
    touch(): void {
      clearTimeout(stallTimer);
      stallTimer = arm();
    },
    stop(): void {
      clearTimeout(stallTimer);
      clearTimeout(totalTimer);
    },
    get fired(): Bound | undefined {
      return fired;
    },
    error(): LlmError {
      return fired === "total"
        ? new LlmError(
            `Model request exceeded ${Math.round(total / 1000)} s and was aborted`,
            { kind: "network", retryable: true },
          )
        : new LlmError(
            `Model stream stalled: no data for ${Math.round(stall / 1000)} s`,
            { kind: "network", retryable: true },
          );
    },
  };
};

/**
 * Why a call failed. `retryable` says whether trying the identical request
 * again could plausibly work — resending a request the provider rejected on its
 * merits only wastes the user's wall-clock time and quota.
 */
export type FailureKind =
  | "auth"
  | "context-overflow"
  | "invalid"
  | "network"
  | "quota"
  | "rate-limit"
  | "server";

export class LlmError extends Error {
  readonly kind: FailureKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    init: {
      kind: FailureKind;
      retryable: boolean;
      status?: number;
      retryAfterMs?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: init.cause });
    this.name = "LlmError";
    this.kind = init.kind;
    this.retryable = init.retryable;
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
  }
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CallOptions {
  /** Override the default model for this request. */
  model?: string;
  /** Sampling temperature, defaults to 0.2. */
  temperature?: number;
  /** Aborts the HTTP request. */
  signal?: AbortSignal;
  /** Receives assistant text as it arrives. */
  onDelta?: (text: string) => void;
}

export interface CallResult {
  message: Message;
  usage?: Usage;
}

interface ChatCompletionRequest {
  model: string;
  models: string[];
  messages: Message[];
  temperature: number;
  stream: true;
  stream_options: { include_usage: true };
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

/**
 * Providers report a too-long prompt as a 400 with prose, not a dedicated
 * status. These are the phrasings seen in the wild; a miss only costs a worse
 * error message, never a wrong retry decision, since 400 is non-retryable anyway.
 */
const CONTEXT_OVERFLOW = [
  /context length/i,
  /context window/i,
  /maximum context/i,
  /too many tokens/i,
  /prompt is too long/i,
  /reduce the length/i,
  /exceeds? the maximum/i,
  /token limit/i,
];

const parseRetryAfter = (headers: Headers): number | undefined => {
  const ms = headers.get("retry-after-ms");
  if (ms && Number.isFinite(Number(ms))) return Number(ms);

  const after = headers.get("retry-after");
  if (!after) return undefined;
  if (Number.isFinite(Number(after))) return Number(after) * 1000;
  const at = Date.parse(after);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
};

export const classifyFailure = (
  status: number,
  bodyText: string,
  headers: Headers,
): { kind: FailureKind; retryable: boolean; retryAfterMs?: number } => {
  if (status === 429) {
    return { kind: "rate-limit", retryable: true, retryAfterMs: parseRetryAfter(headers) };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", retryable: false };
  }
  if (status === 402) {
    return { kind: "quota", retryable: false };
  }
  if (status >= 500) {
    return { kind: "server", retryable: true, retryAfterMs: parseRetryAfter(headers) };
  }
  if (CONTEXT_OVERFLOW.some((re) => re.test(bodyText))) {
    return { kind: "context-overflow", retryable: false };
  }
  return { kind: "invalid", retryable: false };
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Exponential backoff with jitter, unless the provider named a delay itself. */
const backoffFor = (attempt: number, retryAfterMs?: number): number => {
  const base = retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt;
  const capped = Math.min(base, MAX_BACKOFF_MS);
  return Math.round(capped * (0.8 + Math.random() * 0.4));
};

const readUsage = (raw: unknown): Usage | undefined => {
  const u = raw as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;
  if (!u) return undefined;
  const promptTokens = u.prompt_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: u.total_tokens ?? promptTokens + completionTokens,
  };
};

const errorFromBody = (error: { message?: string; code?: number }): LlmError => {
  const code = error.code;
  // A 200 response carrying error.code 429 is OpenRouter's shared free-tier
  // daily cap, not a transient rate limit. Retrying it only burns wall clock.
  if (code === 429) {
    return new LlmError(
      `OpenRouter free-tier limit reached: ${error.message ?? "rate limited"}`,
      { kind: "quota", retryable: false, status: 200 },
    );
  }
  return new LlmError(`OpenRouter error ${code ?? ""}: ${error.message ?? "unknown"}`.trim(), {
    kind: "invalid",
    retryable: false,
    status: 200,
  });
};

/** Fold streamed tool-call fragments, which arrive split across many chunks. */
class ToolCallAccumulator {
  private readonly byIndex = new Map<
    number,
    { id?: string; name?: string; args: string }
  >();

  add(deltas: readonly any[]): void {
    for (const delta of deltas) {
      const index = delta.index ?? 0;
      const entry = this.byIndex.get(index) ?? { args: "" };
      if (delta.id) entry.id = delta.id;
      if (delta.function?.name) entry.name = delta.function.name;
      if (delta.function?.arguments) entry.args += delta.function.arguments;
      this.byIndex.set(index, entry);
    }
  }

  build(): ToolCall[] | undefined {
    if (this.byIndex.size === 0) return undefined;
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, entry]) => ({
        id: entry.id ?? `call_${index}`,
        type: "function" as const,
        function: { name: entry.name ?? "", arguments: entry.args || "{}" },
      }));
  }
}

/** Parse an OpenAI-compatible SSE body into one assistant message. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (text: string) => void,
  onChunk?: () => void,
): Promise<CallResult & { emitted: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new ToolCallAccumulator();
  let content = "";
  let usage: Usage | undefined;
  let emitted = false;
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk?.();
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; keep any partial tail for later.
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let chunk: any;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue; // a comment or keep-alive, not a chunk
          }
          if (chunk.error) throw errorFromBody(chunk.error);

          if (chunk.usage) usage = readUsage(chunk.usage) ?? usage;
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.content === "string" && delta.content.length > 0) {
            content += delta.content;
            emitted = true;
            onDelta?.(delta.content);
          }
          if (Array.isArray(delta.tool_calls)) toolCalls.add(delta.tool_calls);
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return {
    message: {
      role: "assistant",
      content: content.length > 0 ? content : null,
      tool_calls: toolCalls.build(),
    },
    usage,
    emitted,
  };
}

/** Parse a plain JSON completion. Stubs and some providers ignore `stream`. */
function readJson(data: any): CallResult {
  if (data.error) throw errorFromBody(data.error);
  const message = data.choices?.[0]?.message as Message | undefined;
  if (!message) {
    throw new LlmError(
      `OpenRouter returned no choices: ${JSON.stringify(data).slice(0, 500)}`,
      { kind: "invalid", retryable: false },
    );
  }
  return { message, usage: readUsage(data.usage) };
}

export async function callLLM(
  messages: Message[],
  tools: Tool[] = [],
  options: CallOptions = {},
): Promise<CallResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LlmError("OPENROUTER_API_KEY not configured", {
      kind: "auth",
      retryable: false,
    });
  }

  const model = options.model ?? MODEL;
  // Keep the primary first and avoid duplicates; OpenRouter caps the list at 3
  const models = [...new Set([model, ...FALLBACK_MODELS])].slice(0, 3);

  const body: ChatCompletionRequest = {
    model,
    models,
    messages,
    temperature: options.temperature ?? 0.2,
    stream: true,
    stream_options: { include_usage: true },
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

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let emitted = false;
    // One controller per attempt: the watchdog aborts only its own request,
    // and the caller's signal still cancels everything.
    const attemptController = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, attemptController.signal])
      : attemptController.signal;
    const watch = watchRequest(attemptController);
    // Text that reached the client must not be re-sent by a retry, whatever
    // ends the stream afterwards.
    const onDelta = options.onDelta
      ? (text: string) => {
          emitted = true;
          options.onDelta!(text);
        }
      : undefined;
    try {
      let res: Response;
      try {
        res = await fetch(openRouterUrl(), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:5173", // optional
            "X-Title": "Dulo", // optional
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (watch.fired) throw watch.error();
        // A socket-level failure never reached the model; safe to resend.
        throw new LlmError(
          `Could not reach OpenRouter: ${error instanceof Error ? error.message : String(error)}`,
          { kind: "network", retryable: true, cause: error },
        );
      }

      if (!res.ok) {
        const text = await res.text();
        const { kind, retryable, retryAfterMs } = classifyFailure(
          res.status,
          text,
          res.headers,
        );
        throw new LlmError(`OpenRouter error ${res.status}: ${text.slice(0, 500)}`, {
          kind,
          retryable,
          status: res.status,
          retryAfterMs,
        });
      }

      watch.touch(); // headers arrived
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream") || !res.body) {
        try {
          return readJson(await res.json());
        } catch (error) {
          if (!options.signal?.aborted && watch.fired) throw watch.error();
          throw error;
        }
      }
      let result: Awaited<ReturnType<typeof readStream>>;
      try {
        result = await readStream(res.body, onDelta, () => watch.touch());
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (watch.fired) throw watch.error();
        throw error;
      }
      emitted = emitted || result.emitted;
      return { message: result.message, usage: result.usage };
    } catch (error) {
      lastError = error;
      const last = attempt === MAX_ATTEMPTS - 1;
      const retryable = error instanceof LlmError && error.retryable;
      // Resending after text already reached the client would repeat it in the
      // UI; a partial answer is better than a duplicated one.
      if (!retryable || last || emitted || options.signal?.aborted) throw error;
      await sleep(backoffFor(attempt, error.retryAfterMs), options.signal);
    } finally {
      watch.stop();
    }
  }

  throw lastError;
}
