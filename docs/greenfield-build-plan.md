# Greenfield build: task plan

> Implements `docs/greenfield-build-design.md` (roadmap Step 2). Approved by the owner
> 2026-09-14. One task, one commit. Tests first where the task adds behavior. Root
> checks after every task: `npm run typecheck && npm test`. Invariant and acceptance
> ids refer to the design.

**Conventions.** Conventional commits, no attribution trailers. New tests live next to
the code as `*.test.ts` and run under `node --import tsx --test`. Tests never touch
the repo's own `workspace/`, `sessions/`, or `.env`: every test sets
`DULO_WORKSPACE_DIR` (and friends) to a temp directory before importing the module
under test. Never start a harness without `DULO_SESSIONS_DIR` and `DULO_WORKSPACE_DIR`.
Never kill a process you did not start.

## Task 1: `src/paths.ts` and the roots (INV-17, AC-8)

- Add `src/paths.ts`: `HARNESS_ROOT` from `import.meta.url`; `WORKSPACE_ROOT`,
  `SESSIONS_DIR`, `RUNS_DIR`, `CONFIG_FILE`, `TEMPLATES_DIR`, `AGENTS_DIR`,
  `SKILLS_DIR`, `CUSTOM_TOOLS_DIR`, each honoring its env override.
- Wire: `agents.ts`, `skills.ts`, `tools/custom.ts`, `config.ts`, `runs.ts`, the
  session store default, `server.ts` and `index.ts` (`dotenv` from `HARNESS_ROOT`).
- `server.ts`: create the workspace directory at startup, log it with the sessions
  line.
- Test: `paths.test.ts` proves the roots resolve from a different `cwd` and that env
  overrides win.
- Commit: `feat(harness): resolve roles, skills, config and data dirs from the harness location, add the workspace root`

## Task 2: file root to the workspace, three safe file tools (INV-9, INV-10, AC-9)

- `tools/file.ts`: `ROOT = WORKSPACE_ROOT`; add `make_dir`, `move_path`,
  `remove_path` (recursive optional; refuse the root).
- `permissions.ts`: gate the three tools.
- Test: `file.test.ts` against a temp workspace: confinement (outside path, symlink
  escape), root refusal, the three tools' happy paths.
- Commit: `feat(tools): confine file tools to the workspace; add make_dir, move_path, remove_path`

## Task 3: LLM stall and total timeouts (INV-11, AC-10)

- `llm.ts`: `LLM_STALL_MS` (90 000) and `LLM_TOTAL_MS` (600 000); a per-request abort
  controller combined with the caller's signal; the stall timer resets on every chunk;
  both raise a retryable `network` `LlmError`; a stall after emitted output fails the
  step (existing `emitted` rule).
- Test: `llm.test.ts` with a local server that sends headers and nothing else, low
  timeouts via env; a runner test that the turn ends `failed`.
- `.env.example`: document both.
- Commit: `fix(llm): abort a stalled or over-long model request instead of hanging the turn`

## Task 4: the template and `scaffold_project` (INV-13, AC-11)

- `templates/landing-page/`: the blueprint from the design, pinned versions,
  `{{name}}`/`{{slug}}` placeholders, README with the run command, `.gitignore`.
- `tools/scaffold.ts`: copy, fill, `npm install` (spawn, 180 s cap, tail), refuse a
  non-empty target, validate the slug. Register in `tools/index.ts`, gate it.
- `package.json`: `template:check` script that scaffolds into a temp dir with a real
  install and runs `npm run build` there.
- Test: `scaffold.test.ts` with install skipped: tree, placeholders, refusal, slug
  validation. Run `template:check` once for real.
- Commit: `feat(tools): scaffold_project from a Dulo-owned Vite + React + Tailwind template`

## Task 5: `dev_server` (INV-12, AC-12)

- `tools/dev-server.ts`: start/status/stop, port pick 5200 to 5299, URL detection with
  a 45 s wait, one server per project, idle stop at 30 min, `stopAll()` for shutdown.
  Register, gate, call `stopAll()` from `server.ts`'s `shutdown`.
- Test: `dev-server.test.ts` with a temp project whose `dev` script prints a URL and
  listens, and one that never prints.
- Commit: `feat(tools): dev_server starts, lists and stops a project's dev server on loopback`

## Task 6: Loop Layer 2 (INV-14, INV-15, INV-16, AC-13, AC-14)

- `config.ts`: `loop` block with defaults.
- `loop/report-done.ts`: `createLoopTools({ registry, signal, requestPermission,
  runTurn })` returning `report_done` and `review_verdict`; zod validation; per-turn
  iteration counter; nested reviewer run; result strings per the design.
- `session/runner.ts`: build the per-turn tools and append them to the turn's tools
  (after the profile's policy is applied, so `report_done` is available to a profile
  that allows it).
- `agents/frontend-reviewer.md`: read-only + browser + `review_verdict`; judge fixed
  ids only.
- Tests: `report-done.test.ts` with the stub LLM scripting `review_verdict` pass and
  fail; validation and cap cases; `agents.test.ts` asserting the reviewer's tool map
  has no writing or process tool.
- Commit: `feat(loop): report_done gate with an independent frontend-reviewer run`

## Task 7: skill, docs, env (no new invariant)

- `skills/frontend-greenfield-scaffold.md`: blueprint, conventions, tool usage, dated
  versions.
- `.env.example`, README (workspace, new env vars, new tools), design status lines,
  `context.md` §3/§4/§6/§7/§8.
- Commit: `docs: greenfield scaffold skill, workspace and env documentation`

## Task 8: real run (AC-15)

- Scratch harness from an empty directory with `DULO_WORKSPACE_DIR`,
  `DULO_SESSIONS_DIR`, `DULO_CONFIG` pointing at a scratch config that enables only the
  Playwright MCP server; run T1 end to end and T8 A/B/C; record results in
  `context.md`. No commit unless something needs fixing.
