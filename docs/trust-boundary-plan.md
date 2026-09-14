# Trust boundary: task plan

> Implements `docs/trust-boundary-design.md` (roadmap Step 3). Approved by the owner
> 2026-09-14. One task, one commit. Tests first. Root checks after every task:
> `npm run typecheck && npm test`. Client checks when `client/` is touched:
> `npm run typecheck && npm run lint && npm run build && npm test`. Invariant and
> acceptance ids refer to the design.

**Conventions.** Conventional commits, no attribution trailers. Tests set
`DULO_WORKSPACE_DIR`/`DULO_SESSIONS_DIR`/`DULO_CONFIG` to temp paths before importing
the module under test. Never start a harness without those. Never kill a process you
did not start.

## Task 1: the classifier (INV-18, INV-21, INV-22; AC-17, AC-18, AC-19, AC-21)

- Add `src/risk.ts`: `RiskTier`, `RiskAssessment`, `classify(tool, args, policy)`.
  Rule order: config overrides → built-in tools (by name, by argument where needed) →
  shell (via `parseCommandLine` from `src/tools/system.ts`) → MCP patterns → unknown.
  Each rule supplies `what`, `where`, `undo` in plain language.
- Test `src/risk.test.ts`: one case per tier per family; the shell matrix; `remove_path`
  recursive vs not; `http_request` GET vs POST; unknown default; override lists; every
  built-in rule produces non-empty `what`/`undo`; the classifier touches no filesystem.
- Commit: `feat(harness): classify a tool call's risk from its arguments, not just its name`

## Task 2: the gate asks by tier (INV-19, INV-20, INV-23; AC-20, AC-22)

- `src/permissions.ts`: `createGate` takes `classify: (tool, args) => RiskAssessment`
  in place of `gated: string[]`. `allowed` resolves immediately and calls a new
  `onAuto` hook; `ask` and `confirm` park as today; `always` is recorded only for `ask`
  and never suppresses a `confirm`; a throwing classifier becomes `confirm` with the
  "could not read" text. `DEFAULT_GATED_TOOLS` stays for `mode: "ask"`.
- Test `src/permissions.test.ts`: allowed never parks; always-then-ask is suppressed;
  always-then-confirm still prompts; confirm twice prompts twice; classifier throws →
  confirm; timeout denies; `abandon` denies pending.
- Commit: `feat(harness): the permission gate asks by risk tier, and confirm can never be waved through`

## Task 3: config and registry wiring (INV-23; AC-22)

- `src/config.ts`: `approval.mode` gains `"tiers"` and becomes the default;
  `allowTools`/`confirmTools` string arrays.
- `src/registry.ts`: expose the resolved policy (the two lists plus the mode) so the
  runner and CLI can build a classifier; keep `gatedTools` for `"ask"`.
- `src/session/runner.ts` and `src/index.ts`: build the classifier from the mode —
  `"tiers"` → `classify`, `"ask"` → the flat name check, `"auto"` → everything allowed.
- Test: the three modes through the gate, in `permissions.test.ts` or a small
  `registry.test.ts`.
- Commit: `feat(config): approval.mode tiers, with allow and confirm overrides`

## Task 4: the ask carries plain language (INV-22)

- `src/events.ts`: `permission.ask` gains optional `tier`, `what`, `where`, `undo`; new
  `permission.auto` event.
- Mirror in `client/src/lib/types.ts` and `client/src/lib/session-types.ts`
  (`PendingPermission`, `PendingToolPermission`).
- `src/session/runner.ts`: carry the fields into the ask event and the snapshot
  mapping; publish `permission.auto`.
- Client folds: make sure `permission.auto` does not break `applyEvent` or
  `foldSessionEvent` (both have default cases — verify, add a case if needed).
- Commit: `feat(events): permission asks carry what, where and undo`

## Task 5: the prompt a non-engineer can answer (AC-24)

- `client/src/components/permission-prompt.tsx`: the sentence, the location, the undo
  line; two buttons for `confirm` (Yes / No), three for `ask`; raw arguments behind a
  toggle; falls back to today's rendering when the fields are absent.
- Client checks, then a real-browser check at desktop and 400 px against a scratch
  harness that produces one `ask` and one `confirm`.
- Commit: `feat(client): permission prompt in plain language, with no blanket yes for risky actions`

## Task 6: the token, and docs (INV-24; AC-23)

- `dulo.config.json`: drop the `env` block from the GitHub server (the owner's
  uncommitted edit — ask before touching it, or hand them the exact change).
- `.env.example`: document `GITHUB_PERSONAL_ACCESS_TOKEN`.
- README: the three tiers, in a short table.
- `context.md` §3/§4/§5/§6/§7/§8; design status line.
- Commit: `docs: trust tiers, and the GitHub token moves to the environment`

## Task 7: verification (AC-16, AC-23, AC-24)

- A scripted runner test: the whole build sequence produces zero `permission.ask`
  (AC-16).
- A live scratch harness: confirm the GitHub MCP server still lists its tools with the
  variable in `.env` (AC-23), and the browser check for the prompt (AC-24).
- An independent review of the rule table before calling this done: a wrong `allowed`
  is the one dangerous failure, so the table gets adversarial eyes, not just tests.
- Record results in `context.md`. No commit unless something needs fixing.
