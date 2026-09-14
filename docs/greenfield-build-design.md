# Greenfield build: from an agreed plan to a project the user can run

> **Status:** Approved and implemented 2026-09-14 (roadmap Step 2, tasks 1-7).
> Owner: Ali. Author: Claude. Plan: `greenfield-build-plan.md`.

## 1. Executive summary

After Step 1, Dulo's Frontend Engineer can take a request, ask the right questions,
write a brief, and plan. It cannot yet finish the job. The first real run showed why:
the harness has no way to keep a dev server alive, so the Review step can never look
at the page; one hung model request stalled a turn for 28 minutes because nothing
times out; the shell cannot create a folder; and every path the harness uses (roles,
skills, config, the file tools' root) is relative to wherever the process was started,
so a workspace outside the repo means copying files around. The person who feels this
is the owner, who cannot yet hand Dulo a brief and get back a folder that runs.

This design makes the build stage real. The harness learns where it lives and gets an
explicit workspace root that every file operation is confined to. Four small tools
give the role what the shell cannot: scaffold a project from a template Dulo owns,
start and stop a dev server, and make, move, or remove paths safely. Model requests
get a stall timeout. And Loop Engineering's second layer lands: a `report_done` gate
that refuses an unproven "done", with an independent reviewer role that checks the
page with fresh eyes before the gate opens. The main downside is more moving parts in
the harness, and slower turns: a reviewed build costs a second model run, and on the
free model a full build will take tens of minutes.

## 2. Context and scope

Current behavior. `src/tools/file.ts` confines every file tool to `ROOT =
process.cwd()`; `src/tools/system.ts` runs one allow-listed program with `shell:
false`, a 30-second cap, no background processes, and no `mkdir`, `mv`, `cp`, or
`rm`. `src/agents.ts`, `src/skills.ts`, `src/tools/custom.ts`, `src/config.ts`, and
`dotenv/config` all resolve from the current directory. `src/llm.ts` sets no timeout
on the OpenRouter fetch or its stream. A turn's tools are the registry's tools
narrowed by the profile; nothing is created per turn. `src/mcp.ts` drops image blocks.

Why it is insufficient. The Frontend Engineer's Act and Review stages need a project
folder outside the Dulo repo, a running dev server to open in the browser, a way to
make folders, and a model call that cannot hang forever. The definition of done needs
a gate that rejects a claim without evidence. None of these exist.

What changes once this ships. A brief handed to the role ends as a folder under the
workspace that runs with `npm install` and `npm run dev`, checked in a real browser by
the role and by an independent reviewer, or as an honest not-done report.

Boundary. This design covers the workspace and path resolution, four tools, the stall
timeout, the template, the scaffold skill, `report_done`, `review_verdict`, the
reviewer profile, and the `loop` config. It does not cover permission tiers, the
non-technical permission popup, model or provider choice, image pass-through for
screenshots, or deployment.

## 3. System context

```
server.ts ──► paths.ts (HARNESS_ROOT, WORKSPACE_ROOT, SESSIONS_DIR, CONFIG_FILE, TEMPLATES_DIR)
   │              ▲ used by agents.ts, skills.ts, tools/custom.ts, config.ts, tools/file.ts, session store
   ▼
registry ──► tools: file (+ make_dir, move_path, remove_path), shell, todo, skills,
                    scaffold_project, dev_server, MCP …
   │
session runner ──► per-turn tools: report_done (nested runTurn as frontend-reviewer → review_verdict)
   │
runTurn ──► callLLM (stall timeout, total timeout) ──► OpenRouter
```

Touched: `src/paths.ts` (new), `src/tools/file.ts`, `src/tools/system.ts` (cwd only),
`src/llm.ts`, `src/tools/scaffold.ts` (new), `src/tools/dev-server.ts` (new),
`src/loop/report-done.ts` (new), `src/agents/frontend-reviewer.md` (new),
`src/skills/frontend-greenfield-scaffold.md` (new), `templates/landing-page/` (new),
`src/config.ts`, `src/permissions.ts` (gated list), `src/session/runner.ts` (per-turn
tools), `src/server.ts` (workspace startup, dev-server shutdown). Preserved: the event
stream and its client mirror (no new event types), the session model, the permission
gate's behavior, the CLI.

## 4. Proposed design

### How it works, one real case

The owner starts the harness from anywhere. It logs `Workspace: /Users/…/harness/
workspace` (the default) or the `DULO_WORKSPACE_DIR` it was given, and creates the
folder if missing. The Frontend Engineer clarifies Northwind Coffee as in Step 1 and
writes `.dulo/northwind-coffee/brief.md`, which now lands under the workspace, not the
repo.

In Act it calls `scaffold_project { slug: "northwind-coffee", name: "Northwind
Coffee" }`. The tool copies `templates/landing-page/` to
`<workspace>/northwind-coffee`, fills the name into `package.json`, `index.html`, and
the README, runs `npm install` with a three-minute cap, and returns the file tree and
the last lines of the install. The role installs its two fonts with `shell` (`npm
install @fontsource-variable/fraunces @fontsource-variable/dm-sans`), edits
`src/index.css` (`@theme` tokens, font imports), fills `src/content/site.ts`, writes
one component per section under `src/components/sections/`, and composes `App.tsx`.
It never fights the shell for a folder: `make_dir` exists.

In Review it runs `npm run build` through `shell`, then `dev_server { action:
"start", project: "northwind-coffee" }`. The tool picks a free port from 5200 to 5299,
starts `npm run dev` bound to `127.0.0.1`, waits for the URL line, and returns
`http://127.0.0.1:5203/`. The role opens it with the browser tools, runs the checks
from the definition-of-done skill at 1440 px and 400 px, records evidence, and calls
`report_done` with the filled checklist. The gate validates the checklist, then runs
the `frontend-reviewer` role in a nested turn with the brief, the checklist, the
project path, and the URL. The reviewer reads the project, opens the page, runs the
same checks, and calls `review_verdict`. Its verdict comes back as `report_done`'s
result: `rejected by review: DOD-4 must-fix: section "Visit us" heading missing`. That
is a failed Review; the role improves and calls `report_done` again. On the second
call the reviewer passes, the tool returns `accepted`, and the role writes the pass
report. The dev server stays up so the owner can click the URL; it stops when the
role calls `stop`, after 30 idle minutes, or when the harness shuts down.

If the model stream goes silent for 90 seconds at any point, `callLLM` aborts the
request, retries up to the existing three attempts, and if it still cannot get a
response fails the step with "model stream stalled"; the turn ends `failed` instead
of hanging, and the next turn resumes from the brief file.

### Components and responsibilities

**`src/paths.ts`** (new). Owns every root the harness needs: `HARNESS_ROOT` (the repo,
derived from the module's own location), `WORKSPACE_ROOT` (`DULO_WORKSPACE_DIR`, else
`<HARNESS_ROOT>/workspace`), `SESSIONS_DIR` (`DULO_SESSIONS_DIR`, else
`<HARNESS_ROOT>/sessions`), `CONFIG_FILE` (`DULO_CONFIG`, else
`<HARNESS_ROOT>/dulo.config.json`), `TEMPLATES_DIR`, `AGENTS_DIR`, `SKILLS_DIR`,
`CUSTOM_TOOLS_DIR`. `.env` is loaded from `HARNESS_ROOT`. Depends on nothing. Does
not own creating directories; `server.ts` does that at startup.

**File tools** (`src/tools/file.ts`, changed). `ROOT` becomes `WORKSPACE_ROOT`.
`resolveSafe` is unchanged and now confines to the workspace. Three tools are added on
top of it: `make_dir { path }`, `move_path { from, to }`, `remove_path { path,
recursive? }`. `remove_path` refuses the workspace root itself. The shell's `cwd`
already goes through `resolveSafe`, so the shell is confined too. These tools do not
own any allow-list change to the shell; the shell stays as it is.

**`scaffold_project`** (`src/tools/scaffold.ts`, new). Owns creating a project from
`templates/landing-page/`: copy, fill `{{name}}` and `{{slug}}`, `npm install` (spawned,
180-second cap, last 30 lines returned), return the tree. Refuses a target that exists
and is not empty. Depends on `paths.ts`. Does not own the template's content or the
design of the page.

**`templates/landing-page/`** (new). Owns the stack and conventions from the research:
Vite + React 19 + TypeScript + Tailwind v4 with `@tailwindcss/vite`, tokens in an
`@theme` block in `src/index.css`, `src/content/site.ts` typed content,
`src/components/{layout,sections,ui}/`, `index.html` with static title, description,
Open Graph tags, and the SVG favicon, a README with the run command, scripts `dev`,
`build` (`tsc -b && vite build`), `preview`, `lint` (`oxlint`). Versions pinned as
verified on 2026-09-14 in `docs/frontend-engineer-research/04-brief-and-stack.md`
(vite 8.3.0, react 19.3.0, @vitejs/plugin-react 6.1.1, tailwindcss and
@tailwindcss/vite 4.3.3, typescript ~6.0.2). No fonts: those are brief-specific and
installed by the role. Does not own content; every visible string is a placeholder the
role must replace, and DOD-4's placeholder grep is what catches one left behind.

**`dev_server`** (`src/tools/dev-server.ts`, new). Owns starting, listing, and stopping
dev servers for projects under the workspace: `{ action: "start" | "stop" | "status",
project }`. Start spawns `npm run dev -- --host 127.0.0.1 --port <p> --strictPort` in
the project, `p` being the first free port in 5200 to 5299, and waits up to 45 seconds
for a `http://` URL on stdout; returns `{ url, port }` plus the log tail. One server per
project; a second start returns the existing URL. Stop sends SIGTERM, then SIGKILL after
3 seconds. A server with no tool call touching it for 30 minutes is stopped. All
servers are stopped on harness shutdown. Depends on `paths.ts`. Does not own the
browser checks.

**`callLLM`** (`src/llm.ts`, changed). Gains two bounds: `LLM_STALL_MS` (default
90 000), the longest silence tolerated before the first byte or between chunks, and
`LLM_TOTAL_MS` (default 600 000), the longest a single request may live. Either
triggers an abort of that request and an `LlmError` of kind `network`, retryable,
which the existing attempt loop handles as it does a socket failure. A stall after
partial output was already emitted is not retried (the existing `emitted` rule) and
fails the step. The caller's signal still wins: a cancel is a cancel, not a stall.

**`report_done` and `review_verdict`** (`src/loop/report-done.ts`, new). `report_done`
is created per turn by the session runner, because it needs the turn's signal, its
permission function, and the registry to run the reviewer. It validates the checklist
with zod (every DOD id present, every status `pass`, every evidence non-empty), counts
its own calls against `loop.maxIterations`, and when `loop.independentReview` is on
runs `runTurn` with `agent: loop.reviewer`, a fixed user message (brief file contents,
the checklist, the project path, the dev-server URL), the reviewer's own tool
allow-list, the outer turn's `requestPermission`, and the outer signal. The reviewer
must call `review_verdict { verdict, findings[] }`; that tool validates and records the
verdict, and the nested run's result is read from it. `report_done` returns `accepted`,
`rejected: <ids and reasons>`, `rejected by review: <findings>`, or `cap reached (n/n):
stop and report not done`. Nested run events are not forwarded to the session stream in
this step; the server logs one line per review. Does not own the checklist text, which
stays in the definition-of-done skill.

**`frontend-reviewer.md`** (`src/agents/frontend-reviewer.md`, new). Read-only file
tools, the browser and a11y tools, `dev_server` with `status` only in practice (the
profile says never start or stop), `load_skill`, `review_verdict`. Prompt: judge only
the fixed checklist ids, quote evidence for every item, never propose changes beyond a
finding's fix, verdict `pass` only when every hard check passes. Depends on the same
skill as the builder. Does not edit.

**`frontend-greenfield-scaffold.md`** (`src/skills/`, new). Owns the blueprint of the
template (tree, one line per file), where tokens, fonts, content, and sections go, how
to call `scaffold_project` and `dev_server`, and the dated version table. The builder
loads it at Act, as the profile already says. Does not own the definition of done.

**Config** (`src/config.ts`). `loop: { maxIterations: 3, independentReview: true,
reviewer: "frontend-reviewer" }`, all optional with these defaults. Invalid values are
reported at startup like other config errors, and defaults apply.

**Permission gate** (`src/permissions.ts`). `DEFAULT_GATED_TOOLS` gains `make_dir`,
`move_path`, `remove_path`, `scaffold_project`, `dev_server`: each writes or runs a
process. `report_done` and `review_verdict` are not gated; they spend model calls, not
trust.

**Server** (`src/server.ts`). Creates `WORKSPACE_ROOT` if missing and logs it next to
the sessions line; stops dev servers in `shutdown`.

### Decisions

**Roots come from the harness's own location, not the current directory.** A module
knows where it is; a process does not know where it was started from with any
meaning. Rejected: documenting "always start from the repo root" (Step 1's test had to
copy role files into the workspace to work). Cost: one new module and six imports;
when the process is started from the repo root, every path resolves exactly as before.

**The file root moves to the workspace.** The role must not be able to write into
Dulo's own source tree, and the workspace is where its work belongs. Rejected: a root
per profile (a second mechanism for a case that does not exist yet). Cost: the demo
`reviewer` profile, which read Dulo's own code, now reads the workspace; see Open
questions.

**New file tools instead of widening the shell allow-list.** `make_dir`, `move_path`,
and `remove_path` go through `resolveSafe`, so every path is proven inside the
workspace before anything happens. Rejected: adding `mkdir`, `mv`, `cp`, `rm` to the
shell, whose arguments are not paths the harness inspects. Cost: three small tools.

**A template Dulo owns, copied by a tool, instead of running `npm create vite` live.**
Determinism, no interactive prompt, no network for the scaffold itself, the research's
conventions baked in, and `npm install` run with a cap the shell cannot offer.
Rejected: live scaffolding plus a patch step (fewer files to own, but two more model
steps and a moving target). Cost: the template's pins drift and need a dated refresh;
a smoke check script covers it.

**A dedicated dev-server tool, not background jobs in the shell.** A server is a
long-lived process with a URL and a lifecycle; the shell is a one-shot command runner
with a 30-second cap. Rejected: letting the shell detach processes (loses the URL,
leaks processes, widens what `shell` means). Cost: one tool with its own tests.

**Servers outlive the turn, with an idle stop.** The owner clicks the URL after the
report; a server that dies with the turn defeats "ready to preview". Rejected: stop at
turn end. Cost: ports held until idle stop or shutdown; bounded by the 100-port range.

**The stall timeout is a retryable network error.** The retry loop already exists and
already re-sends on socket failures; a silent stream is the same situation from the
harness's point of view. Rejected: a new error kind and a new code path. Cost: none
beyond two constants and an abort.

**`report_done` is built per turn in the runner.** It needs the turn's signal and
permission function to run the reviewer honestly (browser MCP tools are gated); a
registry-level tool has neither. Rejected: a global tool with a side channel. Cost: the
runner builds one tool instance per turn and appends it to the tools list.

**Nested review events stay out of the session stream for now.** Forwarding them means
a new event field mirrored into the client types; the verdict text in the tool result
carries what the user needs. Rejected: `review.*` events now. Cost: the user sees
"reviewing…" only as a long-running `report_done` call until a later UI step.

## 5. Invariants and requirements

### Invariants

- `INV-9` Every path a file tool, the shell's `cwd`, `scaffold_project`, or
  `dev_server` touches resolves under `WORKSPACE_ROOT` after symlinks; anything else is
  refused before any effect.
- `INV-10` `remove_path` never removes `WORKSPACE_ROOT` itself.
- `INV-11` No single model request lives longer than `LLM_TOTAL_MS`, and none waits
  longer than `LLM_STALL_MS` without receiving bytes; both end in an abort of that
  request only.
- `INV-12` Every dev server started by the tool is bound to `127.0.0.1`, uses a port in
  5200 to 5299, and is stopped by `stop`, by 30 idle minutes, or by harness shutdown.
- `INV-13` `scaffold_project` never writes into a non-empty existing directory.
- `INV-14` `report_done` rejects a claim missing any DOD id, any status other than
  `pass`, or any empty evidence, and names the ids; with `independentReview` on it also
  rejects any reviewer verdict other than `pass`, quoting the findings.
- `INV-15` `report_done` returns the cap message on the call after `loop.maxIterations`
  rejections in the same turn and never `accepted` afterwards in that turn.
- `INV-16` The reviewer's tool allow-list contains no tool that writes or runs a
  process; `review_verdict` is the only tool it can call that changes state, and that
  state is the verdict.
- `INV-17` Starting the harness from any current directory loads the same roles,
  skills, custom tools, config, and `.env` as starting it from the repo root.

### Requirements

- Startup logs the workspace path; a missing workspace directory is created.
- `dev_server start` returns within 45 seconds with a URL or an error containing the
  log tail; it never returns "started" without a URL.
- `scaffold_project` returns the file tree and the last lines of `npm install`.
- A stalled request produces a turn `failed` with an error naming the stall, not a turn
  that stays `running`.
- The template builds with `npm run build` at its pinned versions.

## 6. Interfaces and data

Environment: `DULO_WORKSPACE_DIR`, `DULO_CONFIG`, `LLM_STALL_MS`, `LLM_TOTAL_MS`
(new); `DULO_SESSIONS_DIR` (unchanged). Documented in `.env.example`.

Config (`dulo.config.json`):

```json
{ "loop": { "maxIterations": 3, "independentReview": true, "reviewer": "frontend-reviewer" } }
```

Tools (JSON schema in the code; shapes here):

- `make_dir { path }` → `created <path>`; `move_path { from, to }` → `moved`;
  `remove_path { path, recursive?: boolean }` → `removed`.
- `scaffold_project { slug, name }` → text: tree + install tail. Errors: target not
  empty, template missing, install failed (with tail).
- `dev_server { action: "start" | "stop" | "status", project }` → start: `url`, `port`,
  log tail; stop: `stopped`; status: running servers with ports and idle seconds.
- `report_done { projectPath, runCommand, summary, checklist: [{ id, status, evidence }] }`
  → `accepted` | `rejected: …` | `rejected by review: …` | `cap reached (n/n): …`.
- `review_verdict { verdict: "pass" | "fail", findings: [{ id, severity: "must-fix" |
  "should-fix", what, where, fix }] }` → `recorded`.

Files: `<workspace>/<slug>/` the project; `<workspace>/.dulo/<slug>/brief.md` the
brief; `templates/landing-page/` the template; `.dulo/` and `workspace/` are already
git-ignored.

### Naming and identity

`slug` is derived by the role from the business or product name: lower-case ASCII,
spaces and punctuation to single hyphens, at most 40 characters; if the folder exists
and is not empty, `-2`, `-3`, and so on; with no name, `landing-page-<n>`.
`scaffold_project` validates the slug (`^[a-z0-9][a-z0-9-]{0,39}$`) and refuses
anything else. Dev servers are keyed by the project's absolute path; ports are chosen
at start and not persisted. A project renamed on disk is a new project to the tool.

## 7. Failure behavior and lifecycle

Startup: the workspace cannot be created (permissions) → the harness exits with a
clear message, since the role cannot work without it. The template folder is missing →
startup warns once; `scaffold_project` returns an error when called. Config `loop` is
invalid → warning, defaults.

`npm install` fails or exceeds 180 seconds → `scaffold_project` returns the error and
the log tail; the project folder stays for inspection; the role treats it as a failed
step and may retry once. `dev_server start` sees no URL in 45 seconds → the process is
killed, the error carries the log tail; no free port → error. A server dies on its own
→ `status` reports it gone; the next `start` starts a fresh one. Two `start` calls for
one project → the second returns the existing URL.

Model stream stalls → abort, retry (fresh request) up to three attempts, then the step
fails and the turn ends `failed` with the stall named; partial output already streamed
is not re-sent. The nested reviewer stalls → the same rules apply inside `report_done`,
which returns the error as a rejection; the builder may call again.

Cancel during `report_done` → the outer signal aborts the nested run; the tool returns
`cancelled`. Harness shutdown → dev servers stopped, MCP servers closed, as today.
Several failures at once → the first error returned wins; the role's blocked stop
lists what it saw.

## 8. Security, privacy, and operations

Trust boundary. Every file effect is confined to the workspace (INV-9). The shell's
`node` and `npx` remain arbitrary code and network; this design does not change that
and Step 3's tiers must treat them accordingly. Dev servers listen on loopback only.
The reviewer cannot change anything. New tools that write or run processes are gated
under today's uniform "ask" gate.

Limits. Ports 5200 to 5299 (100 servers at most). Disk: each project carries its own
`node_modules` (tens of MB); the workspace is git-ignored and disposable. Time: with
the free model a full build with review is expected to take 20 to 40 minutes; the
stall timeout bounds each request, `maxSteps` (40) bounds the turn, `maxIterations`
(3) bounds the loop. Cost: each `report_done` with review is a second model run over
the reviewer's tool calls.

## 9. Acceptance criteria

- `AC-8` Starting the harness from an empty directory with `DULO_WORKSPACE_DIR` set
  loads `frontend-engineer`, both skills, and the config, and logs the workspace path.
- `AC-9` `read_file` and `write_file` with a path that resolves outside the workspace
  are refused; `remove_path` on `.` (the root) is refused.
- `AC-10` A stub LLM that opens the SSE response and sends nothing makes `callLLM`
  fail with a stall error within `LLM_STALL_MS` plus retries, and a session turn using
  it ends `failed`, not `running`.
- `AC-11` `scaffold_project` on a fresh slug produces a folder whose `npm run build`
  exits 0 (smoke check), and on a non-empty slug returns an error without writing.
- `AC-12` `dev_server start` on a scaffolded project returns a `127.0.0.1` URL on a
  port in range within 45 seconds, `status` lists it, `stop` ends the process; a
  project whose `dev` script never prints a URL returns an error with the log tail.
- `AC-13` `report_done` with one empty evidence returns a rejection naming the id;
  with a scripted reviewer `fail` returns the findings; on the call after three
  rejections returns the cap message.
- `AC-14` The `frontend-reviewer` profile's allow-list contains no writing or
  process-running tool.
- `AC-15` T1 from `docs/frontend-engineer-test-tasks.md`, run end to end on a real
  model, ends with a pass report whose project runs with `npm install && npm run
  dev`, or with an honest cap or blocked report; T8 set-ups A, B, and C behave as
  written there.

## 10. Test approach

`node:test` through `tsx`, as today. `paths.test.ts` proves `INV-17`/`AC-8` by
resolving roots from a different `cwd`. `file.test.ts` gains the three tools and the
confinement cases (`INV-9`, `INV-10`, `AC-9`) against a temp workspace set through
`DULO_WORKSPACE_DIR`. `llm.test.ts` uses a local HTTP stub that never writes after
the headers, with `LLM_STALL_MS` set low (`INV-11`, `AC-10`); a runner test proves the
turn ends `failed`. `scaffold.test.ts` copies the template with install skipped
(`install: false` option) and checks the tree, placeholder filling, and the non-empty
refusal (`INV-13`); a separate `npm run template:check` script installs and builds the
template for real (`AC-11`, not part of the unit suite). `dev-server.test.ts` uses a
temp project whose `dev` script is a Node file that prints a URL and listens, plus one
that never prints (`INV-12`, `AC-12`). `report-done.test.ts` scripts the stub LLM to
call `review_verdict` with `fail` and with `pass` (`INV-14`, `INV-15`, `AC-13`).
`INV-16`/`AC-14` is a test that loads the reviewer profile and asserts on its tool
map. `AC-15` is the owner-judged real run, recorded in `context.md`.

## 11. Risks and tradeoffs

- The free model may not sustain a 40-step build even with stall protection; the
  cap and the brief file make partial progress resumable, and Step 4 chooses a
  stronger model for the build stages.
- Browser MCP tools are gated, so a Review under today's gate asks permission per tool
  once per turn; tedious until Step 3, and "always" answers cover a turn.
- Template drift: pins age; the smoke script and the dated skill make refreshing a
  deliberate act.
- A reviewer with the same model as the builder shares its blind spots; fresh context
  still catches omissions, and Step 4 can give the reviewer a different model.
- Design quality still judged without pixels; unchanged from the loop design.

## 12. Open questions

- Retire the demo `reviewer.md` (it reviewed Dulo's own code, which the file root no
  longer reaches), or keep it pointed at the workspace? Recommended: retire it when
  `frontend-reviewer.md` lands. Does not block.
- Should `dev_server` also serve `npm run preview` of a production build for a final
  check? Recommended: not in this step. Does not block.
- Forward nested review events to the chat as a visible "review" block? Recommended:
  later, with the client's tool-activity rendering. Does not block.
- Where the smoke check runs (a script only, or also a scheduled job)? Recommended: a
  script the owner runs when bumping pins. Does not block.

## 13. Out of scope

- Permission tiers and the plain-language popup (Step 3).
- Model and provider choice, image pass-through for screenshots (Step 4).
- Deployment, existing-repo work, roles beyond the Frontend Engineer and its reviewer.
- Client changes; the panel renders the new tools as it renders any tool call.
