// src/session/runner.ts
// Live conversation state. A session's life is owned here, not by any HTTP
// response: the response is a viewer that can drop and reattach. This is
// src/runs.ts re-keyed by session — same seq counter, same subscriber set,
// same gate-on-the-handle, plus the message tree and turn bookkeeping.
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

import { resolveRunConfig, runTurn, type RunConfig } from "../agent.js";
import type { PermissionDecision, RunEvent, RunResult } from "../events.js";
import { createGate, flatClassifier, type Gate } from "../permissions.js";
import { getAgent, getRegistry } from "../registry.js";
import { applyToolPolicy } from "../agents.js";
import { createLoopTools } from "../loop/report-done.js";
import type { Tool } from "../types.js";
import { fillDangling, foldTurnEvent } from "./fold.js";
import { projectHistory } from "./history.js";
import type { SessionStore } from "./store.js";
import { latestLeaf } from "./tree.js";
import type {
  ChatMessage,
  Part,
  QueuedMessage,
  Session,
  SessionEvent,
  SessionOnlyEvent,
  SessionPatch,
  SessionSummary,
  Turn,
  TurnSettings,
} from "./types.js";

/** Events kept in memory per live session for fast reattach. */
const RECENT_LIMIT = 2000;
const TITLE_MAX = 60;
const DEFAULT_TITLE = "New chat";

export interface TurnInput extends TurnSettings {
  parts: Part[];
  /** undefined = current head; null = start a new root (edit the first message). */
  parentId?: string | null;
  /** Legacy /api/run: restrict tools by name for this turn only. */
  enabledTools?: string[];
  /** Reuse an id, so a dequeued QueuedMessage keeps the id the client saw. */
  messageId?: string;
}

export type StartResult =
  | { started: true; turnId: string; userMessageId: string; assistantMessageId: string }
  | { started: false; reason: "bad-parent" }
  | { started: false; reason: "queued"; queued: QueuedMessage };

export type SendQueuedResult =
  | { sent: true; turnId: string; userMessageId: string; assistantMessageId: string }
  | { sent: false; reason: "running" };

export interface Snapshot {
  session: Session;
  messages: ChatMessage[];
  turns: Turn[];
  /** Current seq at snapshot time; subscribe with `after=seq`. */
  seq: number;
  liveTurn?: {
    turnId: string;
    assistant: ChatMessage;
    /** Gated tool calls waiting on a human right now. Empty when none. */
    pendingPermissions: {
      id: string;
      step: number;
      tool: string;
      args: Record<string, unknown>;
    }[];
  };
}

interface Subscriber {
  res: ServerResponse;
  /** Legacy run streams close when this turn ends; session streams stay open. */
  untilTurnEnd?: string;
}

interface LiveTurn {
  turn: Turn;
  assistant: ChatMessage;
  controller: AbortController;
  gate: Gate;
  done: Promise<void>;
  step: number;
}

interface LiveSession {
  session: Session;
  messages: ChatMessage[];
  turns: Turn[];
  seq: number;
  recent: SessionEvent[];
  subscribers: Set<Subscriber>;
  turn?: LiveTurn;
}

export const titleFrom = (parts: readonly Part[]): string => {
  const text = parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const attachment = parts.find((p): p is Extract<Part, { type: "attachment" }> => p.type === "attachment");
  const base = text || attachment?.name || DEFAULT_TITLE;
  return base.length > TITLE_MAX ? `${base.slice(0, TITLE_MAX - 1)}…` : base;
};

const textOf = (parts: readonly Part[]): string =>
  parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text").map((p) => p.text).join("\n\n");

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const writeEvent = (res: ServerResponse, event: SessionEvent): void => {
  if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
};

export interface Runner {
  createSession(input?: { title?: string; defaults?: TurnSettings }): Promise<Session>;
  listSessions(): Promise<SessionSummary[]>;
  getSnapshot(id: string): Promise<Snapshot | null>;
  rename(id: string, title: string): Promise<Session | null>;
  /** Resolves to the latest leaf under `messageId`; null if unknown or running. */
  setHead(id: string, messageId: string): Promise<Session | null>;
  deleteSession(id: string): Promise<boolean>;
  /** null = no such session. Throws for an unknown agent name. */
  startTurn(id: string, input: TurnInput): Promise<StartResult | null>;
  cancel(id: string): boolean;
  resolvePermission(id: string, requestId: string, decision: PermissionDecision): boolean;
  /** null = no such session or no such queued message. */
  patchQueueItem(
    id: string,
    msgId: string,
    patch: Partial<Pick<QueuedMessage, "parts" | "parentId" | "model" | "agent">>,
  ): Promise<QueuedMessage | null>;
  /** true = removed. false = no such session or no such queued message. */
  removeQueueItem(id: string, msgId: string): Promise<boolean>;
  /** null = no such session or no such queued message. */
  sendQueueItem(id: string, msgId: string): Promise<SendQueuedResult | null>;
  /** Attach an SSE response. Backlog after `after`, then live. */
  subscribe(id: string, res: ServerResponse, after: number, untilTurnEnd?: string): Promise<boolean>;
  eventsAfter(id: string, after: number): Promise<SessionEvent[]>;
  sessionForTurn(turnId: string): string | undefined;
  /** Resolves when no turn is running (immediately if idle). */
  awaitIdle(id: string): Promise<void>;
  /** On startup: any session left "running" by a crash is marked idle. */
  recover(): Promise<void>;
}

export const createRunner = (store: SessionStore): Runner => {
  const live = new Map<string, LiveSession>();
  const turnToSession = new Map<string, string>();

  const load = async (id: string): Promise<LiveSession | null> => {
    const cached = live.get(id);
    if (cached) return cached;
    const session = await store.getSession(id);
    if (!session) return null;
    const [messages, turns, events] = await Promise.all([
      store.getMessages(id),
      store.getTurns(id),
      store.readEvents(id, 0),
    ]);
    for (const turn of turns) turnToSession.set(turn.id, id);
    const entry: LiveSession = {
      session,
      messages,
      turns,
      seq: events[events.length - 1]?.seq ?? 0,
      recent: events.slice(-RECENT_LIMIT),
      subscribers: new Set(),
    };
    live.set(id, entry);
    return entry;
  };

  const publish = (
    entry: LiveSession,
    event: RunEvent | SessionOnlyEvent,
    turnId?: string,
  ): void => {
    const stored = {
      ...event,
      sessionId: entry.session.id,
      seq: ++entry.seq,
      ...(turnId ? { turnId } : {}),
    } as SessionEvent;

    entry.recent.push(stored);
    if (entry.recent.length > RECENT_LIMIT) entry.recent.splice(0, entry.recent.length - RECENT_LIMIT);

    if (entry.turn && turnId === entry.turn.turn.id) {
      entry.turn.assistant = foldTurnEvent(entry.turn.assistant, event);
      if (event.type === "step.start") entry.turn.step = event.step;
    }

    for (const sub of entry.subscribers) {
      writeEvent(sub.res, stored);
      if (sub.untilTurnEnd && event.type === "run.end" && turnId === sub.untilTurnEnd) {
        if (!sub.res.writableEnded) sub.res.end();
        entry.subscribers.delete(sub);
      }
    }

    // Deltas are never persisted: thousands per turn, and `assistant` carries
    // the full text. Their seq numbers are still spent; readers filter seq > N.
    if (event.type !== "assistant.delta") {
      void store.appendEvent(entry.session.id, stored).catch(() => {});
    }
  };

  const patchSession = async (
    entry: LiveSession,
    patch: SessionPatch & { queue?: QueuedMessage[] },
  ): Promise<void> => {
    entry.session = await store.updateSession(entry.session.id, patch);
    const { queue, ...rest } = patch;
    if (Object.keys(rest).length > 0) publish(entry, { type: "session.updated", patch: rest });
    if (queue) publish(entry, { type: "queue.updated", queue });
  };

  const execute = async (
    entry: LiveSession,
    liveTurn: LiveTurn,
    config: RunConfig,
    tools: Tool[],
  ): Promise<void> => {
    const { turn, controller, gate } = liveTurn;
    const turnId = turn.id;

    const history = projectHistory({
      session: entry.session,
      messages: entry.messages,
      systemPrompt: config.systemPrompt,
      attachments: new Map(), // attachments are inlined from Plan 5 onwards
    });

    // The done gate is built per turn: it runs the reviewer inside this turn,
    // so it needs this turn's signal and permission function. The profile's own
    // tool policy still decides whether a role may claim done at all.
    const profile = config.agent ? getAgent(config.agent) : undefined;
    const loopTools = applyToolPolicy(
      createLoopTools({
        loop: getRegistry().config.loop,
        signal: controller.signal,
        requestPermission: (call) => gate.request(call),
        runTurn,
      }),
      profile?.tools,
    );

    let result: RunResult;
    try {
      result = await runTurn(history, {
        tools: [...tools, ...loopTools],
        model: config.model,
        temperature: config.temperature,
        maxSteps: config.maxSteps,
        signal: controller.signal,
        onEvent: (event) => publish(entry, event, turnId),
        requestPermission: (call) => gate.request(call),
      });
    } catch (error) {
      result = { status: "failed", error: messageOf(error), steps: 0, durationMs: 0 };
    }
    gate.abandon();

    const assistant = fillDangling(liveTurn.assistant);
    const finished: Turn = {
      ...turn,
      status: result.status,
      reason: result.reason,
      error: result.error,
      usage: result.usage,
      durationMs: result.durationMs,
    };

    entry.messages.push(assistant);
    entry.turns.push(finished);
    await store.appendMessage(assistant);
    await store.appendTurn(finished);

    publish(entry, { type: "run.end", ...result, sessionId: entry.session.id, turnId }, turnId);
    publish(entry, { type: "message.completed", message: assistant }, turnId);

    const defaults = {
      ...entry.session.defaults,
      model: config.model,
      ...(config.agent ? { agent: config.agent } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      maxSteps: config.maxSteps,
    };

    const next = result.status === "completed" ? entry.session.queue[0] : undefined;
    if (next) {
      // Dequeue and begin the next turn without ever clearing entry.turn in
      // between — beginTurn() replaces it directly (Task 1). A session is
      // therefore never observably idle between an auto-continued turn and
      // the one before it; see this task's own note above for why that
      // matters and why it isn't proven by a timing-based test.
      // queue.updated (this patchSession call) is published before
      // beginTurn's own message.created, matching design §8's ordering.
      await patchSession(entry, { headId: assistant.id, queue: entry.session.queue.slice(1), defaults });
      await beginTurn(entry, {
        parts: next.parts,
        parentId: next.parentId,
        model: next.model,
        agent: next.agent,
        temperature: next.temperature,
        maxSteps: next.maxSteps,
        messageId: next.id,
      });
    } else {
      entry.turn = undefined;
      await patchSession(entry, { headId: assistant.id, status: "idle", defaults });
    }
  };

  /**
   * Actually begin a turn on an already-validated entry: no busy check, no
   * parentId validation — callers (startTurn below, and the auto-dequeue path
   * Task 2 adds inside execute()) do both first. Always returns the
   * `started: true` variant; the other StartResult variants exist for
   * startTurn's own early returns, not for anything beginTurn itself can hit.
   */
  const beginTurn = async (entry: LiveSession, input: TurnInput): Promise<StartResult> => {
    const id = entry.session.id;
    const config = resolveRunConfig({
      model: input.model ?? entry.session.defaults.model,
      agent: input.agent ?? entry.session.defaults.agent,
      temperature: input.temperature ?? entry.session.defaults.temperature,
      maxSteps: input.maxSteps ?? entry.session.defaults.maxSteps,
    });
    const tools = input.enabledTools
      ? config.tools.filter((t) => input.enabledTools!.includes(t.name))
      : config.tools;

    const now = new Date().toISOString();
    const turnId = randomUUID();
    const parentId = input.parentId === undefined ? entry.session.headId : input.parentId;
    const userMessage: ChatMessage = {
      id: input.messageId ?? randomUUID(),
      sessionId: id,
      parentId,
      role: "user",
      parts: input.parts,
      turnId,
      createdAt: now,
    };
    const assistant: ChatMessage = {
      id: randomUUID(),
      sessionId: id,
      parentId: userMessage.id,
      role: "assistant",
      parts: [],
      turnId,
      createdAt: now,
    };

    entry.messages.push(userMessage);
    await store.appendMessage(userMessage);
    const firstMessage = entry.messages.length === 1;
    await patchSession(entry, {
      headId: userMessage.id,
      status: "running",
      ...(firstMessage && entry.session.title === DEFAULT_TITLE
        ? { title: titleFrom(input.parts) }
        : {}),
    });
    publish(entry, { type: "message.created", message: userMessage }, turnId);

    const turn: Turn = {
      id: turnId,
      sessionId: id,
      userMessageId: userMessage.id,
      assistantMessageId: assistant.id,
      model: config.model,
      agent: config.agent,
      temperature: config.temperature,
      maxSteps: config.maxSteps,
      status: "running",
      startedAt: now,
      durationMs: 0,
    };

    const controller = new AbortController();
    const liveTurn: LiveTurn = {
      turn,
      assistant,
      controller,
      step: 0,
      gate: createGate({
        classify: flatClassifier(getRegistry().gatedTools),
        onAsk: (ask) =>
          publish(entry, {
            type: "permission.ask", step: liveTurn.step, id: ask.id, tool: ask.tool, args: ask.args,
          }, turnId),
        onSettled: (requestId, tool, decision) =>
          publish(entry, {
            type: "permission.resolved", step: liveTurn.step, id: requestId, tool, decision,
          }, turnId),
      }),
      done: Promise.resolve(),
    };
    controller.signal.addEventListener("abort", () => liveTurn.gate.abandon());
    entry.turn = liveTurn; // see execute()'s auto-continue branch (Task 2) for why
    // this line must *replace* entry.turn rather than run after it was cleared
    turnToSession.set(turnId, id);

    publish(entry, {
      type: "run.start",
      runId: turnId,
      query: textOf(input.parts),
      model: config.model,
      startedAt: now,
      sessionId: id,
      turnId,
      userMessageId: userMessage.id,
      assistantMessageId: assistant.id,
    }, turnId);

    liveTurn.done = execute(entry, liveTurn, config, tools).catch((error) => {
      console.error(`[session ${id.slice(0, 8)}] turn crashed:`, messageOf(error));
    });

    return { started: true, turnId, userMessageId: userMessage.id, assistantMessageId: assistant.id };
  };

  const runner: Runner = {
    async createSession(input = {}) {
      const session = await store.createSession({
        title: input.title?.trim() || DEFAULT_TITLE,
        defaults: input.defaults ?? {},
      });
      live.set(session.id, {
        session, messages: [], turns: [], seq: 0, recent: [], subscribers: new Set(),
      });
      return session;
    },

    async listSessions() {
      const stored = await store.listSessions();
      // A session that is live in memory knows its status better than the index.
      return stored.map((s) => {
        const entry = live.get(s.id);
        return entry ? { ...s, status: entry.session.status } : s;
      });
    },

    async getSnapshot(id) {
      const entry = await load(id);
      if (!entry) return null;
      // A local binding keeps the narrowing inside the map callback.
      const live = entry.turn;
      return {
        session: entry.session,
        messages: entry.messages,
        turns: entry.turns,
        seq: entry.seq,
        ...(live
          ? {
              liveTurn: {
                turnId: live.turn.id,
                assistant: live.assistant,
                pendingPermissions: live.gate.pending().map((ask) => ({
                  id: ask.id,
                  step: live.step,
                  tool: ask.tool,
                  args: ask.args,
                })),
              },
            }
          : {}),
      };
    },

    async rename(id, title) {
      const entry = await load(id);
      if (!entry) return null;
      await patchSession(entry, { title: title.trim() || DEFAULT_TITLE });
      return entry.session;
    },

    async setHead(id, messageId) {
      const entry = await load(id);
      if (!entry || entry.turn) return null;
      if (!entry.messages.some((m) => m.id === messageId)) return null;
      await patchSession(entry, { headId: latestLeaf(entry.messages, messageId) });
      return entry.session;
    },

    async deleteSession(id) {
      const entry = await load(id);
      if (!entry) return false;
      if (entry.turn) {
        entry.turn.controller.abort();
        await entry.turn.done;
      }
      for (const sub of entry.subscribers) if (!sub.res.writableEnded) sub.res.end();
      entry.subscribers.clear();
      live.delete(id);
      for (const turn of entry.turns) turnToSession.delete(turn.id);
      await store.deleteSession(id);
      return true;
    },

    async startTurn(id, input) {
      const entry = await load(id);
      if (!entry) return null;
      if (input.parentId && !entry.messages.some((m) => m.id === input.parentId)) {
        return { started: false, reason: "bad-parent" };
      }
      if (entry.turn) {
        const queued: QueuedMessage = {
          id: input.messageId ?? randomUUID(),
          parts: input.parts,
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.agent ? { agent: input.agent } : {}),
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
          queuedAt: new Date().toISOString(),
        };
        await patchSession(entry, { queue: [...entry.session.queue, queued] });
        return { started: false, reason: "queued", queued };
      }
      return beginTurn(entry, input);
    },

    cancel(id) {
      const entry = live.get(id);
      if (!entry?.turn) return false;
      entry.turn.controller.abort();
      return true;
    },

    resolvePermission(id, requestId, decision) {
      const entry = live.get(id);
      return entry?.turn ? entry.turn.gate.resolve(requestId, decision) : false;
    },

    async patchQueueItem(id, msgId, patch) {
      const entry = await load(id);
      if (!entry) return null;
      const idx = entry.session.queue.findIndex((q) => q.id === msgId);
      if (idx === -1) return null;
      const updated: QueuedMessage = { ...entry.session.queue[idx], ...patch };
      const queue = entry.session.queue.slice();
      queue[idx] = updated;
      await patchSession(entry, { queue });
      return updated;
    },

    async removeQueueItem(id, msgId) {
      const entry = await load(id);
      if (!entry) return false;
      const queue = entry.session.queue.filter((q) => q.id !== msgId);
      if (queue.length === entry.session.queue.length) return false;
      await patchSession(entry, { queue });
      return true;
    },

    async sendQueueItem(id, msgId) {
      const entry = await load(id);
      if (!entry) return null;
      const item = entry.session.queue.find((q) => q.id === msgId);
      if (!item) return null;
      if (entry.turn) return { sent: false, reason: "running" };
      await patchSession(entry, { queue: entry.session.queue.filter((q) => q.id !== msgId) });
      const result = await beginTurn(entry, {
        parts: item.parts,
        parentId: item.parentId,
        model: item.model,
        agent: item.agent,
        temperature: item.temperature,
        maxSteps: item.maxSteps,
        messageId: item.id,
      });
      // beginTurn only ever returns started:true here — bad-parent and busy
      // are both already ruled out above — but the type checker doesn't know
      // that, so this narrows explicitly rather than asserting.
      return result.started
        ? { sent: true, turnId: result.turnId, userMessageId: result.userMessageId, assistantMessageId: result.assistantMessageId }
        : { sent: false, reason: "running" };
    },

    async subscribe(id, res, after, untilTurnEnd) {
      const entry = await load(id);
      if (!entry) return false;

      // Backlog older than the in-memory window comes from the store. Nothing
      // else runs between the await resolving and the subscriber being added,
      // so no event can slip through the gap.
      const oldestRecent = entry.recent[0]?.seq ?? Number.POSITIVE_INFINITY;
      const fromStore = after + 1 < oldestRecent ? await store.readEvents(id, after) : [];
      const lastSent = fromStore[fromStore.length - 1]?.seq ?? after;
      for (const event of fromStore) writeEvent(res, event);
      for (const event of entry.recent) if (event.seq > lastSent) writeEvent(res, event);

      if (untilTurnEnd && (!entry.turn || entry.turn.turn.id !== untilTurnEnd)) {
        res.end(); // that turn is already over; the backlog was the whole story
        return true;
      }
      const sub: Subscriber = { res, untilTurnEnd };
      entry.subscribers.add(sub);
      res.on("close", () => entry.subscribers.delete(sub));
      return true;
    },

    async eventsAfter(id, after) {
      const entry = await load(id);
      if (!entry) return [];
      const oldestRecent = entry.recent[0]?.seq ?? Number.POSITIVE_INFINITY;
      if (after + 1 < oldestRecent) return store.readEvents(id, after);
      return entry.recent.filter((e) => e.seq > after);
    },

    sessionForTurn(turnId) {
      return turnToSession.get(turnId);
    },

    async awaitIdle(id) {
      for (;;) {
        const entry = live.get(id);
        if (!entry?.turn) return;
        const current = entry.turn;
        await current.done;
        if (entry.turn === current) return; // no auto-continued turn replaced it
        // else: an auto-continued turn took its place — wait for that one too.
      }
    },

    async recover() {
      for (const summary of await store.listSessions()) {
        if (summary.status !== "running") continue;
        const entry = await load(summary.id);
        if (!entry) continue;
        const turns = entry.turns;
        const lastRunning = [...turns].reverse().find((t) => t.status === "running");
        if (lastRunning) {
          const failed: Turn = { ...lastRunning, status: "failed", error: "harness restarted" };
          entry.turns.push(failed);
          await store.appendTurn(failed);
        }
        await patchSession(entry, { status: "idle" });
      }
    },
  };

  return runner;
};
