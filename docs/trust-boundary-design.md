# Trust boundary: which actions run, which ones wait for a person

> **Status:** Approved and implemented 2026-09-14 (roadmap Step 3).
> Owner: Ali. Author: Claude. Plan: `trust-boundary-plan.md`.

## 1. Executive summary

Dulo's permission gate knows one thing about a tool: its name. Every gated tool asks
the same question, in the same words, with the same three buttons. That means a build
command inside the workspace interrupts the person exactly as loudly as a deploy would,
and the prompt itself is a tool name over a block of JSON, which a non-technical person
cannot judge. The result is the worst of both: constant interruptions during ordinary
work, and no real protection when something genuinely risky happens, because by then
the person has learned to click through.

This design sorts actions into three tiers by what they actually do, judged from the
tool **and its arguments**: work inside the workspace runs without asking, anything
reaching outside or costing money waits for a yes, and anything that cannot be undone
waits for a yes every single time, with no way to wave it through. The prompt is
rewritten for someone who is not an engineer: what will happen, where, and whether it
can be undone, with the technical detail available but not in the way. The GitHub token
moves out of the config file into the environment.

The cost is a real policy to maintain: a new rule is needed whenever a tool is added,
and a wrong rule is either an annoying prompt or a missed one. The design keeps that
honest by defaulting anything unrecognised to "ask", never to "allowed".

## 2. Context and scope

Current behavior. `src/registry.ts` resolves `gatedTools` once at startup:
`config.approval.tools ?? DEFAULT_GATED_TOOLS`, plus every MCP tool when
`gateMcpTools` is on, or nothing at all when `approval.mode` is `"auto"`.
`src/permissions.ts` holds that as a flat `Set<string>`: `request({ id, tool, args })`
resolves immediately when the name is not in the set or the user answered "always" for
that name earlier in the turn, otherwise it parks a promise and emits `permission.ask`
with `{ id, tool, args }`. `client/src/components/permission-prompt.tsx` renders the
tool name as a badge, the raw arguments as JSON, and Allow once / Always in this run /
Deny. The gate is created per turn, so "always" lasts one turn. Nothing anywhere looks
at what a command or path actually is.

Why it is insufficient. Decision 4 says local build and preview run inside the normal
workflow while deploys, external writes and anything hard to undo wait for a person who
can see and understand what they are approving. A name-only gate cannot express any of
that: `shell` is both `npm run build` and `node deploy.js`; `remove_path` is both a
stray file and a whole project. And a person who is not an engineer cannot tell those
apart from a JSON blob.

What changes once this ships. A build inside the workspace does not interrupt anyone. A
deploy, an external write, or a deletion asks, in plain words, with the consequence and
the undo spelled out. Deleting a folder or deploying asks every time, however many
times it happens. The PAT lives in `.env`.

Boundary. This design covers the classifier, the three tiers, the config that overrides
them, the shape of the ask, the prompt UI, and the token move. It does not cover
per-role policies, persisting decisions across turns or sessions, sandboxing `node`, or
the model choice.

## 3. System context

```
runTurn ──► requestPermission({id, tool, args})
              │
              ▼
         gate.request()  ──► classify(tool, args)  ──► { tier, what, where, undo }
              │                  ▲
              │                  └── policy: built-in rules + config overrides
              ├─ allowed → runs, no prompt (a `permission.auto` line in the event log)
              ├─ ask     → parks, emits permission.ask (+ the plain-language fields)
              └─ confirm → parks, emits permission.ask with confirm: true ("always" refused)
                                   │
                                   ▼
                     client: permission-prompt.tsx (what / where / undo, details behind a toggle)
```

Touched: `src/permissions.ts` (the gate), `src/risk.ts` (new, the classifier),
`src/config.ts` (`approval.mode` gains `"tiers"`, plus override lists), `src/events.ts`
and `client/src/lib/types.ts` + `client/src/lib/session-types.ts` (the ask carries more
fields — these three mirror each other), `src/session/runner.ts` (the snapshot mapping),
`client/src/components/permission-prompt.tsx`, `dulo.config.json` and `.env.example`
(the token). Preserved: the request/resolve protocol, the per-turn gate lifetime, the
`PermissionDecision` values, the CLI's behaviour, every tool's own code.

## 4. Proposed design

### The three tiers

**allowed** — ordinary work, inside the workspace, that a person would be annoyed to be
asked about. Reading anything. Writing, moving, creating inside the workspace. Building,
type-checking, linting, installing dependencies, starting and stopping a dev server.
Scaffolding a project. These run with no prompt.

**ask** — anything that leaves the workspace or costs something: the network, arbitrary
code (`node`, `npx`, `python`, and friends, which can do anything including reach the
network), any MCP tool that is not on the known-read-only list. One prompt; the person
may answer "always" to stop being asked for that same tool for the rest of the turn.

**confirm** — anything that cannot be undone from inside Dulo: deleting a folder
recursively, deploying, pushing to a remote, writing to someone else's system (GitHub
issues, PRs, comments), publishing a package, a database migration or write. Asked every
single time. "Always" is not offered, because a blanket yes is exactly what must not be
possible for these.

Anything unrecognised is **ask**. A new tool is never silently allowed.

### How it works, one real case

The Frontend Engineer builds the Northwind Coffee page. `scaffold_project`,
`write_file` × 12, `make_dir`, `npm install`, `npm run build`, `dev_server start`: all
**allowed**, no prompts, the person watches the work happen. Then it wants the brand
font from an unknown host via `http_request`: **ask**. The prompt says:

> **Dulo wants to download a file from the internet**
> From `fonts.brandsite.example`. Nothing on your computer changes; it is only reading.
> [Allow once] [Always this session] [Don't]  ·  *Show technical details*

Later the owner asks for the page to go live. `vercel_deploy` is **confirm**:

> **Dulo wants to publish your site to the internet**
> To `northwind-coffee.vercel.app`, on your Vercel account. Anyone with the link will be
> able to see it. Undoing this means deleting the deployment in Vercel.
> [Yes, publish] [No]  ·  *Show technical details*

No "always" button on that one. If the person walks away, the request times out after
five minutes and is treated as a no, as today.

### The classifier

`src/risk.ts` exports `classify(tool, args, context) → { tier, what, where, undo }`.
It is a pure function over the tool name and its arguments; it reads no files and runs
nothing. The rules, in order:

1. **Config overrides.** `approval.confirmTools` and `approval.allowTools` win over
   everything, so the owner can always tighten or loosen a specific tool by name.
2. **Built-in tools**, by name, and by argument where the name is not enough:
   - reads (`read_file`, `list_files`, `glob`, `grep_files`, `get_current_time`,
     `calculate`, `word_count`, `manage_todos`, `load_skill`, `dev_server` with
     `status`) → allowed.
   - workspace writes (`write_file`, `edit_file`, `make_dir`, `move_path`,
     `scaffold_project`, `file_compress`, `file_extract`, `dev_server` start/stop) →
     allowed. They are already confined to the workspace by `resolveSafe` (INV-9), which
     is what makes this safe to wave through.
   - `remove_path` → allowed for a single file; **confirm** when `recursive` is true.
     Deleting a tree is the one workspace action that cannot be undone.
   - `http_request` → ask; **confirm** when the method is not GET or HEAD.
   - `shell` → by the command, below.
3. **Shell**, using `parseCommandLine` from `src/tools/system.ts` (the same parser the
   tool itself uses, so the classifier judges exactly what will run):
   - allowed: `ls cat head tail grep find wc echo pwd date`, `tsc`,
     `npm install|ci|run build|run typecheck|run lint|run test|test|run preview`,
     `git status|diff|log|show`.
   - confirm: `git push`, `npm publish`, `npm run deploy`.
   - ask: everything else the tool's own allow-list permits, explicitly including
     `node`, `npx`, `python`, `python3`, `go`, `cargo`, `make`. These run code the
     harness has not inspected, which means they can do anything the harness can,
     including reach the network. Denying `http_request` while allowing `node` would be
     a boundary in name only.
4. **MCP tools**, by name pattern, since they are outside the sandbox entirely:
   - allowed: the read-only browser and audit tools the Review step depends on —
     `playwright_browser_(navigate|snapshot|console_messages|resize|evaluate|hover|wait_for|take_screenshot|close)`,
     `chrome-devtools_(navigate_page|take_snapshot|evaluate_script|resize_page|emulate|list_console_messages|lighthouse_audit|hover|wait_for|new_page|close_page)`,
     `a11y_*`, `context7_*`. Without these, every Review would be a wall of prompts and
     the person would learn to click yes.
   - confirm: anything matching `(deploy|publish|release)`, `vercel_*` writes,
     `github_(create|update|delete|merge|push|add)*`, `*_delete_*`, `supabase_*` writes.
   - ask: every other MCP tool.
5. **Unknown** → ask.

`what`, `where` and `undo` are written per rule, in plain language, with the relevant
argument interpolated (the host for a request, the path for a deletion, the command for
a shell call). They are the prompt's whole text; the raw arguments stay available behind
a disclosure.

### Components and responsibilities

**`src/risk.ts`** (new). Owns the tiers, the rules, and the plain-language text for
each. Depends on `parseCommandLine` and the config's override lists. Does not own when
to ask, how to ask, or what a decision means.

**`src/permissions.ts`** (changed). Owns the asking: `createGate` takes `classify`
instead of a `gated: string[]`, resolves `allowed` immediately, parks `ask` and
`confirm`, and refuses to record "always" for a `confirm` (it settles as a plain
allow-once and says so). Still owns the timeout, `abandon`, and `pending`. Does not own
the rules.

**`src/config.ts`** (changed). `approval.mode` gains `"tiers"` and becomes the default;
`"ask"` keeps today's flat behaviour for anyone who wants it; `"auto"` is unchanged.
Adds `approval.allowTools` and `approval.confirmTools`.

**Event and snapshot types** (`src/events.ts`, mirrored in `client/src/lib/types.ts`
and `client/src/lib/session-types.ts`). `permission.ask` and `PendingPermission` carry
`tier`, `what`, `where`, `undo`. Old events without them still render (the fields are
optional, and the prompt falls back to the tool name).

**`client/src/components/permission-prompt.tsx`** (changed). Owns the prompt: the
sentence, the location, the undo line, two or three buttons depending on the tier, and
the technical detail behind a toggle. Does not decide anything.

### Decisions

**Tiers are computed from arguments, not just names.** The difference between a build
and a deploy is in the arguments, so a name-only policy can only be wrong in one
direction or the other. Rejected: keeping name-only and splitting `shell` into several
tools, which pushes the same judgment onto the model instead of the harness. Cost: the
classifier has to parse shell commands, and a command it parses differently from the
shell tool would misjudge — mitigated by using that tool's own parser.

**Unknown means ask, never allowed.** A new tool, a new MCP server, or a renamed tool
must not quietly gain the right to act unasked. Cost: adding a tool without a rule means
an unnecessary prompt until someone writes one, which is the failure everyone notices
and nobody gets hurt by.

**"Always" is refused for `confirm`.** The tier exists precisely for actions where a
blanket yes is the danger. Rejected: letting "always" work everywhere and relying on the
person to be careful. Cost: a person deploying ten times answers ten times.

**`node` and `npx` are ask, not allowed.** They are how a build gets done, so this
costs a prompt in some builds — but they execute code the harness has not seen, and
treating them as safe would make the rest of the boundary decorative. The scaffold and
dev-server tools exist partly so the common cases do not need them.

**The plain-language text lives with the rule, not in the UI.** One rule, one sentence:
the classifier is where what-it-does is known. Rejected: a lookup table in the client,
which would drift from the rules and cannot see the arguments.

**The token moves to `.env` with no code change.** `src/mcp.ts` already spawns servers
with `{ ...process.env, ...config.env }`, so deleting the `env` block from the GitHub
server entry and adding the variable to `.env` is enough. Cost: none; it should have
been there from the start.

## 5. Invariants and requirements

### Invariants

- `INV-18` Every permission decision goes through `classify`; no tool bypasses it, and
  a tool with no matching rule is `ask`.
- `INV-19` A `confirm` action is asked every time it occurs, and answering "always"
  never suppresses a later `confirm` — for that tool or any other.
- `INV-20` `allowed` actions never park, never emit `permission.ask`, and never block a
  turn.
- `INV-21` `classify` is pure: it reads no files, runs no processes, and makes no
  network calls, so classifying can never itself be the risky act.
- `INV-22` Every `ask` and `confirm` carries a non-empty `what` and `undo` written in
  plain language; the raw arguments remain available.
- `INV-23` `approval.mode: "auto"` allows everything and `"ask"` reproduces today's
  flat name-based behaviour, both unchanged by this design.
- `INV-24` No secret appears in `dulo.config.json`; MCP servers receive secrets from
  the harness environment.

### Requirements

- A full Northwind-style build (scaffold, writes, install, build, dev server, browser
  checks) completes with zero prompts.
- A deploy, an external write, a recursive delete, and a non-GET `http_request` each
  prompt, every time, with no "always" button.
- The prompt reads as a sentence a non-engineer can answer without help.
- The event log records allowed actions too, so "what did it do unasked" is answerable
  after the fact.

## 6. Interfaces and data

```ts
export type RiskTier = "allowed" | "ask" | "confirm";
export interface RiskAssessment {
  tier: RiskTier;
  /** "Dulo wants to delete a folder and everything in it" */
  what: string;
  /** "workspace/northwind-coffee/src" — where it happens, or the host/account. */
  where: string;
  /** "This cannot be undone." / "You can change the file back afterwards." */
  undo: string;
}
export const classify: (
  tool: string,
  args: Record<string, unknown>,
  policy: { allowTools: string[]; confirmTools: string[] },
) => RiskAssessment;
```

Config:

```json
"approval": {
  "mode": "tiers",
  "allowTools": [],
  "confirmTools": [],
  "gateMcpTools": true
}
```

`permission.ask` (and `PendingPermission`) gain optional `tier`, `what`, `where`,
`undo`. A new `permission.auto` event — `{ type, step, tool, args, what }` — records an
allowed action so the log stays complete; it is not rendered as a prompt.

### Naming and identity

Rules are keyed by exact tool name, or by a regular expression for MCP families. A
renamed tool loses its rule and falls back to `ask`, which is the safe direction. The
config's override lists are exact names only: a glob there would quietly widen over time
as tools are added.

## 7. Failure behavior and lifecycle

`classify` throws (a malformed argument): the gate treats it as `confirm` with the text
"Dulo wants to do something the safety check could not read", because a classifier that
cannot judge an action must not wave it through. An unparseable shell command: `ask`.
No answer in five minutes: denied, as today. The turn is cancelled while a prompt is
open: `abandon` denies it, as today. Config lists a tool that does not exist: ignored
with a startup warning. `approval.mode` invalid: warning, defaults to `"tiers"`. The
client is an old build that does not know the new fields: it renders the tool name and
JSON, as today, and the buttons still work.

## 8. Security, privacy, and operations

Trust boundary. This is the boundary: everything `allowed` is confined to the workspace
by `resolveSafe` or is a read. Everything that leaves — the network, other people's
systems, money — is `ask` or `confirm`. The known hole is named rather than hidden:
`node`/`npx` under `shell` run uninspected code, so they are `ask`, and nothing beyond
that is claimed. A real sandbox is out of scope.

Secrets. The GitHub PAT moves from `dulo.config.json` to `.env`; `.env.example` gains
the variable name only. The owner's existing token should be rotated, since it has sat
in a tracked file's working copy.

Operations. Classification costs a string parse per tool call, nothing measurable. The
five-minute timeout means an unattended run stops at the first `ask`, which is correct;
a genuinely unattended build should use `mode: "auto"` deliberately, not by accident.

## 9. Acceptance criteria

- `AC-16` A scripted turn performing `scaffold_project`, `write_file`, `make_dir`,
  `npm run build` via `shell`, and `dev_server start` completes with zero
  `permission.ask` events.
- `AC-17` `remove_path` with `recursive: true` classifies as `confirm`; without it,
  `allowed`.
- `AC-18` `shell` classifies `npm run build` as `allowed`, `node script.js` as `ask`,
  and `git push` as `confirm`.
- `AC-19` `http_request` GET is `ask`; POST is `confirm`.
- `AC-20` Answering "always" for an `ask` tool suppresses its later asks in that turn;
  a later `confirm` for the same tool still prompts.
- `AC-21` Every `ask`/`confirm` produced by the built-in rules has a non-empty `what`
  and `undo`; a tool with no rule is `ask`.
- `AC-22` `mode: "auto"` produces no asks; `mode: "ask"` reproduces the flat
  name-based behaviour against `DEFAULT_GATED_TOOLS`.
- `AC-23` `dulo.config.json` contains no value matching a token pattern, and the GitHub
  MCP server still works with the variable in `.env`.
- `AC-24` The prompt renders the sentence, the location and the undo line, offers no
  "always" button for `confirm`, and keeps the raw arguments reachable.

## 10. Test approach

`risk.test.ts` covers the rule table directly: one case per tier per family, the shell
matrix (`AC-18`), `remove_path` (`AC-17`), `http_request` (`AC-19`), the unknown-tool
default and the config overrides (`AC-21`), and purity (`INV-21`) by asserting no
filesystem access in the rules. `permissions.test.ts` (new) covers the gate: allowed
resolves without an ask (`INV-20`), "always" on `ask` versus `confirm` (`AC-20`,
`INV-19`), the classifier-throws case, and the timeout. A runner test scripts the stub
LLM through the build sequence and asserts zero `permission.ask` events (`AC-16`).
`AC-22` is two config cases in `risk.test.ts` plus one gate test. `AC-23` is a check
script plus a manual confirmation that the GitHub server still lists its tools.
`AC-24` is a real-browser check of the chat at desktop and 400 px, as the repo requires
for UI changes.

## 11. Risks and tradeoffs

- A wrong `allowed` rule is the dangerous failure. Mitigated by defaulting to `ask`,
  keeping `allowed` to reads plus workspace-confined writes, and testing the table.
- A too-noisy policy teaches people to click yes — the exact failure this replaces.
  Mitigated by allowing the whole ordinary build path, including the browser tools.
- The shell classifier and the shell tool could disagree; mitigated by sharing the
  parser, and a test that both see the same binary for a set of commands.
- MCP servers can rename or add tools at any time, so the patterns will go stale; the
  `ask` default means staleness costs a prompt, not an accident.
- Plain-language text is a guess at what a person needs to know; the wording will need
  revisiting after the owner sees real prompts.

## 12. Open questions

- Should "always" persist across turns in a session? Recommended: no, keep the per-turn
  lifetime; a longer memory needs a way to see and revoke it, which is its own feature.
  Does not block.
- Should `allowed` actions appear in the chat at all, or only in the event log?
  Recommended: log only for now; the tool activity is already visible. Does not block.
- Does the owner want `mode: "auto"` available at all once tiers exist? Recommended:
  keep it, clearly documented as "no questions asked", for unattended runs. Does not
  block.
- Rotate the exposed GitHub PAT as part of this, or separately? Recommended: rotate it
  when the token moves. Owner's call.

## 13. Out of scope

- Per-role policies (a reviewer with tighter limits than a builder).
- Persisting decisions across sessions, and any UI for reviewing them.
- Sandboxing `node`/`npx`, or restricting what a dependency's install scripts can do.
- Rate limits, spend caps, and anything about model cost.
- Model and provider choice (Step 4).
