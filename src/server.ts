// src/server.ts
// HTTP API for the Dulo web client. Runs stream back as Server-Sent Events.
import "dotenv/config";
import { createServer, type ServerResponse } from "node:http";

import { FALLBACK_MODELS, MODEL } from "./llm.js";
import { closeRegistry, getRegistry, initRegistry } from "./registry.js";
import { createRunner } from "./session/runner.js";
import { handleSessionRoutes } from "./session/routes.js";
import { FileSessionStore } from "./session/store/files.js";
import type { Tool } from "./types.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.DULO_CLIENT_ORIGIN ?? "http://localhost:5173";

const corsHeaders = {
  "Access-Control-Allow-Origin": CLIENT_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify(body));
};

const runner = createRunner(new FileSessionStore());

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

  void handleSessionRoutes(req, res, url, {
    runner,
    corsHeaders,
    defaultModel: MODEL,
  }).then((handled) => {
    if (!handled) json(res, 404, { error: "not found" });
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dulo] route error:", message);
    if (!res.headersSent) json(res, 500, { error: message });
    else if (!res.writableEnded) res.end();
  });
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
  await initRegistry();
  await runner.recover();
  server.listen(PORT, () => {
    console.log(`Dulo harness API listening on http://localhost:${PORT}`);
    console.log(`Allowing browser origin ${CLIENT_ORIGIN}`);
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn("Warning: OPENROUTER_API_KEY is not set, runs will fail");
    }
  });
};

void start();
