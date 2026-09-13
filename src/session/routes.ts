// src/session/routes.ts
// HTTP surface for sessions, plus the legacy /api/run* routes expressed as
// "a session with one turn" so the Go TUI and any older client keep working.
// Returns true when it handled the request.
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import type { Runner } from "./runner.js";
import type { Part } from "./types.js";

const MAX_BODY_BYTES = 256_000;
const SSE_HEARTBEAT_MS = 15_000;

export interface RouteContext {
  runner: Runner;
  corsHeaders: Record<string, string>;
  /** MODEL from src/llm.ts, for the legacy run.start model field. */
  defaultModel: string;
}

const TextPart = z.object({ type: z.literal("text"), text: z.string().max(200_000) });
const AttachmentPart = z.object({
  type: z.literal("attachment"),
  fileId: z.string().regex(/^[\w-]{1,64}$/),
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(100),
  size: z.number().int().min(0),
});
const UserPart = z.discriminatedUnion("type", [TextPart, AttachmentPart]);

const Settings = {
  model: z.string().min(1).max(200).optional(),
  agent: z.string().min(1).max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxSteps: z.number().int().min(1).max(50).optional(),
};

const CreateSession = z.object({
  title: z.string().max(200).optional(),
  defaults: z.object(Settings).optional(),
});

const PatchSession = z.object({
  title: z.string().min(1).max(200).optional(),
  headId: z.string().min(1).max(64).optional(),
});

const SendMessage = z
  .object({
    text: z.string().trim().min(1).max(200_000).optional(),
    parts: z.array(UserPart).min(1).max(50).optional(),
    parentId: z.string().min(1).max(64).nullable().optional(),
    enabledTools: z.array(z.string()).max(200).optional(),
    ...Settings,
  })
  .refine((b) => Boolean(b.text) !== Boolean(b.parts), {
    message: "send exactly one of `text` or `parts`",
  });

const PermissionReply = z.object({ decision: z.enum(["allow", "deny", "always"]) });

/** The pre-session RunRequest, unchanged, so old clients are not broken. */
const LegacyRun = z.object({
  query: z.string().trim().min(1).max(4000),
  enabledTools: z.array(z.string()).max(200).optional(),
  ...Settings,
});

const json = (res: ServerResponse, status: number, body: unknown, cors: Record<string, string>): void => {
  res.writeHead(status, { "Content-Type": "application/json", ...cors });
  res.end(body === undefined ? undefined : JSON.stringify(body));
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

const openSse = (res: ServerResponse, cors: Record<string, string>): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...cors,
  });
  const timer = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
  }, SSE_HEARTBEAT_MS);
  res.on("close", () => clearInterval(timer));
};

const partsOf = (body: z.infer<typeof SendMessage>): Part[] =>
  body.parts ?? [{ type: "text", text: body.text as string }];

const startOrReject = async (
  ctx: RouteContext,
  res: ServerResponse,
  sessionId: string,
  body: z.infer<typeof SendMessage>,
): Promise<void> => {
  const { runner, corsHeaders } = ctx;
  let result;
  try {
    result = await runner.startTurn(sessionId, {
      parts: partsOf(body),
      parentId: body.parentId,
      model: body.model,
      agent: body.agent,
      temperature: body.temperature,
      maxSteps: body.maxSteps,
      enabledTools: body.enabledTools,
    });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) }, corsHeaders);
    return;
  }
  if (result === null) return json(res, 404, { error: `no session ${sessionId}` }, corsHeaders);
  if (!result.started) {
    // Plan 3 turns "running" into a 202 with a queued message.
    const status = result.reason === "running" ? 409 : 400;
    return json(res, status, { error: result.reason === "running" ? "a turn is running" : "parentId is not in this session" }, corsHeaders);
  }
  json(res, 200, {
    turnId: result.turnId,
    userMessageId: result.userMessageId,
    assistantMessageId: result.assistantMessageId,
  }, corsHeaders);
};

export const handleSessionRoutes = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: RouteContext,
): Promise<boolean> => {
  const { runner, corsHeaders: cors } = ctx;
  const method = req.method ?? "GET";
  const p = url.pathname;

  // ---- sessions ----------------------------------------------------------
  if (p === "/api/sessions" && method === "GET") {
    json(res, 200, await runner.listSessions(), cors);
    return true;
  }
  if (p === "/api/sessions" && method === "POST") {
    const parsed = CreateSession.safeParse(await readJsonBody(req).catch(() => null));
    if (!parsed.success) return json(res, 400, { error: "invalid body", issues: parsed.error.issues }, cors), true;
    json(res, 201, await runner.createSession(parsed.data), cors);
    return true;
  }

  const m = p.match(/^\/api\/sessions\/([\w-]{1,64})(?:\/(.*))?$/);
  if (m) {
    const [, id, rest = ""] = m;

    if (rest === "" && method === "GET") {
      const snap = await runner.getSnapshot(id);
      return snap ? (json(res, 200, snap, cors), true) : (json(res, 404, { error: `no session ${id}` }, cors), true);
    }
    if (rest === "" && method === "PATCH") {
      const parsed = PatchSession.safeParse(await readJsonBody(req).catch(() => null));
      if (!parsed.success) return json(res, 400, { error: "invalid body", issues: parsed.error.issues }, cors), true;
      let session = null;
      if (parsed.data.title !== undefined) session = await runner.rename(id, parsed.data.title);
      if (parsed.data.headId !== undefined) {
        session = await runner.setHead(id, parsed.data.headId);
        if (!session) return json(res, 409, { error: "headId unknown, or a turn is running" }, cors), true;
      }
      if (!session) session = (await runner.getSnapshot(id))?.session ?? null;
      return session ? (json(res, 200, session, cors), true) : (json(res, 404, { error: `no session ${id}` }, cors), true);
    }
    if (rest === "" && method === "DELETE") {
      const ok = await runner.deleteSession(id);
      return ok ? (json(res, 204, undefined, cors), true) : (json(res, 404, { error: `no session ${id}` }, cors), true);
    }
    if (rest === "messages" && method === "POST") {
      const parsed = SendMessage.safeParse(await readJsonBody(req).catch(() => null));
      if (!parsed.success) return json(res, 400, { error: "invalid body", issues: parsed.error.issues }, cors), true;
      await startOrReject(ctx, res, id, parsed.data);
      return true;
    }
    if (rest === "events" && method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0);
      openSse(res, cors);
      const ok = await runner.subscribe(id, res, Number.isFinite(after) ? after : 0);
      if (!ok) res.end();
      return true;
    }
    if (rest === "cancel" && method === "POST") {
      json(res, 200, { cancelled: runner.cancel(id) }, cors);
      return true;
    }
    const perm = rest.match(/^permission\/([\w-]{1,64})$/);
    if (perm && method === "POST") {
      const parsed = PermissionReply.safeParse(await readJsonBody(req).catch(() => null));
      if (!parsed.success) return json(res, 400, { error: "decision must be allow, deny or always" }, cors), true;
      const settled = runner.resolvePermission(id, perm[1], parsed.data.decision);
      json(res, settled ? 200 : 409, { settled }, cors);
      return true;
    }
    return false;
  }

  // ---- legacy: a run is a one-turn session --------------------------------
  if (p === "/api/run" && method === "POST") {
    const parsed = LegacyRun.safeParse(await readJsonBody(req).catch(() => null));
    if (!parsed.success) return json(res, 400, { error: "invalid request", issues: parsed.error.issues }, cors), true;
    const { query, ...settings } = parsed.data;
    const session = await runner.createSession({ title: query.slice(0, 60) });
    openSse(res, cors);
    // Order matters: start the turn, then subscribe from seq 0. The backlog
    // replay delivers run.start and message.created even though they were
    // published before the subscription existed, and untilTurnEnd closes the
    // stream at run.end the way the old one-run endpoint did.
    let result;
    try {
      result = await runner.startTurn(session.id, {
        parts: [{ type: "text", text: query }],
        ...settings,
      });
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: "run.end", status: "failed", error: error instanceof Error ? error.message : String(error), durationMs: 0, steps: 0 })}\n\n`);
      res.end();
      return true;
    }
    if (!result || !result.started) {
      res.end();
      return true;
    }
    await runner.subscribe(session.id, res, 0, result.turnId);
    console.log(`[run ${result.turnId.slice(0, 8)}] ${query}`);
    return true;
  }
  if (p === "/api/runs" && method === "GET") {
    // Legacy shape for the old web client's history list.
    const sessions = await runner.listSessions();
    json(res, 200, sessions.map((s) => ({
      id: s.id,
      query: s.title,
      model: s.lastModel ?? ctx.defaultModel,
      startedAt: s.createdAt,
      status: s.status === "running" ? "running" : "completed",
      steps: s.messageCount,
      durationMs: 0,
    })), cors);
    return true;
  }
  const legacy = p.match(/^\/api\/run\/([\w-]{1,64})\/(stream|cancel|permission\/([\w-]{1,64}))$/);
  if (legacy) {
    const [, rawId, action, requestId] = legacy;
    // The id may be a turn id (from run.start) or a session id (from /api/runs).
    const sessionId = runner.sessionForTurn(rawId) ?? rawId;
    if (action === "stream" && method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0);
      openSse(res, cors);
      const turnId = runner.sessionForTurn(rawId) ? rawId : undefined;
      const ok = await runner.subscribe(sessionId, res, Number.isFinite(after) ? after : 0, turnId);
      if (!ok) res.end();
      return true;
    }
    if (action === "cancel" && method === "POST") {
      const cancelled = runner.cancel(sessionId);
      json(res, cancelled ? 200 : 409, { cancelled, ...(cancelled ? {} : { error: "run is not running" }) }, cors);
      return true;
    }
    if (action.startsWith("permission/") && method === "POST" && requestId) {
      const parsed = PermissionReply.safeParse(await readJsonBody(req).catch(() => null));
      if (!parsed.success) return json(res, 400, { error: "decision must be allow, deny or always" }, cors), true;
      const settled = runner.resolvePermission(sessionId, requestId, parsed.data.decision);
      json(res, settled ? 200 : 409, { settled }, cors);
      return true;
    }
  }

  return false;
};
