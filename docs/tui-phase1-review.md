# TUI Phase 1 — Independent Code Review

**Target:** `tui/` (untracked, new) — Go + Bubbletea terminal client for the Dulo harness, ~1,400 lines.
**Reviewed:** 2026-09-13. Two fresh reviewer subagents (harness-contract slice, Bubbletea slice) plus probe tests run on a scratchpad copy. No repo files were modified.
**Verdict: Request changes.** Six Should-fix defects, four Could-fix items. No security or data-loss issues.

This file is written for the developer agent that will fix the TUI. Each finding has a file:line, a fix direction, and a test that should prove it. Work top to bottom.

---

## 0. Ground rules for the fixer

- Read `context.md` §3 (TUI), §4 (last three rows), §5, §7.3 first. Then read `src/server.ts`, `src/events.ts`, `src/runs.ts` **fresh** — the API moved mid-session once already.
- Do not touch `src/`. The TUI is a pure client.
- Do **not** implement the known Phase 1 gaps (`permission.ask`, `assistant.delta` rendering, `context.condensed`, reconnect, agents, history, skills) unless asked. Finding 1 only makes those events harmless; it does not render them.
- `tui/api/types.go` mirrors `src/events.ts`. If you add a field, keep the mirror comment accurate.
- Verify from `tui/` after every change:

```bash
gofmt -l . && go vet ./... && go test -race -count=1 ./...
```

- Keep files small (repo rule: <400 lines each; all are currently under 170).
- Commit as `fix: …` (conventional, no attribution trailers). Do not push.

---

## 1. Findings (priority order)

### F1 — Every unhandled event injects a blank line into the transcript

```
Priority: Should fix
Confidence: 5
What I found: renderTranscript writes a "\n" separator before every event (render.go:20-23) and then the joined lines of renderEvent, which returns nil for every type it does not know (render.go:61-62). update.go:54 appends *every* received event to history, and src/runs.ts publish() sends every live event to subscribers, including one assistant.delta per streamed token, plus permission.ask / permission.resolved / context.condensed. Probe: a history with 20 deltas and 1 permission.ask rendered 25 lines, 21 of them blank.
Why it matters: On every real run the transcript fills with one blank line per token of the answer (often 100-500 lines) between the step markers and the final answer. Scrolling back to see tool calls means paging through screens of nothing. Combined with F4 it makes the scrollback unusable during a run.
ELI5: Whenever the server sends an event the app does not know how to draw, it draws an empty line instead of nothing. The server sends one such event per word of the answer, so most of the screen history becomes empty lines.
Where: tui/render.go:17-26 (separator logic), tui/render.go:61-62 (default nil), tui/update.go:54-58
Suggested fix: In renderTranscript, call renderEvent first and only write the separator + lines when len(lines) > 0. Keep history raw (deltas will be useful for token streaming later). Also see F6: skip refreshTranscript entirely when the event renders no lines.
Prove it: unit test — history of [run.start, step.start, 20× assistant.delta, permission.ask, assistant, run.end] → rendered output contains zero blank lines and the non-blank lines are in order.
```

### F2 — A stream that ends without `run.end` finishes silently

```
Priority: Should fix
Confidence: 5
What I found: parseSSE emits a StreamErrorType event only when scanner.Err() != nil (sse.go:55-57). A clean TCP close (harness process exit, `tsx watch` restart mid-run, handler returning early) yields io.EOF, which the scanner reports as nil. The channel closes, update.go:43-49 flips state to idle and clears runID, and nothing is appended to history. Probe: fake server sent run.start then returned; final history was [run.start] only, state idle, no error line.
Why it matters: The owner runs the harness under `tsx watch`; any harness edit mid-run kills the run (context.md §4, "Honest limit"). The TUI shows "running" vanish from the status bar and nothing else — indistinguishable from a run that never produced output. A later reconnect feature also depends on the TUI knowing the stream ended early.
ELI5: If the server dies or restarts while a run is going, the app just stops saying "running" and shows no message at all. The user cannot tell whether the run finished, failed, or was lost.
Where: tui/update.go:42-49, tui/api/sse.go:55-57
Suggested fix: In the `!msg.ok` branch of update.go, if m.state == stateRunning (i.e. no run.end was seen), append api.NewStreamErrorEvent("stream ended before run.end — harness stopped or restarted?") and refreshTranscript() before resetting state. Doing it in update.go (not sse.go) keeps parseSSE ignorant of run semantics.
Prove it: unit test driving model.Update with startRunCmd + listenForEventCmd against an httptest handler that sends run.start and returns → history ends with a StreamErrorType event and View() contains "connection error".
```

### F3 — Base URL with a trailing slash breaks every request

```
Priority: Should fix
Confidence: 5
What I found: Client concatenates c.BaseURL+path with no normalization (client.go:46, 77, 102) and defaultConfig stores DULO_TUI_HARNESS_URL verbatim (config.go:22-25). Probe: NewClient(srv.URL+"/").GetHealth() reached the server as path "//api/health". The harness routes with `new URL(req.url, …)` (src/server.ts:239); a leading "//" is parsed as a protocol-relative authority, so pathname becomes "/health" and every route 404s. The reference TS client strips trailing slashes (client/src/lib/agent-client.ts:18).
Why it matters: The only Phase 1 config knob, set the way most people type a base URL, makes the TUI permanently "disconnected" with a 404 buried in the error string and every run failing.
ELI5: If the harness address is typed with a slash at the end, the app can never reach the harness — the status shows disconnected and no query runs.
Where: tui/api/client.go:20-25 (NewClient), tui/config.go:21-33
Suggested fix: In NewClient, `baseURL = strings.TrimRight(baseURL, "/")`. While there, validate once at startup in config.go: url.Parse, require scheme http or https and a host, and exit with a clear message otherwise (today a missing scheme surfaces as Go's `unsupported protocol scheme` in the status bar).
Prove it: table test in client_test.go — NewClient with "http://x/", "http://x//" → recorded request path is exactly "/api/health"; config test — "localhost:3001" and "" are rejected/defaulted with a readable message.
```

### F4 — Transcript is force-scrolled to the bottom on every event

```
Priority: Should fix
Confidence: 5
What I found: refreshTranscript unconditionally calls m.viewport.GotoBottom() (update.go:109-112) and is invoked on every streamed event (update.go:58) and every resize (update.go:103). PgUp/PgDn are bound (update_keyboard.go:39-45) but any incoming event undoes them.
Why it matters: Scrolling up to re-read an earlier step during a multi-step run is impossible; the next event (with deltas, the next token) yanks the view back down.
ELI5: If you scroll up while a run is in progress, the screen jumps back to the bottom the moment anything new arrives.
Where: tui/update.go:109-112
Suggested fix: Record `wasAtBottom := m.viewport.AtBottom()` before SetContent and only GotoBottom when it was true (standard log-tail behavior). Always GotoBottom on a user-initiated submit so a new run is visible.
Prove it: unit test — feed events, call ViewUp, feed another event → viewport.YOffset unchanged; when already at bottom → YOffset advances.
```

### F5 — Tool output is rendered with raw control and escape sequences

```
Priority: Should fix
Confidence: 4
What I found: ev.Result, ev.ToolError(), ev.Text and ev.RunEndError() are passed to oneLine/truncate/wrapLines and then to lipgloss without stripping non-printable bytes or ANSI/OSC sequences (render.go:46, 49, 53, 59). truncate cuts by rune count (render.go:106-113) and can split a multi-byte escape sequence, leaving an unterminated sequence in the output. lipgloss's trailing reset cleans up simple colour codes, but cursor-movement, screen-clear, title-set and cursor-hide sequences pass straight through, and `\r` collapses a line onto itself.
Why it matters: The `shell` tool is central to this harness and commonly emits colour codes (`git status`, `npm test`, `ls --color`); `read_file`/`http_request`/`file_extract` return arbitrary bytes. A single result can clear or scramble the terminal or hide the cursor for the rest of the session.
ELI5: If a tool's output contains terminal control codes, the app prints them as-is instead of as text, so the screen can flicker, clear, or hide the cursor.
Where: tui/render.go:44-59, tui/render.go:92-114
Suggested fix: Add a sanitize(s string) string used before every user/tool-supplied string reaches oneLine/truncate/wrapLines: strip ANSI with `ansi.Strip` from github.com/charmbracelet/x/ansi (already an indirect dependency; promote it) and drop other control runes except "\n" (which oneLine handles) and "\t". Apply to Result, ToolError(), Text, RunEndError(), and Query.
Prove it: unit test — result "\x1b[2Jhello\r\x1b]0;title\x07" renders to a line containing "hello" and no byte < 0x20 other than the styled output's own SGR codes; truncate of a string with an escape near the cut point yields no lone "\x1b".
```

### F6 — Whole history re-rendered on every event, including every token

```
Priority: Should fix
Confidence: 4
What I found: refreshTranscript re-derives the entire transcript from raw history on each event (render.go:17-26 via update.go:58). For each past tool.result it runs oneLine (ReplaceAll over the full result) and truncate ([]rune conversion of the full result) even though only `width` characters are ever shown. The SSE buffer allows 4 MiB lines (sse.go:14) and read_file results reach 200 KB. With assistant.delta arriving per token (and each triggering a refresh even though it renders nothing), a run with a few large results performs hundreds of full re-renders per answer.
Why it matters: The UI gets progressively more sluggish over a long run, worst on exactly the large-file workloads the buffer sizing anticipates. No measurement was taken; the cost is structural.
ELI5: Every time anything new arrives, even a single word, the app rebuilds the whole conversation display from scratch, including reprocessing any big file contents shown earlier.
Where: tui/update.go:54-58, tui/update.go:109-112, tui/render.go:17-26, tui/render.go:44-50, 92-114
Suggested fix: Two cheap changes: (1) in the runEventMsg branch, skip refreshTranscript when renderEvent(ev, width) yields no lines (removes the per-token multiplier); (2) in the tool.result branch, cut ev.Result to at most `width` runes *before* oneLine/truncate so string work is bounded by the display width, not the result size. Per-event line caching keyed by width is a fine follow-up but not needed now.
Prove it: unit benchmark or test — 200 deltas after five 200 KB results: refreshTranscript count equals the number of renderable events; renderEvent on a 200 KB result allocates O(width), e.g. assert via testing.AllocsPerRun or a simple timing bound.
```

### F7 — Layout overflows the terminal below 7 rows

```
Priority: Could fix
Confidence: 4
What I found: applyLayout clamps each box independently to a minimum (update.go:87-94), so at m.height=5 it still renders status(1) + transcript(1+2 border) + input(3) = 7 rows. Minimum working height is 7.
Why it matters: In a very short split pane the input box (where the user types) is pushed off-screen instead of the UI degrading.
ELI5: If the terminal is very short, the box you type in can disappear below the bottom edge.
Where: tui/update.go:82-104, tui/view.go:9-25
Suggested fix: When statusBarHeight+inputBoxHeight+boxBorders+1 > m.height, drop the status bar first, then the transcript border; or render a one-line "terminal too small (need 7 rows)" view. Keep the fix in applyLayout/View only.
Prove it: View() at Height 5 and Width 20 has ≤ 5 lines and still contains the input prompt.
```

### F8 — Pre-`run.start` window: cancel is a no-op and a second run can overlap

```
Priority: Could fix
Confidence: 3
What I found: submitQuery only checks m.state (update_keyboard.go:54), but state flips to stateRunning on runStartedMsg (update.go:31-34), i.e. after the POST round-trip, and runID is set only when run.start arrives (update.go:51-53). In that window: Esc no-ops and Ctrl+C quits without the best-effort cancel (update_keyboard.go:21-33 guard `m.runID != ""`); a second typed query + Enter starts a second RunStream whose first channel is then abandoned — parseSSE's unguarded `out <- event` (sse.go:53) blocks that goroutine and its connection forever. The window is milliseconds against a local harness (run.start is published before the SSE headers, src/server.ts), so this is hard to hit by hand.
Why it matters: A reflexive Ctrl+C right after Enter, or a slow harness, leaves a run going server-side with no notice. The overlap case leaks a goroutine and an HTTP connection per occurrence.
ELI5: In the first instant after pressing Enter the app does not yet know the run's id, so pressing Escape does nothing and quitting does not stop the run.
Where: tui/update_keyboard.go:14-34, 53-69; tui/update.go:31-34, 51-53
Suggested fix: Add stateStarting, set synchronously in submitQuery; treat it like running for Enter (reject) and for Ctrl+C/Esc (remember a "cancel requested" flag and fire cancelRunCmd as soon as run.start supplies the id). Alternatively have parseSSE select on ctx.Done() when sending so an abandoned stream can be released.
Prove it: unit test — two Enters before runStartedMsg produce one startRunCmd; Ctrl+C in stateStarting then run.start → cancel POST observed.
```

### F9 — `usage` (and `seq`) from `run.end` are silently dropped

```
Priority: Could fix
Confidence: 4
What I found: api.RunEvent has no Usage field (api/types.go:22-55), so the RunUsage object the harness sends on run.end (src/events.ts) is discarded by encoding/json; renderRunEnd cannot show tokens (render.go:66-78). The per-event `seq` from StoredEvent is likewise not decoded; it is what reconnect (`?after=N`) will need.
Why it matters: Token usage the harness already reports on every run is invisible; not an AC, but it is a one-field mirror gap that should be deliberate, not accidental.
ELI5: The server tells the app how many tokens each run used, and the app throws that number away.
Where: tui/api/types.go:50-55, tui/render.go:66-78
Suggested fix: Add `Usage *RunUsage` (promptTokens/completionTokens/totalTokens) and `Seq int` to api.RunEvent; append " · N tokens" to the completed/step-limit run.end line when Usage != nil. Update the mirror comment.
Prove it: unmarshal a real run.end payload with usage → Usage.TotalTokens set; renderRunEnd includes the token count; payload without usage renders as today.
```

### F10 — Error-path unit coverage gaps in `api/`

```
Priority: Could fix
Confidence: 4
What I found: api.Client.Cancel has no direct unit test (only the 200 path via the smoke test); RunStream has no test for a non-200 response (400 from zod, 404, 500); parseSSE has no test forcing bufio.ErrTooLong past maxSSELineBytes; config has no tests.
Why it matters: These are the paths a refactor is most likely to break silently (error-body formatting, ErrTooLong surfacing as a StreamErrorType).
ELI5: The code that handles things going wrong (cancel failing, a rejected run request, an oversized message) is never exercised by a test.
Where: tui/api/client_test.go, tui/api/sse_test.go
Suggested fix: Table tests against httptest for Cancel/RunStream non-200 (assert the error string carries status and body), and one parseSSE case with a line > maxSSELineBytes (assert a StreamErrorType event, channel closed, body closed).
```

---

## 2. Proof review (Phase 1 acceptance criteria)

| AC | Claim | Status | Evidence / gap |
| --- | --- | --- | --- |
| AC-1 | Connects, shows connected/disconnected, polls /api/health every 10s | Partially proven | Smoke tests assert "connected" + model. `healthPollInterval` = 10s; tick re-arms on success and failure with a 5s request timeout (no stacking). **Untested:** disconnected at start, harness vanishing mid-session, recovery. Probe C confirmed "disconnected" renders when the port is closed. |
| AC-2 | Enter streams steps / tool calls / results / final answer | Proven for the six original event types | `TestSmoke_SubmitQueryAndRenderTranscript` asserts on rendered output. **Not exercised with real streams** that include assistant.delta — see F1. |
| AC-3 | Esc cancels via POST /api/run/:id/cancel; Ctrl+C mid-run cancels then quits | Half proven | `TestSmoke_EscCallsRealCancelEndpoint` proves the POST hits with the run.start id and "cancelled" renders. **Ctrl+C-mid-run is untested:** the test sends Ctrl+C 150 ms after run.end has landed (cancel_smoke_test.go:86-87), so state is already idle and the plain `tea.Quit` branch runs, never `tea.Sequence(bestEffortCancelCmd, tea.Quit)`. Add a test where the fake harness holds the stream open and asserts the cancel POST arrives before exit. |
| AC-4 | Harness down at startup does not crash | Holds, unproven by repo tests | Probe C: closed port → "disconnected" in status, submit → "! connection error: … connection refused" line, state idle, no panic. Add this as a real test. |
| AC-5 | go build / go vet clean | Proven | Also gofmt clean and `go test -race` green for both packages. |

Also untested: stream break mid-run (F2), second Enter while starting (F8), tiny terminal (F7), unknown event type (F1). The smoke tests pace themselves with 150–300 ms sleeps; fine locally, may flake under load — prefer polling `out` for an expected substring with a deadline.

## 3. What is correct and should be kept

- `RunRequest` matches the zod schema: `model` omitempty (absent OK, "" is a 400), `maxSteps`/`temperature` always sent (0 temperature valid), `enabledTools` nil = all tools. `marshal_test.go` pins this.
- `RawError json.RawMessage` + `ToolError()`/`RunEndError()` correctly handles the `{message}` vs string shape split. Unknown fields (`seq`, `usage`, new variants) do not break decoding.
- No client-side timeout on the run stream (`http.DefaultClient` in RunStream) is right: a gated tool can pause a run up to 5 minutes. Health and cancel use bounded 5s / 2s timeouts.
- SSE parsing: 4 MiB line cap with explicit `scanner.Buffer`, `: ping` comments skipped, body closed and channel closed on every exit path; ctx cancellation distinguished from transport errors.
- Cancel design (POST, not connection close) matches `src/runs.ts` as it is now; Ctrl+C uses `tea.Sequence` so the POST runs before Quit.
- Elm loop: the read-next-event Cmd re-queues until channel close; no Model mutation from goroutines; `-race` clean.
- Layout rebuilds from raw events on resize (never re-wraps wrapped text); status bar uses `MaxWidth` so it cannot soft-wrap.

## 4. Unverified

- Real-terminal rendering (colours, border alignment, flicker, alt-screen restore on exit) — only `model.View()` strings and a `bytes.Buffer`-backed program were checked. Do a manual run in a real terminal at ~100×30 and ~60×12 after the fixes.
- Terminal-specific behaviour of a truncated escape sequence (F5) — mechanics confirmed, effect varies by emulator.
- F6 has no measurements; the cost is structural, not timed.

## 5. Suggested order of work

1. F1 + F6 together (same code path; ~15 lines).
2. F2 (~5 lines) and F3 (~3 lines + validation).
3. F4 (~4 lines).
4. F5 (new sanitize helper + tests).
5. AC-3 Ctrl+C-mid-run test and AC-4 test (proof gaps).
6. F7–F10 if time allows.

Then: manual real-terminal check, update `context.md` (§3 TUI bullets, §4 rows for any non-obvious choice such as the sanitize approach, §6/§7.3, §8 log line), and commit.
