# Pipeline Canvas — Design

A Phaser-rendered view of Dulo's own execution: the agent loop drawn as a
conveyor, one belt segment per turn, animating live and replayable after the
fact.

**Status:** designed, not implemented · **Date:** 2026-09-13 · **Author:** brainstormed with the owner

---

## 1. Goal

Dulo can already *tell* you what it did (Playground's step list, the TUI's
transcript). Neither shows **shape**: which tools ran in parallel, which one
dominated the wall clock, where a run sat waiting on a permission gate. The
Canvas answers those at a glance, and is meant to be genuinely nice to look at
— a surface worth leaving open while the agent works.

Secondary goal, stated by the owner: learn Phaser on a real problem.

## 2. Settled decisions

These came out of the brainstorm and are not open for re-litigation during
implementation.

| Decision | Choice |
| --- | --- |
| What Phaser renders | Dulo's own runs, not games and not agent-built content |
| Character of the view | Readable **and** beautiful — real structure, animated well |
| Metaphor | Pipeline / conveyor: `LLM → tools → LLM → answer` |
| Placement | New sidebar page ("Canvas") with a run picker; Playground untouched |
| Scene scope | The **whole session**, turns chained on one horizontally panning belt |
| Layer split | Phaser owns motion; DOM owns inspection (approach B below) |
| Phaser version | **4.2.1** (latest). Accepted cost: most tutorials online are Phaser 3 |
| Client tests | Add **Vitest** to `client/` — it has never had a test runner |

### Why approach B (Phaser for motion, DOM for inspection)

Two alternatives were rejected:

- **Phaser draws everything**, labels and detail panels included. Rejected:
  Phaser text ignores the project's Tailwind theme tokens, is not selectable,
  and inspecting a tool's full args/result would mean reimplementing
  `client/src/components/code-block.tsx` in canvas.
- **Phaser as ambient background only**, with a DOM/SVG timeline doing the real
  work. Rejected: most readable of the three, but Phaser stops earning its
  bundle cost and the learning goal evaporates.

B puts the boundary at *inspection*: the canvas shows what happened and when,
the DOM shows what it actually was.

## 3. Verified API surface

Re-read fresh on 2026-09-13 from `src/events.ts`, `src/server.ts` and
`src/session/routes.ts`, per the standing gotcha in `context.md` §5 that this
contract drifts. Three findings drive the design:

1. **Everything is a session.** Task 9 of the conversations plan landed
   (`ab9cddd`). `POST /api/run` is now a shim that creates a one-turn session.
   A "run" on the wire is a **turn**; a session can hold several. `context.md`
   still listed tasks 9-10 as open when this was written — it is stale on that.
2. **`GET /api/run/:id/stream?after=0` is replay and live in one endpoint.** It
   serves the stored log from seq 0, then tails. Accepts a turn id or a session
   id (`src/session/routes.ts`, the `legacy` route match). **No new harness
   route is needed for this feature.**
3. **`assistant.delta` is never persisted** (`src/session/runner.ts:185`
   excludes it from the store append). Token-particle streaming therefore
   exists only on a live turn.

Wire events are `SessionEvent = (RunEvent | SessionOnlyEvent) & { sessionId, seq, turnId? }`
(`src/session/types.ts`).

The run picker reads **`GET /api/sessions`** (`SessionSummary`: `id`, `title`,
`createdAt`, `updatedAt`, `status`, `messageCount`, `lastModel`). It must
**not** read the legacy `GET /api/runs`, which hardcodes `durationMs: 0` and
reports `messageCount` in the `steps` field — wrong data for a picker.

## 4. Architecture

Three layers, hard boundaries.

### 4.1 `client/src/lib/pipeline/model.ts` — headless

No Phaser, no React, no I/O. One pure function:

```
applyEvent(state: PipelineState, ev: SessionEvent): PipelineState
```

`PipelineState` is a plain scene graph — turn segments, stations, lanes, bar
widths, status flags, totals. Immutable updates only (global rule).

This mirrors the discipline already used for runs in
`client/src/lib/store.tsx`: fold one event at a time with a pure reducer, never
read refs during render (`context.md` §4). Purity is also what makes scrubbing
free (§7) and what makes the feature testable without a canvas.

### 4.2 `client/src/lib/pipeline/scene.ts` — the Phaser scene

A Phaser `Scene` exposing `sync(state: PipelineState)`. It reconciles game
objects against the state it is handed — creating, updating and destroying
stations, belts, bars and emitters — and owns the camera and all tweens.

Knows nothing about HTTP, React, or where state came from.

### 4.3 `client/src/pages/canvas.tsx` — React shell

Owns the run picker, the SSE subscription, the scrub bar, the minimap and the
detail panel. Boots Phaser with a lazy `await import("phaser")` inside an
effect so the library only loads on this page; Vite code-splits it
automatically. Pushes state into the scene, receives station clicks back out.

The detail panel reuses the existing `client/src/components/code-block.tsx` for
tool args and results rather than rendering them in canvas.

### 4.4 Data flow

```
GET /api/sessions            -> picker list
  pick a session
GET /api/run/:sessionId/stream?after=0
  -> SSE: SessionEvent, ...  -> applyEvent -> PipelineState -> scene.sync()
```

Replay and live are the same code path with no branch: the stream backfills the
log, then continues into the live turn.

## 5. Event → visual mapping

| Event | Visual |
| --- | --- |
| `message.created` (user) | a new turn segment opens on the belt |
| `step.start` | an LLM station drops onto the belt |
| `assistant.delta` | token particles stream along the belt — **live only** |
| `assistant` | station settles. If no delta preceded it for that step, one burst sized to the text length instead (see below) |
| `tool.call` | a tool station opens in a parallel lane, bar starts growing |
| `tool.result` | bar freezes at width proportional to `durationMs`; sealed green, or cracked red when `isError` |
| `permission.ask` | station pulses amber and **the belt visibly stops** |
| `permission.resolved` | belt resumes, or the station goes red on `deny` |
| `context.condensed` | the earlier belt segment folds up on itself |
| `run.end` | end cap: completed / failed / cancelled, with duration and token count |
| `session.updated`, `queue.updated`, `message.completed` | no visual in v1; ignored by the reducer without error |

The `permission.ask` treatment is deliberately the loudest thing on screen. A
gated tool is the one state that currently looks like a hang in every other
Dulo client — the TUI renders nothing at all for it (`context.md` §7.3), and
several tools are gated by default (§5).

**Bar growth has two phases.** Between `tool.call` and `tool.result` there is no
duration yet, so the bar grows against wall-clock time from the call. On
`tool.result` it snaps to a width proportional to the reported `durationMs`,
with a floor and a ceiling, so a 2ms tool stays visible and a 30s tool does not
run off the world. The snap is a tween, not a jump — a live bar that grew
slightly wrong settles rather than teleports.

**Replay is detected from the data, not from a flag.** Deltas are absent from
the store, so an `assistant` event arriving with no delta seen for that step
came from the log rather than a live stream. That single rule drives both the
burst-instead-of-particles fallback above and the "replay" badge in §8; nothing
needs to track which part of the stream was backfill.

## 6. Camera and minimap

The camera pans horizontally. While a turn is live it follows the newest
station, and **releases the moment the user drags** — the same rule, for the
same reason, as the TUI's `refreshTranscript(forceBottom)` (`context.md` §4):
scrolling back to reread an earlier step must not be yanked forward by the next
event. A new turn starting re-engages follow.

A minimap strip under the canvas shows the whole session at a glance; clicking
it jumps the camera. At ~400px width the minimap is what makes the view usable,
since the visible belt is short.

Turn segments outside the camera viewport are culled explicitly. Phaser is not
trusted to cull arbitrary graphics objects automatically.

## 7. Scrubbing

Every event carries a monotonic `seq`. Scrubbing to N means replaying the pure
reducer from 0 to N and calling `scene.sync()` once with the result. No separate
rewind logic exists, and none should be added — this falls out of §4.1 being
pure.

## 8. Failure modes and edge cases

- **Seq gaps are normal and must not be treated as loss.** Deltas are excluded
  from the store but still consume seq numbers, so a replayed log reads
  `...8, 13, 14` (`context.md` §4). The reducer filters on `seq > N` only and
  never assumes contiguity.
- **A replayed session is visibly calmer than a live one**, because the deltas
  are gone. This is intended. The UI shows a "replay" badge so it does not read
  as broken animation.
- **React 19 StrictMode double-mounts effects.** A Phaser game not torn down in
  cleanup leaves two canvases and a leaked WebGL context. The effect must call
  `game.destroy(true)`.
- **SSE drops, or the harness restarts mid-run.** Freeze the canvas at its last
  known state and show a DOM badge; never clear the scene. `context.md` §4 is
  explicit that a harness restart loses the in-flight run, and the canvas should
  not pretend the run is still progressing.
- **Empty or zero-turn session.** Render an empty belt with a hint, not a blank
  canvas.
- **Very long sessions.** Bounded by viewport culling (§6).

## 9. Testing

Vitest is added to `client/` (new devDependency and config; the client has no
test runner today). Scripts gain `test`.

- `client/src/lib/pipeline/model.test.ts` — the reducer, which is the part most
  worth testing and the only part testable without a browser. Covers: seq gaps,
  parallel tool lanes, an errored `tool.result`, a gate asked and resolved both
  ways, `context.condensed`, all three `run.end` statuses, multi-turn chaining,
  and unknown/ignored event types.
- The scene gets a **real-browser check** at desktop and ~400px width, per the
  project rule in `CLAUDE.md`. It is not unit-tested.
- Gate before calling it done: `npm run typecheck && npm run lint && npm run build`
  in `client/`, plus `npm test` there.

## 10. Out of scope for v1

- Zoom (pan only).
- Exporting or sharing a rendered run.
- Starting runs from this page — runs are still started in Playground or the
  TUI, and watched here.
- Any harness-side change. This feature is client-only by construction.
- Visuals for `queue.updated` / `message.completed` / `session.updated`.

## 11. Risks

- **Phaser 4 vs the ecosystem.** Examples and answers online are overwhelmingly
  Phaser 3; some APIs moved. Accepted knowingly.
- **Bundle cost.** Phaser is roughly 250-300KB gzipped; this has not been
  measured for 4.2.1 and should be checked after the first build. Lazy import
  confines it to this page.
- **Two coordinate systems.** DOM overlays (minimap, detail panel anchors) must
  stay in sync with the camera. Keeping all positioning derived from
  `PipelineState` rather than read back out of Phaser is the mitigation.
