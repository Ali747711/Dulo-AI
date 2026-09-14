// src/permissions.test.ts
// The gate turns a risk tier into a question, or into silence. The rules it
// must not break: allowed never interrupts, and confirm can never be waved
// through — not by a previous "always", not by any answer to another tool.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createGate, type Gate } from "./permissions.js";
import type { RiskAssessment, RiskTier } from "./risk.js";

const risk = (tier: RiskTier): RiskAssessment => ({
  tier,
  what: `Dulo wants to do a ${tier} thing`,
  where: "somewhere",
  undo: "some undo text",
});

interface Harness {
  gate: Gate;
  asked: string[];
  auto: string[];
  settled: [string, string][];
}

const harness = (tierFor: (tool: string) => RiskTier, timeoutMs = 50_000): Harness => {
  const asked: string[] = [];
  const auto: string[] = [];
  const settled: [string, string][] = [];
  const gate = createGate({
    classify: (tool) => risk(tierFor(tool)),
    onAsk: (ask) => asked.push(ask.tool),
    onAuto: (ask) => auto.push(ask.tool),
    onSettled: (_id, tool, decision) => settled.push([tool, decision]),
    timeoutMs,
  });
  return { gate, asked, auto, settled };
};

/** Answer the one request that is waiting, once it exists. */
const answer = async (h: Harness, id: string, decision: "allow" | "deny" | "always") => {
  for (let i = 0; i < 50 && h.gate.pending().length === 0; i++) {
    await new Promise((r) => setTimeout(r, 2));
  }
  return h.gate.resolve(id, decision);
};

test("allowed runs immediately, never parks, never asks (INV-20)", async () => {
  const h = harness(() => "allowed");
  const results = await Promise.all(
    ["read_file", "write_file", "dev_server"].map((tool, i) =>
      h.gate.request({ id: `a${i}`, tool, args: {} }),
    ),
  );
  assert.deepEqual(results, [true, true, true]);
  assert.deepEqual(h.asked, [], "nothing was asked");
  assert.deepEqual(h.auto, ["read_file", "write_file", "dev_server"], "each was recorded as automatic");
  assert.deepEqual(h.gate.pending(), []);
});

test("ask parks until answered, and carries the plain-language fields", async () => {
  const h = harness(() => "ask");
  const pending = h.gate.request({ id: "x1", tool: "http_request", args: { url: "https://x" } });
  await new Promise((r) => setTimeout(r, 5));

  const [waiting] = h.gate.pending();
  assert.equal(waiting.tool, "http_request");
  assert.equal(waiting.tier, "ask");
  assert.match(waiting.what, /Dulo wants to/);
  assert.ok(waiting.undo.length > 0);

  assert.equal(h.gate.resolve("x1", "allow"), true);
  assert.equal(await pending, true);
  assert.deepEqual(h.settled, [["http_request", "allow"]]);
});

test('"always" silences later asks for that tool, in this turn only (AC-20)', async () => {
  const h = harness(() => "ask");
  const first = h.gate.request({ id: "b1", tool: "http_request", args: {} });
  await answer(h, "b1", "always");
  assert.equal(await first, true);

  // Same tool again: no prompt at all.
  assert.equal(await h.gate.request({ id: "b2", tool: "http_request", args: {} }), true);
  assert.deepEqual(h.asked, ["http_request"], "asked exactly once");

  // A different tool still asks.
  const other = h.gate.request({ id: "b3", tool: "dns_lookup", args: {} });
  await answer(h, "b3", "allow");
  assert.equal(await other, true);
  assert.deepEqual(h.asked, ["http_request", "dns_lookup"]);
});

test('"always" covers the kind of action approved, not everything the tool can do', async () => {
  // One "always" on `shell` must not bless every future shell command: the
  // gate keys the shortcut by what was actually approved.
  const h = harness(() => "ask");
  const approve = async (id: string, tool: string, what: string) => {
    const pending = h.gate.request({ id, tool, args: { what } });
    await answer(h, id, "always");
    return pending;
  };

  // The classifier here distinguishes by args, as the real one does.
  const gate = createGate({
    classify: (tool, args) => ({
      tier: "ask",
      what: `Dulo wants to run ${String(args.command)}`,
      where: String(args.command),
      undo: "x",
    }),
    onAsk: (ask) => h.asked.push(ask.what),
    onAuto: () => {},
    onSettled: () => {},
  });

  const first = gate.request({ id: "k1", tool: "shell", args: { command: "node a.js" } });
  for (let i = 0; i < 50 && gate.pending().length === 0; i++) await new Promise((r) => setTimeout(r, 2));
  gate.resolve("k1", "always");
  assert.equal(await first, true);

  // The same command again: no prompt.
  assert.equal(await gate.request({ id: "k2", tool: "shell", args: { command: "node a.js" } }), true);

  // A different command through the same tool must still ask.
  const different = gate.request({ id: "k3", tool: "shell", args: { command: "node b.js" } });
  for (let i = 0; i < 50 && gate.pending().length === 0; i++) await new Promise((r) => setTimeout(r, 2));
  assert.equal(gate.pending().length, 1, "a different command asks again");
  gate.resolve("k3", "deny");
  assert.equal(await different, false);

  await approve("k9", "other", "unused").catch(() => {});
});

test("confirm asks every time, and no answer ever waves it through (INV-19)", async () => {
  const tiers: Record<string, RiskTier> = { deploy: "confirm", fetchit: "ask" };
  const h = harness((tool) => tiers[tool] ?? "ask");

  // Say "always" to everything that is merely ask.
  const warmup = h.gate.request({ id: "c0", tool: "fetchit", args: {} });
  await answer(h, "c0", "always");
  await warmup;

  // Three confirms: three prompts, whatever was answered before.
  for (const id of ["c1", "c2", "c3"]) {
    const pending = h.gate.request({ id, tool: "deploy", args: {} });
    await answer(h, id, "always"); // even answering "always" here
    assert.equal(await pending, true);
  }
  assert.deepEqual(
    h.asked.filter((t) => t === "deploy").length,
    3,
    "a confirm is asked every single time",
  );

  // And "always" on a confirm did not leak into a later one.
  const last = h.gate.request({ id: "c4", tool: "deploy", args: {} });
  await answer(h, "c4", "deny");
  assert.equal(await last, false);
  assert.equal(h.asked.filter((t) => t === "deploy").length, 4);
});

test("deny and timeout both mean no", async () => {
  const h = harness(() => "ask", 30);
  const denied = h.gate.request({ id: "d1", tool: "http_request", args: {} });
  await answer(h, "d1", "deny");
  assert.equal(await denied, false);

  const timedOut = await h.gate.request({ id: "d2", tool: "dns_lookup", args: {} });
  assert.equal(timedOut, false, "nobody answered, so it did not run");
  assert.ok(h.settled.some(([, decision]) => decision === "timeout"));
});

test("a classifier that throws means confirm, never silent permission", async () => {
  const asked: string[] = [];
  const gate = createGate({
    classify: () => {
      throw new Error("bad arguments");
    },
    onAsk: (ask) => asked.push(ask.what),
    onAuto: () => {},
    onSettled: () => {},
  });
  const pending = gate.request({ id: "e1", tool: "mystery", args: {} });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(gate.pending().length, 1, "it parked rather than running");
  assert.equal(gate.pending()[0].tier, "confirm");
  assert.match(asked[0], /could not/i);
  gate.resolve("e1", "deny");
  assert.equal(await pending, false);
});

test("abandon denies everything still waiting", async () => {
  const h = harness(() => "ask");
  const a = h.gate.request({ id: "f1", tool: "one", args: {} });
  const b = h.gate.request({ id: "f2", tool: "two", args: {} });
  await new Promise((r) => setTimeout(r, 5));
  h.gate.abandon();
  assert.deepEqual(await Promise.all([a, b]), [false, false]);
  assert.deepEqual(h.gate.pending(), []);
});

test("resolving an unknown or already-settled id says so", async () => {
  const h = harness(() => "ask");
  assert.equal(h.gate.resolve("nope", "allow"), false);
  const pending = h.gate.request({ id: "g1", tool: "one", args: {} });
  await answer(h, "g1", "allow");
  await pending;
  assert.equal(h.gate.resolve("g1", "allow"), false, "settled once only");
});

test("the three approval modes map to the right questions (AC-22)", async () => {
  const { classifierFor } = await import("./registry.js");
  const { DEFAULT_GATED_TOOLS: gated } = await import("./permissions.js");

  const tiersOf = (approval: Parameters<typeof classifierFor>[0]) => {
    const classify = classifierFor(approval, gated);
    return {
      build: classify("shell", { command: "npm run build" }).tier,
      code: classify("shell", { command: "node x.js" }).tier,
      write: classify("write_file", { path: "a.txt" }).tier,
      del: classify("remove_path", { path: "src", recursive: true }).tier,
      read: classify("read_file", { path: "a.txt" }).tier,
    };
  };

  const base = { allowTools: [], confirmTools: [], gateMcpTools: true };

  assert.deepEqual(
    tiersOf({ ...base, mode: "tiers" }),
    { build: "allowed", code: "ask", write: "allowed", del: "confirm", read: "allowed" },
    "tiers judges the arguments",
  );

  assert.deepEqual(
    tiersOf({ ...base, mode: "ask" }),
    { build: "ask", code: "ask", write: "ask", del: "ask", read: "allowed" },
    "ask is the older flat policy: every gated name asks, nothing confirms",
  );

  assert.deepEqual(
    tiersOf({ ...base, mode: "auto" }),
    { build: "allowed", code: "allowed", write: "allowed", del: "allowed", read: "allowed" },
    "auto asks nothing at all",
  );

  assert.deepEqual(
    tiersOf({ ...base, mode: "tiers", confirmTools: ["write_file"], allowTools: ["dns_lookup"] }),
    { build: "allowed", code: "ask", write: "confirm", del: "confirm", read: "allowed" },
    "overrides reach the gate through the registry too",
  );
  assert.equal(
    classifierFor({ ...base, mode: "tiers", allowTools: ["dns_lookup"] }, gated)("dns_lookup", {}).tier,
    "allowed",
  );
});
