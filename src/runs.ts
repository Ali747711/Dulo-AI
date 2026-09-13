// src/runs.ts
// A run's life is owned here, not by the HTTP response that started it.
// Every event gets a monotonic seq and is appended to runs/<id>.jsonl, so a
// client that drops its connection can ask for "everything after seq N" and
// carry on. This survives a browser refresh, a sleeping laptop or a lost wifi
// connection. It does NOT survive restarting the harness process itself, which
// takes the running agent loop with it.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import path from "node:path";

import type { RunEvent, RunStatus, StoredEvent } from "./events.js";
import type { Gate } from "./permissions.js";

const RUNS_DIR = path.join(process.cwd(), "runs");
const INDEX_FILE = path.join(RUNS_DIR, "index.json");
/** Finished runs kept in memory for instant replay; the log file is the record. */
const MAX_REMEMBERED = 50;
const MAX_INDEXED = 200;

export type RunState = "running" | RunStatus;

export interface RunSummary {
  id: string;
  query: string;
  model: string;
  startedAt: string;
  status: RunState;
  steps: number;
  durationMs: number;
}

export interface RunHandle extends RunSummary {
  events: StoredEvent[];
  /** Set by the server once the run starts; answers arrive out of band. */
  gate?: Gate;
  controller: AbortController;
  subscribers: Set<ServerResponse>;
  seq: number;
  /** Serialises appends so two events cannot interleave inside one line. */
  writes: Promise<void>;
}

const live = new Map<string, RunHandle>();

const logPath = (id: string): string => path.join(RUNS_DIR, `${id}.jsonl`);

export const ensureRunsDir = (): Promise<string | undefined> =>
  mkdir(RUNS_DIR, { recursive: true });

const writeTo = (res: ServerResponse, chunk: string): void => {
  if (!res.writableEnded && !res.destroyed) res.write(chunk);
};

const sendEvent = (res: ServerResponse, event: StoredEvent): void => {
  writeTo(res, `data: ${JSON.stringify(event)}\n\n`);
};

/**
 * Text deltas are the one event type deliberately left out of the log: they can
 * be thousands per run, and the "assistant" event that follows carries the same
 * text in full. Seq numbers are still spent on them, so a replayed log has gaps
 * in its seq sequence — harmless, because readers only ever filter on seq > N.
 */
const isDurable = (event: RunEvent): boolean => event.type !== "assistant.delta";

export const createRun = (input: {
  query: string;
  model: string;
}): RunHandle => {
  const id = randomUUID();
  const handle: RunHandle = {
    id,
    query: input.query,
    model: input.model,
    startedAt: new Date().toISOString(),
    status: "running",
    steps: 0,
    durationMs: 0,
    events: [],
    controller: new AbortController(),
    subscribers: new Set(),
    seq: 0,
    writes: Promise.resolve(),
  };
  live.set(id, handle);
  publish(handle, {
    type: "run.start",
    runId: id,
    query: input.query,
    model: input.model,
    startedAt: handle.startedAt,
  });
  return handle;
};

export const publish = (handle: RunHandle, event: RunEvent): void => {
  const stored: StoredEvent = { ...event, seq: ++handle.seq };
  handle.events.push(stored);

  if (event.type === "step.start") handle.steps = event.step;
  if (event.type === "run.end") {
    handle.status = event.status;
    handle.durationMs = event.durationMs;
    handle.steps = event.steps;
  }

  for (const res of handle.subscribers) sendEvent(res, stored);

  if (isDurable(event)) {
    handle.writes = handle.writes
      .then(() => appendFile(logPath(handle.id), `${JSON.stringify(stored)}\n`, "utf8"))
      .catch(() => {
        // A failed append must not take the run down; the live stream is intact
        // and only reconnect-after-restart loses anything.
      });
  }
};

/** Attach a response to a run: backlog first, then live events if still going. */
export const subscribe = (
  handle: RunHandle,
  res: ServerResponse,
  after = 0,
): void => {
  for (const event of handle.events) {
    if (event.seq > after) sendEvent(res, event);
  }
  if (handle.status !== "running") {
    res.end();
    return;
  }
  handle.subscribers.add(res);
  res.on("close", () => handle.subscribers.delete(res));
};

export const finish = async (handle: RunHandle): Promise<void> => {
  await handle.writes;
  for (const res of handle.subscribers) {
    if (!res.writableEnded) res.end();
  }
  handle.subscribers.clear();
  await indexRun(handle);
  forgetOldest();
};

/** Cancel a run by id. Returns false when the id is unknown or already done. */
export const cancelRun = (id: string): boolean => {
  const handle = live.get(id);
  if (!handle || handle.status !== "running") return false;
  handle.controller.abort();
  return true;
};

export const getRun = (id: string): RunHandle | undefined => live.get(id);

/** Replay a finished run from its log file, for runs no longer in memory. */
export const readRunLog = async (id: string): Promise<StoredEvent[] | null> => {
  try {
    const raw = await readFile(logPath(id), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as StoredEvent);
  } catch {
    return null;
  }
};

const summaryOf = (handle: RunHandle): RunSummary => ({
  id: handle.id,
  query: handle.query,
  model: handle.model,
  startedAt: handle.startedAt,
  status: handle.status,
  steps: handle.steps,
  durationMs: handle.durationMs,
});

const readIndex = async (): Promise<RunSummary[]> => {
  try {
    const raw = await readFile(INDEX_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunSummary[]) : [];
  } catch {
    return [];
  }
};

let indexWrites: Promise<void> = Promise.resolve();

const indexRun = (handle: RunHandle): Promise<void> => {
  indexWrites = indexWrites
    .then(async () => {
      const existing = await readIndex();
      const next = [
        summaryOf(handle),
        ...existing.filter((r) => r.id !== handle.id),
      ].slice(0, MAX_INDEXED);
      await writeFile(INDEX_FILE, JSON.stringify(next, null, 2), "utf8");
    })
    .catch(() => {
      // Listing history is a convenience; never fail a run over it.
    });
  return indexWrites;
};

/** Newest first: live runs, then whatever the index remembers. */
export const listRuns = async (): Promise<RunSummary[]> => {
  const inMemory = [...live.values()].map(summaryOf);
  const indexed = await readIndex();
  const seen = new Set(inMemory.map((r) => r.id));
  return [...inMemory, ...indexed.filter((r) => !seen.has(r.id))].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
};

const forgetOldest = (): void => {
  const finished = [...live.values()].filter((h) => h.status !== "running");
  if (finished.length <= MAX_REMEMBERED) return;
  finished
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(0, finished.length - MAX_REMEMBERED)
    .forEach((h) => live.delete(h.id));
};
