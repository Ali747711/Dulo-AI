import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { FileSessionStore } from "./files.js";
import type { ChatMessage, SessionEvent, Turn } from "../types.js";

let dir: string;
let store: FileSessionStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dulo-store-"));
  store = new FileSessionStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const message = (sessionId: string, id: string, parentId: string | null): ChatMessage => ({
  id, sessionId, parentId, role: "user", parts: [{ type: "text", text: id }],
  createdAt: new Date().toISOString(),
});

describe("FileSessionStore", () => {
  it("creates, reads, lists and updates a session", async () => {
    const s = await store.createSession({ title: "First", defaults: { model: "m" } });
    assert.equal(s.status, "idle");
    assert.equal(s.headId, null);
    assert.deepEqual(s.queue, []);

    const again = await store.getSession(s.id);
    assert.deepEqual(again, s);

    const updated = await store.updateSession(s.id, { title: "Renamed", headId: "x" });
    assert.equal(updated.title, "Renamed");
    assert.equal(updated.headId, "x");
    assert.ok(updated.updatedAt >= s.updatedAt);

    const list = await store.listSessions();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Renamed");
    assert.equal(list[0].messageCount, 0);
  });

  it("lists newest first", async () => {
    const a = await store.createSession({ title: "a" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.createSession({ title: "b" });
    const list = await store.listSessions();
    assert.deepEqual(list.map((s) => s.id), [b.id, a.id]);
  });

  it("returns null for an unknown session", async () => {
    assert.equal(await store.getSession("nope"), null);
  });

  it("appends and reads messages in order, and counts them", async () => {
    const s = await store.createSession({ title: "t" });
    await store.appendMessage(message(s.id, "u1", null));
    await store.appendMessage(message(s.id, "a1", "u1"));
    const got = await store.getMessages(s.id);
    assert.deepEqual(got.map((m) => m.id), ["u1", "a1"]);
    assert.equal((await store.listSessions())[0].messageCount, 2);
  });

  it("appends and reads turns, recording the last model", async () => {
    const s = await store.createSession({ title: "t" });
    const turn: Turn = {
      id: "t1", sessionId: s.id, userMessageId: "u1", assistantMessageId: "a1", model: "gpt-x",
      status: "completed", startedAt: new Date().toISOString(), durationMs: 10,
    };
    await store.appendTurn(turn);
    assert.deepEqual(await store.getTurns(s.id), [turn]);
    assert.equal((await store.listSessions())[0].lastModel, "gpt-x");
  });

  it("appends events and reads them after a seq", async () => {
    const s = await store.createSession({ title: "t" });
    const ev = (seq: number): SessionEvent => ({ type: "step.start", step: seq, sessionId: s.id, seq });
    await Promise.all([store.appendEvent(s.id, ev(1)), store.appendEvent(s.id, ev(2)), store.appendEvent(s.id, ev(3))]);
    assert.deepEqual((await store.readEvents(s.id, 1)).map((e) => e.seq), [2, 3]);
    assert.deepEqual(await store.readEvents(s.id, 3), []);
  });

  it("stores and returns files", async () => {
    const s = await store.createSession({ title: "t" });
    const put = await store.putFile(s.id, { name: "a.txt", mime: "text/plain", bytes: Buffer.from("hello") });
    assert.equal(put.size, 5);
    const got = await store.getFile(s.id, put.fileId);
    assert.equal(got?.name, "a.txt");
    assert.equal(got?.bytes.toString("utf8"), "hello");
    assert.equal(await store.getFile(s.id, "missing"), null);
  });

  it("deletes a session and everything under it", async () => {
    const s = await store.createSession({ title: "t" });
    await store.appendMessage(message(s.id, "u1", null));
    await store.deleteSession(s.id);
    assert.equal(await store.getSession(s.id), null);
    assert.deepEqual(await store.getMessages(s.id), []);
    assert.deepEqual(await store.listSessions(), []);
  });

  it("survives a fresh instance reading the same directory", async () => {
    const s = await store.createSession({ title: "persist" });
    await store.appendMessage(message(s.id, "u1", null));
    const reopened = new FileSessionStore(dir);
    assert.equal((await reopened.getSession(s.id))?.title, "persist");
    assert.equal((await reopened.listSessions())[0].messageCount, 1);
  });
});
