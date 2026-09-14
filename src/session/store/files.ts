// src/session/store/files.ts
// JSON Lines under sessions/. Append-only logs for messages, turns and events;
// session.json and index.json are rewritten on change. Writes for one session
// are serialised through a promise chain so two lines cannot interleave, the
// same way src/runs.ts did.
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { SESSIONS_DIR } from "../../paths.js";

import type { SessionStore, StoredFile } from "../store.js";
import type {
  ChatMessage,
  Session,
  SessionEvent,
  SessionSummary,
  Turn,
  TurnSettings,
} from "../types.js";

const MAX_INDEXED = 500;

const readJsonLines = async <T>(file: string): Promise<T[]> => {
  try {
    const raw = await readFile(file, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
};

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
};

export class FileSessionStore implements SessionStore {
  private readonly chains = new Map<string, Promise<void>>();
  private indexChain: Promise<void> = Promise.resolve();

  constructor(private readonly root = SESSIONS_DIR) {}

  private dir(id: string): string {
    return path.join(this.root, id);
  }
  private file(id: string, name: string): string {
    return path.join(this.dir(id), name);
  }

  /** Run `fn` after every earlier write to this session has finished. */
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(id, next.then(() => undefined, () => undefined));
    return next;
  }

  private async readIndex(): Promise<SessionSummary[]> {
    return (await readJson<SessionSummary[]>(path.join(this.root, "index.json"))) ?? [];
  }

  private updateIndex(
    id: string,
    change: (entry: SessionSummary | undefined) => SessionSummary | null,
  ): Promise<void> {
    this.indexChain = this.indexChain
      .then(async () => {
        const existing = await this.readIndex();
        const current = existing.find((s) => s.id === id);
        const next = change(current);
        const rest = existing.filter((s) => s.id !== id);
        const merged = (next ? [next, ...rest] : rest)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, MAX_INDEXED);
        await mkdir(this.root, { recursive: true });
        await writeFile(path.join(this.root, "index.json"), JSON.stringify(merged, null, 2), "utf8");
      })
      .catch(() => {
        // The index is a listing convenience; never fail a write over it.
      });
    return this.indexChain;
  }

  private async writeSession(session: Session): Promise<void> {
    await mkdir(this.dir(session.id), { recursive: true });
    await writeFile(this.file(session.id, "session.json"), JSON.stringify(session, null, 2), "utf8");
  }

  async createSession(input: { title: string; defaults?: TurnSettings }): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      title: input.title,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      headId: null,
      queue: [],
      defaults: input.defaults ?? {},
    };
    await this.serial(session.id, () => this.writeSession(session));
    await this.updateIndex(session.id, () => ({
      id: session.id,
      title: session.title,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      messageCount: 0,
    }));
    return session;
  }

  getSession(id: string): Promise<Session | null> {
    return readJson<Session>(this.file(id, "session.json"));
  }

  async listSessions(): Promise<SessionSummary[]> {
    return (await this.readIndex()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateSession(
    id: string,
    patch: Partial<Pick<Session, "title" | "headId" | "status" | "memory" | "queue" | "defaults">>,
  ): Promise<Session> {
    const updated = await this.serial(id, async () => {
      const current = await this.getSession(id);
      if (!current) throw new Error(`no session ${id}`);
      const next: Session = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await this.writeSession(next);
      return next;
    });
    await this.updateIndex(id, (entry) => ({
      id,
      title: updated.title,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      status: updated.status,
      messageCount: entry?.messageCount ?? 0,
      ...(entry?.lastModel ? { lastModel: entry.lastModel } : {}),
    }));
    return updated;
  }

  async deleteSession(id: string): Promise<void> {
    await this.serial(id, () => rm(this.dir(id), { recursive: true, force: true }));
    await this.updateIndex(id, () => null);
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    await this.serial(message.sessionId, () =>
      appendFile(this.file(message.sessionId, "messages.jsonl"), `${JSON.stringify(message)}\n`, "utf8"),
    );
    await this.updateIndex(message.sessionId, (entry) =>
      entry ? { ...entry, messageCount: entry.messageCount + 1, updatedAt: message.createdAt } : entry ?? null,
    );
  }

  getMessages(sessionId: string): Promise<ChatMessage[]> {
    return readJsonLines<ChatMessage>(this.file(sessionId, "messages.jsonl"));
  }

  async appendTurn(turn: Turn): Promise<void> {
    await this.serial(turn.sessionId, () =>
      appendFile(this.file(turn.sessionId, "turns.jsonl"), `${JSON.stringify(turn)}\n`, "utf8"),
    );
    await this.updateIndex(turn.sessionId, (entry) =>
      entry ? { ...entry, lastModel: turn.model } : entry ?? null,
    );
  }

  getTurns(sessionId: string): Promise<Turn[]> {
    return readJsonLines<Turn>(this.file(sessionId, "turns.jsonl"));
  }

  appendEvent(sessionId: string, event: SessionEvent): Promise<void> {
    return this.serial(sessionId, () =>
      appendFile(this.file(sessionId, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8"),
    );
  }

  async readEvents(sessionId: string, after: number): Promise<SessionEvent[]> {
    const all = await readJsonLines<SessionEvent>(this.file(sessionId, "events.jsonl"));
    return all.filter((e) => e.seq > after);
  }

  async putFile(
    sessionId: string,
    file: { name: string; mime: string; bytes: Buffer },
  ): Promise<StoredFile> {
    const fileId = randomUUID();
    const meta: StoredFile & { uploadedAt: string } = {
      fileId,
      name: file.name,
      mime: file.mime,
      size: file.bytes.length,
      uploadedAt: new Date().toISOString(),
    };
    await this.serial(sessionId, async () => {
      const dir = this.file(sessionId, "files");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, fileId), file.bytes);
      await writeFile(path.join(dir, `${fileId}.json`), JSON.stringify(meta), "utf8");
    });
    const { uploadedAt: _ignored, ...stored } = meta;
    return stored;
  }

  async getFile(
    sessionId: string,
    fileId: string,
  ): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
    if (!/^[\w-]{1,64}$/.test(fileId)) return null; // never let an id walk the tree
    const dir = this.file(sessionId, "files");
    const meta = await readJson<StoredFile>(path.join(dir, `${fileId}.json`));
    if (!meta) return null;
    try {
      const bytes = await readFile(path.join(dir, fileId));
      return { name: meta.name, mime: meta.mime, bytes };
    } catch {
      return null;
    }
  }
}
