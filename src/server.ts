// src/server.ts
// HTTP API for the Dulo web client. Runs stream back as Server-Sent Events.
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { runAgent } from "./agent.js";
import { FALLBACK_MODELS, MODEL } from "./llm.js";
import { tools } from "./tools.js";
import type { RunEvent } from "./events.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.DULO_CLIENT_ORIGIN ?? "http://localhost:5173";
const MAX_BODY_BYTES = 64_000;
const SSE_HEARTBEAT_MS = 15_000;

const RunRequest = z.object({
  query: z.string().trim().min(1).max(4000),
  model: z.string().min(1).max(200).optional(),
  maxSteps: z.number().int().min(1).max(50).optional(),
  temperature: z.number().min(0).max(2).optional(),
  /** Tool names the model may use. Omit for all tools. */
  enabledTools: z.array(z.string()).max(200).optional(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": CLIENT_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify(body));
};

const readJsonBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });

const handleRun = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const parsed = RunRequest.safeParse(body);
  if (!parsed.success) {
    json(res, 400, { error: "invalid request", issues: parsed.error.issues });
    return;
  }
  const { query, model, maxSteps, temperature, enabledTools } = parsed.data;
  const selectedTools = enabledTools
    ? tools.filter((t) => enabledTools.includes(t.name))
    : tools;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...corsHeaders,
  });
  // Writing to a closed connection would emit an unhandled stream error,
  // so every write is skipped once the client has gone away.
  const write = (chunk: string) => {
    if (!res.writableEnded && !res.destroyed) res.write(chunk);
  };
  const send = (event: RunEvent) => {
    write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => write(": ping\n\n"), SSE_HEARTBEAT_MS);

  // Closing the browser tab or pressing Stop cancels the run.
  // The request stream is already consumed by this point, so the response
  // is what signals that the client went away.
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.on("close", cancel);
  req.on("aborted", cancel);

  const runId = randomUUID();
  const usedModel = model ?? MODEL;
  send({
    type: "run.start",
    runId,
    query,
    model: usedModel,
    startedAt: new Date().toISOString(),
  });
  console.log(`[run ${runId.slice(0, 8)}] ${query}`);

  try {
    const result = await runAgent(query, {
      tools: selectedTools,
      model,
      maxSteps,
      temperature,
      onEvent: send,
      signal: controller.signal,
    });
    send({ type: "run.end", ...result });
    const detail = result.error ? `: ${result.error}` : "";
    console.log(
      `[run ${runId.slice(0, 8)}] ${result.status} in ${result.durationMs}ms${detail}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: "run.end", status: "failed", error: message, durationMs: 0, steps: 0 });
    console.error(`[run ${runId.slice(0, 8)}] crashed:`, message);
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      name: "dulo",
      model: MODEL,
      fallbackModels: FALLBACK_MODELS,
      hasApiKey: Boolean(process.env.OPENROUTER_API_KEY),
      toolCount: tools.length,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/tools") {
    json(
      res,
      200,
      tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/run") {
    void handleRun(req, res);
    return;
  }
  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`Dulo harness API listening on http://localhost:${PORT}`);
  console.log(`Allowing browser origin ${CLIENT_ORIGIN}`);
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("Warning: OPENROUTER_API_KEY is not set, runs will fail");
  }
});
