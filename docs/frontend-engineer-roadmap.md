# Frontend Engineer — the first four steps

The Mission and Decisions in `CLAUDE.md` say what Dulo is and what "done" means.
This is the order we build it in. One step at a time; each step gets its own
design doc, owner review, then a task-by-task implementation with a commit per task
and a real check at the end. Nothing here is started until the owner says so.

**Proposed order:** identity → capability → safety → quality lever. Steps 3 and 4
swap the Decisions' numbering (model 3, trust 4) on purpose: the uniform permission
gate and the hardcoded token get in the way of *using* Dulo daily, while model
quality can already be tuned through OpenRouter model ids without code.

---

## Step 1 — Identity and process: the Frontend Engineer role

**Goal.** Dulo, asked for a landing page, behaves like a senior frontend engineer
from the first message: understands the request, clarifies what the definition of
done requires (pages/sections, style direction, fonts, colors/tone, key content),
states assumptions where it decides alone, plans in writing, and knows it must
self-check against the request before reporting — in plain language, for a
non-technical user.

**What gets built.**
- `src/agents/frontend-engineer.md` — the role. Identity, the Loop Engineering
  working process (understand and clarify → plan → act → review → improve or stop,
  `docs/loop-engineering-design.md`), the clarifying checklist derived from the
  definition of done, the question discipline (few, up front, about the product), the
  assumption rule, the four stop reasons and their report shapes, and the tool
  allowance. This is the "strong identity, not a short prompt" the Mission asks for.
- `src/skills/frontend-definition-of-done.md` — the review checklist (DOD-1…6) with
  the evidence each item needs, loaded at Plan and at every Review.
- `docs/frontend-engineer-test-tasks.md` — six to eight real landing-page briefs,
  each with what "done" means for *that* brief. These are how we judge the role, now
  and after every later change.
- Harness: nothing new expected. Profiles already exist (`src/agents.ts`: frontmatter
  for model/temperature/maxSteps/tools, body = system prompt) and a turn can already
  name its agent (`POST /api/sessions/:id/messages` accepts `agent`). Choosing the
  role from the panel is conversations Plan 5's picker — not part of this step.

**Done when.** Each test brief, sent through the chat, gets the process end to end
up to the plan (clarify → assumptions → plan) and the answers read like a senior
engineer talking to a non-engineer. Building is not judged yet — that is Step 2.

---

## Step 2 — Greenfield build: from brief to a ready-to-run project

**Goal.** The role turns an agreed plan into a new project outside the Dulo repo,
installs it, runs it, looks at it in a real browser, checks it against the brief and
the definition of done, and hands back a project the user can run and preview
immediately. No deployment.

**What gets built.**
- A **workspace root** for generated projects (`DULO_WORKSPACE_DIR`, default a
  git-ignored `workspace/`). Today every file tool is rooted at `process.cwd()`
  (`src/tools/file.ts`, `ROOT`), i.e. the Dulo repo itself — a landing page would
  land inside Dulo. The root becomes configurable; the traversal guard stays.
- The scaffold: React + TypeScript + Tailwind (Vite), either `npm create vite` plus
  Tailwind setup, or a small template Dulo owns. Decided in this step's design.
- The Review step made real: start the dev server, open it with the Playwright or
  Chrome DevTools MCP, take the accessibility snapshot at desktop and ~400 px, read
  the console, run the overflow and contrast checks, compare against the brief —
  before reporting. (Screenshots are not visible to the model yet: `src/mcp.ts` drops
  image blocks; that and a vision-capable model are Step 4.)
- Loop Engineering Layer 2: the `report_done` gate (rejects a done claim with any
  unproven item; enforces the iteration cap) and the read-only `frontend-reviewer`
  profile run nested inside it for an independent verdict; `loop` block in
  `dulo.config.json`.
- A **dev-server tool** (start, URL, stop), because the `shell` tool runs one
  allow-listed program with `shell: false`, no background jobs, and a 30-second cap
  (`src/tools/system.ts`): it cannot keep a server alive, and `npm install` can exceed
  the cap. Found while writing the definition-of-done skill in Step 1; until this
  exists, DOD-5 is an honest blocked stop.
- A scaffold skill (`src/skills/frontend-greenfield-scaffold.md`) with the exact
  commands, versions, and project blueprint from `docs/frontend-engineer-research/
  04-brief-and-stack.md`, dated, so the profile never carries version numbers.
- Only the skills this needs (`src/skills/`), added because a task needs them.

**Done when.** The Step 1 briefs produce projects that run with `npm install && npm run
dev`, pass the definition of done, and the owner agrees the design quality on a
sample is production-ready, not a prototype.

---

## Step 3 — Trust boundary: tiers, popup, secrets

**Goal.** The normal workflow (local build and preview inside the workspace) runs
without interruptions. External writes, deploys, and anything hard to undo stop for
a permission popup a non-technical user can read and decide on. No secrets in config.

**What gets built.**
- Risk tiers in the permission gate. Today (`src/permissions.ts`) it is one list —
  `shell`, `write_file`, `edit_file`, `file_compress`, `file_extract`,
  `http_request`, plus every MCP tool when `gateMcpTools` is on — all asked the same
  way. Tiers: *allowed* (reads; writes inside the workspace; an allow-list of local
  build commands there), *ask* (writes outside the workspace, external-write MCP tools
  such as GitHub write or Vercel, deploy tools), *always ask* (hard to undo). Config in
  `dulo.config.json`.
- The popup, rewritten for a non-technical user: what will happen, why Dulo wants
  it, what the risk is, whether it can be undone.
- Secrets: the GitHub token moves from `dulo.config.json` to `.env` (MCP servers
  already inherit the harness environment, `src/mcp.ts`), documented in
  `.env.example`.

**Done when.** A full test-brief run needs zero prompts for local work and exactly one
prompt per external-write action; the token is out of the config file.

---

## Step 4 — Model policy

**Goal.** Pick the model per role or per turn from Claude, OpenAI, Gemini, Grok, or
OpenRouter, by quality, cost and availability — stronger models where reliability
needs them.

**What gets built.**
- First, without code: the role's `model` field and `.env` point at strong models
  through OpenRouter (it already routes to Claude, GPT, Gemini and Grok ids).
- Then, if the owner wants providers directly: adapters for Anthropic, OpenAI,
  Gemini and xAI behind the existing `callLLM` in `src/llm.ts`, per-provider keys in
  `.env`, providers visible in Settings, fallbacks across providers.

**Done when.** The same test brief runs on at least two providers and the results are
compared against the definition of done; the role's default model is chosen from that.

---

## After these four

Deploy ability behind permission (Vercel), existing-repo / PR-style work, further
roles (backend, product manager, cloud) — each only once the Frontend Engineer is
right and tested, per the Mission. Conversations Plans 5–7 stay open and are pulled
in when a step needs them (Plan 5's agent/model picker is the likely first).
