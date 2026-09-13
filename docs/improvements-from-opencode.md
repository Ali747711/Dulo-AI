# What Dulo should take from opencode

Source: the opencode monorepo (local clone at `~/Desktop/ai/opencode`), read by five agents on
2026-09-13, one subsystem each: the session loop, tools + permissions, plugins/skills/config,
the LLM provider layer, and the server/client sync layer.

opencode is a large product built on Effect, SQLite/drizzle, a monorepo and an event-sourced
server. **None of that is worth copying.** What is worth copying is the handful of small,
framework-free patterns underneath it. Every item below is scoped to files Dulo already has.

Ordered so each step is useful on its own and nothing depends on a step below it.

---

## Step 1 — Fix what is already broken (half a day, all small) — ✅ DONE 2026-09-13

*All four landed and were verified by running the tools directly and the wrap-up against a
local stub. See `context.md` §4 for the decisions and §8 for what was measured.*

**1.1 The shell tool throws away output exactly when it matters.**
`promisify(execFile)` rejects on any non-zero exit, and the `catch` in `src/tools/system.ts`
(~line 168) only reads `error.message` — it never reads `error.stdout` / `error.stderr`, which
Node attaches to the rejection. So `tsc`, `npm test`, `git` and every other tool that reports
failures on stdout returns `Error: Command failed` and nothing else. The model is told it failed
but not why.
*Fix:* in that catch, format `error.stdout` / `error.stderr` the same way the success path does.
Reserve the error signal for real invocation failures — command not found, timeout — not for a
non-zero exit that produced useful output.

**1.2 Tool failure is detected by reading a string prefix.**
`src/agent.ts:65` does `result.startsWith("Error:")`. The try/catch two lines above already knows
whether the tool threw. Any tool whose legitimate output begins with `Error:` (a log file read, a
grep hit) is misreported as a failure.
*Fix:* let tools `throw` on failure, take `isError` from the catch, delete the prefix check. Add
an optional `error?: { message: string }` to the `tool.result` and `run.end` variants in
`src/events.ts` and mirror it in `client/src/lib/types.ts`.

**1.3 Cancel does not stop a running tool.**
`Tool.execute` in `src/types.ts` takes no signal, so `src/agent.ts` never forwards
`options.signal`. Closing the SSE stream aborts the OpenRouter fetch, but a shell command or an
`http_request` already in flight runs to completion — up to 30s after the UI says "cancelled".
*Fix:* `execute: (args, signal?: AbortSignal) => Promise<string>`. Pass the run's signal through.
In `shell`, `execFile` accepts a signal natively — use
`AbortSignal.any([signal, AbortSignal.timeout(SHELL_TIMEOUT_MS)])`. Same for `http_request`, which
already builds a timeout signal. Short-circuit in `executeTool` if the signal is already aborted.

**1.4 Hitting max steps throws away all the work.**
The loop falls through to `{status: "failed", error: "Reached max steps..."}` while every tool
result sits right there in `messages[]`.
*How opencode does it:* `session/runner/max-steps.ts` — on the last allowed step it re-issues the
request with `toolChoice: "none"` and no tool definitions, plus a fixed prompt asking for a
summary of what was done and what remains.
*Fix:* one extra `callLLM` with `tools: []` and that prompt appended; return its text as the final
answer. Touches only the tail of the existing loop.

## Step 2 — Tools a coding agent actually needs (half a day, all small)

**2.1 `edit_file`** — `write_file` overwrites whole files, so changing one line in a 500-line file
means re-emitting the file and hoping nothing is dropped. opencode's `tool/edit.ts` does exact
string replacement and *rejects* ambiguity rather than guessing: 0 matches is an error, >1 match
without `replaceAll` is an error. Add `src/tools/edit.ts` with `{path, oldString, newString,
replaceAll?}`, reusing `resolveSafe` from `file.ts`. Word the errors so the model can self-correct.

**2.2 `grep_files`** — Dulo can only match file *names* (`glob`). `grep` is in the shell allowlist
but runs without a shell, so no recursion and no globs. Add a JS walk + per-line regex over the
same ignore set `globTool` uses, capped at ~200 matches, formatted `path:` then `  Line N: text`.
Do **not** vendor a ripgrep binary the way opencode does.

**2.3 Cap `read_file`** — it does `readFile(safePath, "utf8")` with no size, line or binary check.
A multi-MB log floods the context window. Add `MAX_READ_BYTES` / `MAX_READ_LINES`, truncate with a
`... (truncated, showing N of M lines)` marker. One-shot truncation is enough; skip opencode's
offset/limit paging API.

## Step 3 — Streaming and resilience in `src/llm.ts` (about a day)

Today `callLLM` does one non-streaming `fetch` with no retry and never reads `usage`.

**3.1 Stream the answer.** Add `stream: true` and read `res.body` with a `TextDecoder`, splitting
on `\n\n` and stripping `data: ` — the same framing `server.ts` already *emits*, so the parsing
idea is not new to the codebase. Forward `choices[0].delta.content` through a new `onDelta`
callback; add `{type: "assistant.delta", step, text}` to `RunEvent` (mirror in the client) and
append it in the client reducer. Keep assembling the full string so `finalAnswer` is unchanged.

**3.2 Accumulate tool-call arguments by index.** Streamed tool calls arrive as JSON *fragments*
across many chunks. Keep a `Map<index, {id, name, argsText}>`, append `function.arguments ?? ""`,
and only emit the assembled `tool_calls` shape at `finish_reason`. Done this way `agent.ts` needs
zero changes. Do this in the same sitting as 3.1 or streaming will break tool use.

**3.3 Classify failures, then retry only the transient ones.** opencode's `route/executor.ts`
tags every failure with its own `retryable` flag. Add `classifyFailure(status, body, headers)`
returning `rate-limit | server | auth | context-overflow | invalid` plus `retryable` and
`retryAfterMs`. Retry twice with jittered exponential backoff capped at 10s, honoring
`Retry-After`. Check `signal.aborted` before each sleep. Keep the existing OpenRouter
`{error:{code:429}}` daily-cap body *outside* the retry — that one is not transient and retrying
only triples the wasted wall-clock time.

**3.4 Read `usage`.** OpenRouter already returns `prompt_tokens` / `completion_tokens` on every
call and Dulo ignores it. Return it from `callLLM`, sum across steps, add the totals to
`RunResult` and the `run.end` event. With streaming on, add
`stream_options: {include_usage: true}`.

## Step 4 — A run should outlive its HTTP connection (about a day)

**4.1 Decouple the run.** `res.on("close")` currently aborts the controller, so a refresh or a
wifi blip kills the run. Add `runs = new Map<string, RunHandle>()` where a handle holds
`{events[], status, controller, subscribers: Set<ServerResponse>}`. `close` should only drop that
response from `subscribers`. Cancellation becomes an explicit `POST /api/run/:id/cancel`.

**4.2 Seq + append-only log + reconnect.** opencode solves reconnect once, at the storage layer:
events carry a monotonic `seq`, and both history and live tail are wrappers over the same
"everything after seq N, then subscribe" primitive. Dulo's version: add `seq` to every `RunEvent`,
append each as one JSON line to `runs/<runId>.jsonl` (gitignored), and serve
`GET /api/run/:id/stream?after=<seq>` from the in-memory array when the run is live and from the
file otherwise. Be honest about the limit — this survives a *client* disconnect, not a `tsx watch`
restart. Do not persist a line per token; log step/tool/final milestones only.

**4.3 Client reconnect loop.** `streamRun` makes exactly one fetch; if the stream ends without
`run.end` the run is stuck at "running" forever. Track the highest seq seen and reconnect with
backoff (1s, 2s, 4s, capped ~30s) until `run.end` or an explicit cancel.

**4.4 `GET /api/runs`** — run history currently lives only in one browser's localStorage. Back it
with the same log, plus a small `runs/index.json` so listing doesn't open every file.

## Step 5 — Extensibility, cheaply (about a day)

The real lesson from opencode's plugin system is that underneath the Effect machinery it is just
**glob a folder, `import()` each file, read a default export**. Everything else is Markdown.

**5.1 `tools/custom/*.ts`** — glob and `await import(pathToFileURL(f).href)` at startup, require a
default export matching the existing `Tool` type, try/catch each so one bad file doesn't kill the
harness. `tsx` already runs TS at runtime, so there is no build step. Dulo's `Tool` type is
*already* as simple as opencode's — the gap is only discovery.

**5.2 `dulo.config.json`** — one field, `{"disabledTools": [...]}`, read once in
`src/tools/index.ts`. Deliberately skip opencode's global-dir + walk-up-to-root merge; Dulo is one
repo for one developer.

**5.3 `skills/*.md`** — the pattern worth stealing: only the frontmatter `name` + `description`
ever reaches the system prompt; the body loads on demand through a `load_skill({name})` tool. That
is how you add situational instructions without paying for them on every request. Parse with
`gray-matter` (what opencode uses).

**5.4 `agents/*.md`** — frontmatter (`model?`, `tools?` with `"*": false` meaning deny-by-default)
plus a body that replaces `SYSTEM_PROMPT`. Lets a named persona be committed to the repo instead
of re-specified by the client on every call.

**5.5 MCP** — reading opencode's `config/mcp.ts` and `session/tools.ts` **confirms the plan already
written in `docs/mcp-research.md`**: same SDK, same stdio + HTTP shapes, same name prefixing. Two
details to lock in: connect once at process startup (not per request), and merge the results into
the *same* `Tool[]` array `src/tools/index.ts` exports, so `agent.ts` needs no changes at all.
Start without OAuth. Do 5.1 first.

## Step 6 — The bigger ones, once the above is in

**6.1 Permission gate (the highest-value item in this document, and the largest).**
Dulo has no approval step. `enabledTools` is chosen once before the run starts, and by the time a
`tool.call` event reaches the browser the shell command or file write has *already run*.
*How opencode does it:* a pending-promise map. `PermissionV2.assert` parks a deferred keyed by
request id, publishes an "asked" event, and a client reply resolves it by id; an "always" answer
records a rule so later matching calls skip the prompt.
*Dulo's version:* before a sensitive tool (`shell`, `write_file`, `edit_file`, `http_request`),
emit `{type: "permission.ask", id, tool, args}` and return a promise. Keep
`Map<id, {resolve}>` on the run handle; add `POST /api/run/:id/permission/:pid/reply` with
`{decision: "allow" | "deny" | "always"}`. "always" adds the tool name to an in-memory `Set` for
the rest of that run. No rule language, no wildcards, no database.

**6.2 `manage_todos` tool** — opencode's todo tool gets no special treatment in the loop at all;
it is an ordinary tool that echoes its input back. Its whole value is giving the model a typed
slot to externalize a plan that the UI can render as a checklist. Add the tool, then special-case
its rendering in the Playground. No new event type needed.

**6.3 Token budget guard** — `messages[]` grows every step with zero accounting. Estimate with
`JSON.stringify(messages).length / 4`, compare to a conservative constant (~24k), and on overflow
keep the system prompt, the original query and the last 2–3 steps verbatim while collapsing older
messages by plain truncation. Save opencode's LLM-generated running summary for when Dulo has
real multi-turn sessions.

---

## Explicitly not adopting

Effect, in any form — it is the substrate of all five subsystems and none of its benefits apply at
one process, one run, one developer. SQLite/drizzle and the event-sourcing projector split. The
monorepo, Bun, turborepo, SST. The `run-coordinator` / FiberSet concurrency machinery. "Context
epochs" (a cached versioned system-prompt baseline keyed to a DB event log — solves a problem Dulo
does not have). `revert.ts` filesystem snapshots — Dulo's only mutating tool is `write_file` and
there is nothing worth undoing yet. The `apply_patch` multi-file patch DSL — a single-file
`edit_file` called several times per turn already works, since Dulo executes tool calls
concurrently. A vendored per-platform ripgrep binary. The models.dev capability registry. Streaming
tool-call *argument* deltas character by character. MCP OAuth. The plugin hot-reload host —
`tsx watch` already restarts the process on every file change. The full allow/deny/ask wildcard
ruleset — that matters once there are multiple agent profiles with different trust levels.

## Progress

- **Step 1 — done** (2026-09-13).
- **Next: step 2.** Three small, independent tools (`edit_file`, `grep_files`, capped
  `read_file`). It is the cheapest step remaining and the one that most changes what the agent
  can actually do, now that step 1 made the shell's failures readable.
