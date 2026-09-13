// src/server.ts
// HTTP API for the Dulo web client. Runs stream back as Server-Sent Events.
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";

import { runAgent } from "./agent.js";
import type { Tool } from "./types.js";
import { FALLBACK_MODELS, MODEL } from "./llm.js";
import { closeRegistry, getRegistry, initRegistry } from "./registry.js";
import { createGate } from "./permissions.js";
import {
  cancelRun,
  createRun,
  ensureRunsDir,
  finish,
  getRun,
  listRuns,
  publish,
  readRunLog,
  subscribe,
} from "./runs.js";

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
  /** Name of a profile in agents/. Its prompt and tool policy apply. */
  agent: z.string().min(1).max(100).optional(),
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

const openSseStream = (res: ServerResponse): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...corsHeaders,
  });
};

/** Keeps proxies and browsers from treating a quiet stream as dead. */
const startHeartbeat = (res: ServerResponse): void => {
  const timer = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
  }, SSE_HEARTBEAT_MS);
  res.on("close", () => clearInterval(timer));
};

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
  const { query, model, maxSteps, temperature, enabledTools, agent } = parsed.data;
  const { tools } = getRegistry();
  const selectedTools = enabledTools
    ? tools.filter((t: Tool) => enabledTools.includes(t.name))
    : tools;

  const handle = createRun({ query, model: model ?? MODEL });
  const short = handle.id.slice(0, 8);

  // The gate lives on the run, so a reply can find it by run id even if the
  // client that asked has since reconnected on a different socket.
  let currentStep = 0;
  handle.gate = createGate({
    gated: getRegistry().gatedTools,
    onAsk: (ask) =>
      publish(handle, {
        type: "permission.ask",
        step: currentStep,
        id: ask.id,
        tool: ask.tool,
        args: ask.args,
      }),
    onSettled: (id, tool, decision) =>
      publish(handle, {
        type: "permission.resolved",
        step: currentStep,
        id,
        tool,
        decision,
      }),
  });
  // Cancelling must not leave a tool waiting forever on an answer.
  handle.controller.signal.addEventListener("abort", () => handle.gate?.abandon());
  console.log(`[run ${short}] ${query}`);

  openSseStream(res);
  startHeartbeat(res);
  // The response is only a viewer. Closing it detaches this client; the run
  // keeps going and can be picked up again via /api/run/:id/stream.
  subscribe(handle, res);

  try {
    const result = await runAgent(query, {
      tools: selectedTools,
      agent,
      model,
      maxSteps,
      temperature,
      onEvent: (event) => {
        if (event.type === "step.start") currentStep = event.step;
        publish(handle, event);
      },
      signal: handle.controller.signal,
      requestPermission: (call) => handle.gate!.request(call),
    });
    publish(handle, { type: "run.end", ...result });
    const detail = result.error ? `: ${result.error}` : "";
    console.log(
      `[run ${short}] ${result.status} in ${result.durationMs}ms${detail}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publish(handle, {
      type: "run.end",
      status: "failed",
      error: message,
      durationMs: 0,
      steps: 0,
    });
    console.error(`[run ${short}] crashed:`, message);
  } finally {
    handle.gate?.abandon();
    await finish(handle);
  }
};

const PermissionReply = z.object({
  decision: z.enum(["allow", "deny", "always"]),
});

/** Answer one pending permission request. */
const handlePermissionReply = async (
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  requestId: string,
): Promise<void> => {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const parsed = PermissionReply.safeParse(body);
  if (!parsed.success) {
    json(res, 400, { error: "decision must be allow, deny or always" });
    return;
  }
  const handle = getRun(runId);
  if (!handle?.gate) {
    json(res, 404, { error: `no run ${runId}` });
    return;
  }
  const settled = handle.gate.resolve(requestId, parsed.data.decision);
  json(res, settled ? 200 : 409, {
    settled,
    ...(settled ? {} : { error: "no pending request with that id" }),
  });
};

/** Reattach to a run already in progress, or replay one that has finished. */
const handleReattach = async (
  res: ServerResponse,
  id: string,
  after: number,
): Promise<void> => {
  const handle = getRun(id);
  if (handle) {
    openSseStream(res);
    startHeartbeat(res);
    subscribe(handle, res, after);
    return;
  }

  const events = await readRunLog(id);
  if (!events) {
    json(res, 404, { error: `no run ${id}` });
    return;
  }
  openSseStream(res);
  for (const event of events) {
    if (event.seq > after) res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
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
      toolCount: getRegistry().tools.length,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/tools") {
    json(
      res,
      200,
      getRegistry().tools.map(({ name, description, parameters }: Tool) => ({
        name,
        description,
        parameters,
      })),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/agents") {
    json(
      res,
      200,
      getRegistry().agents.map(({ name, description, model, tools: policy }) => ({
        name,
        description,
        model,
        tools: policy,
      })),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/skills") {
    json(
      res,
      200,
      getRegistry().skills.map(({ name, description }) => ({ name, description })),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/run") {
    void handleRun(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/runs") {
    void listRuns().then((runs) => json(res, 200, runs));
    return;
  }

  const streamMatch = url.pathname.match(/^\/api\/run\/([\w-]{1,64})\/stream$/);
  if (req.method === "GET" && streamMatch) {
    const after = Number(url.searchParams.get("after") ?? 0);
    void handleReattach(res, streamMatch[1], Number.isFinite(after) ? after : 0);
    return;
  }

  const permissionMatch = url.pathname.match(
    /^\/api\/run\/([\w-]{1,64})\/permission\/([\w-]{1,64})$/,
  );
  if (req.method === "POST" && permissionMatch) {
    void handlePermissionReply(req, res, permissionMatch[1], permissionMatch[2]);
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/run\/([\w-]{1,64})\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const cancelled = cancelRun(cancelMatch[1]);
    json(res, cancelled ? 200 : 409, {
      cancelled,
      ...(cancelled ? {} : { error: "run is not running" }),
    });
    return;
  }

  json(res, 404, { error: "not found" });
});

// stdio MCP servers are child processes; without this they outlive the harness.
const shutdown = (signal: string) => {
  console.log(`\n[dulo] ${signal}, shutting down`);
  void closeRegistry().finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const start = async () => {
  await ensureRunsDir();
  await initRegistry();
  server.listen(PORT, () => {
    console.log(`Dulo harness API listening on http://localhost:${PORT}`);
    console.log(`Allowing browser origin ${CLIENT_ORIGIN}`);
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn("Warning: OPENROUTER_API_KEY is not set, runs will fail");
    }
  });
};

void start();
