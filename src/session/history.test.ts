import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectHistory, renderAttachment } from "./history.js";
import type { ChatMessage, Session } from "./types.js";

const session = (over: Partial<Session> = {}): Session => ({
  id: "s",
  title: "t",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "idle",
  headId: "u2",
  queue: [],
  defaults: {},
  ...over,
});

const messages: ChatMessage[] = [
  {
    id: "u1", sessionId: "s", parentId: null, role: "user", createdAt: "2026-01-01T00:00:01Z",
    parts: [{ type: "text", text: "What time is it?" }],
  },
  {
    id: "a1", sessionId: "s", parentId: "u1", role: "assistant", createdAt: "2026-01-01T00:00:02Z",
    parts: [
      { type: "text", text: "Let me check." },
      { type: "tool_call", callId: "c1", tool: "get_current_time", args: {} },
      { type: "tool_result", callId: "c1", tool: "get_current_time", result: "10:00", isError: false, durationMs: 2 },
      { type: "text", text: "It is 10:00." },
    ],
  },
  {
    id: "u2", sessionId: "s", parentId: "a1", role: "user", createdAt: "2026-01-01T00:00:03Z",
    parts: [{ type: "text", text: "And in Seoul?" }],
  },
  // a branch not on the path — must be ignored
  {
    id: "u2b", sessionId: "s", parentId: "a1", role: "user", createdAt: "2026-01-01T00:00:04Z",
    parts: [{ type: "text", text: "ignored branch" }],
  },
];

describe("projectHistory", () => {
  it("starts with the system prompt and ends with the head user message", () => {
    const out = projectHistory({ session: session(), messages, systemPrompt: "SYS", attachments: new Map() });
    assert.deepEqual(out[0], { role: "system", content: "SYS" });
    assert.deepEqual(out[out.length - 1], { role: "user", content: "And in Seoul?" });
  });

  it("unfolds assistant parts into assistant/tool wire messages in order", () => {
    const out = projectHistory({ session: session(), messages, systemPrompt: "SYS", attachments: new Map() });
    assert.deepEqual(out.slice(1, 6), [
      { role: "user", content: "What time is it?" },
      { role: "assistant", content: "Let me check." },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "get_current_time", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", name: "get_current_time", content: "10:00" },
      { role: "assistant", content: "It is 10:00." },
    ]);
  });

  it("does not include messages off the current branch", () => {
    const out = projectHistory({ session: session(), messages, systemPrompt: "SYS", attachments: new Map() });
    assert.ok(!JSON.stringify(out).includes("ignored branch"));
  });

  it("replaces covered messages with the memory summary", () => {
    const out = projectHistory({
      session: session({
        memory: { summary: "User asked the time; it was 10:00.", coversUpTo: "a1", updatedAt: "x", editedByUser: false },
      }),
      messages, systemPrompt: "SYS", attachments: new Map(),
    });
    assert.deepEqual(out, [
      { role: "system", content: "SYS" },
      { role: "user", content: "[Memory of earlier conversation]\nUser asked the time; it was 10:00." },
      { role: "assistant", content: "Understood." },
      { role: "user", content: "And in Seoul?" },
    ]);
  });

  it("ignores memory whose coversUpTo is not on the current path", () => {
    const out = projectHistory({
      session: session({
        memory: { summary: "other branch", coversUpTo: "u2b", updatedAt: "x", editedByUser: false },
      }),
      messages, systemPrompt: "SYS", attachments: new Map(),
    });
    assert.ok(!JSON.stringify(out).includes("other branch"));
    assert.equal(out.length, 7);
  });

  it("renders attachments after the text", () => {
    const withFile: ChatMessage[] = [
      {
        id: "u1", sessionId: "s", parentId: null, role: "user", createdAt: "2026-01-01T00:00:01Z",
        parts: [
          { type: "text", text: "Review this" },
          { type: "attachment", fileId: "f1", name: "a.ts", mime: "application/typescript", size: 12 },
          { type: "attachment", fileId: "f2", name: "logo.png", mime: "image/png", size: 5000 },
        ],
      },
    ];
    const out = projectHistory({
      session: session({ headId: "u1" }), messages: withFile, systemPrompt: "SYS",
      attachments: new Map([["f1", "const x = 1"]]),
    });
    assert.equal(
      out[1].content,
      "Review this\n\n--- a.ts ---\nconst x = 1\n--- end a.ts ---" +
        "\n\n[attached file: logo.png, image/png, 5000 bytes — binary, not shown]",
    );
  });
});

describe("renderAttachment", () => {
  it("truncates inline text at the cap with a marker", () => {
    const part = { type: "attachment" as const, fileId: "f", name: "big.txt", mime: "text/plain", size: 100 };
    const out = renderAttachment(part, "x".repeat(50), 10);
    assert.equal(out, "\n\n--- big.txt ---\nxxxxxxxxxx\n[truncated: 10 of 50 characters]\n--- end big.txt ---");
  });
});
