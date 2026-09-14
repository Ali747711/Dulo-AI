// src/llm.test.ts
// A provider that accepts the connection and then goes silent must not hang
// the turn (INV-11). Both bounds surface as retryable network failures, so the
// normal attempt loop retries them; a stall after text already reached the
// client is not retried; a caller's own abort is never mistaken for a stall.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";

import { LlmError, callLLM } from "./llm.js";
import type { Message } from "./types.js";

type Mode = "silent" | "trickle" | "one-delta-then-silent";

let server: Server;
let mode: Mode = "silent";
let requests = 0;
const timers = new Set<NodeJS.Timeout>();

const history: Message[] = [{ role: "user", content: "hello" }];

before(async () => {
  server = createServer((req, res) => {
    requests += 1;
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (mode === "trickle") {
        // Keeps the stall timer happy forever; only the total bound can end it.
        const t = setInterval(() => res.write(": keepalive\n\n"), 40);
        timers.add(t);
        res.on("close", () => clearInterval(t));
      } else if (mode === "one-delta-then-silent") {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "par" } }] })}\n\n`);
      }
      // "silent": headers only, never a byte, never an end.
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  process.env.OPENROUTER_URL = `http://127.0.0.1:${port}/v1/chat/completions`;
  process.env.OPENROUTER_API_KEY = "test-key";
});

after(async () => {
  for (const t of timers) clearInterval(t);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("a stream that never sends a byte fails as a retryable stall after the retries", async () => {
  mode = "silent";
  requests = 0;
  // Comfortably above loopback connection time: the suite runs files in
  // parallel, and a budget that can expire before the request is even sent
  // would make this assert on a request the stub never saw.
  process.env.LLM_STALL_MS = "400";
  process.env.LLM_TOTAL_MS = "60000";
  await assert.rejects(callLLM(history, [], { model: "stub" }), (error: unknown) => {
    assert.ok(error instanceof LlmError, `expected LlmError, got ${String(error)}`);
    assert.equal(error.kind, "network");
    assert.equal(error.retryable, true);
    assert.match(error.message, /stalled/i);
    return true;
  });
  assert.equal(requests, 3, "every attempt was retried, then it gave up");
});

test("a stream that trickles keepalives forever fails on the total bound", async () => {
  mode = "trickle";
  requests = 0;
  process.env.LLM_STALL_MS = "5000";
  process.env.LLM_TOTAL_MS = "700";
  await assert.rejects(callLLM(history, [], { model: "stub" }), (error: unknown) => {
    assert.ok(error instanceof LlmError);
    assert.equal(error.kind, "network");
    assert.match(error.message, /exceeded/i);
    return true;
  });
  assert.equal(requests, 3);
});

test("a stall after text already reached the client is not retried", async () => {
  mode = "one-delta-then-silent";
  requests = 0;
  process.env.LLM_STALL_MS = "400";
  process.env.LLM_TOTAL_MS = "60000";
  const deltas: string[] = [];
  await assert.rejects(
    callLLM(history, [], { model: "stub", onDelta: (t) => deltas.push(t) }),
    (error: unknown) => error instanceof LlmError && /stalled/i.test(error.message),
  );
  assert.deepEqual(deltas, ["par"]);
  assert.equal(requests, 1, "no retry once output was shown to the user");
});

test("the caller's own abort is a cancellation, not a stall, and is not retried", async () => {
  mode = "silent";
  requests = 0;
  process.env.LLM_STALL_MS = "60000";
  process.env.LLM_TOTAL_MS = "60000";
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(
    callLLM(history, [], { model: "stub", signal: controller.signal }),
    (error: unknown) => !(error instanceof LlmError) || !/stalled|exceeded/i.test(error.message),
  );
  assert.equal(requests, 1);
});
