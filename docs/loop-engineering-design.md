# Loop Engineering for the Frontend Engineer role

> **Status:** Proposed for review. Owner: Ali. Author: Claude. 2026-09-14.

## 1. Executive summary

Today Dulo's agent loop runs until the model stops calling tools or hits a step
limit, and whatever the model says at that point is the answer. Nothing makes the
model check its work against the request before it says "done". For a landing
page, that means Dulo can scaffold a project, write the sections once, and report
success without ever running the project or looking at it. The owner, and later a
non-technical user, then finds the problems.

Loop Engineering changes the shape of the work from "build once, report" to
"plan, build, review, improve, and stop only when the Definition of Done is met or
a clear stopping rule fires". The Review step is not an opinion. It is a fixed
checklist derived from the Definition of Done in `CLAUDE.md`, each item proven by
real evidence from the built project (command output, the dev server, the page in
a browser). The agent may stop in exactly four ways: the checklist passes, the
iteration cap is reached, it is blocked on something only the user can decide, or
the user cancels. Only the first is allowed to be called "done".

It lands in two layers. Layer 1 writes the loop into the role's identity and needs
no harness code. Layer 2 makes the stopping rule structural with a small done gate
in the harness and an independent reviewer with fresh context. The main downside
is cost and time: a reviewed build takes more model calls and more minutes than a
single pass. That is the price of not shipping a broken page to someone who cannot
tell it is broken.

## 2. Context and scope

Current behavior. `runTurn` in `src/agent.ts` loops `for step = 1..maxSteps`
(default 8): call the model, run its tool calls, feed results back. The turn ends
when the model answers without tool calls, or at the step limit, where a wrap-up
prompt asks the model to summarise. Tool results are text; MCP image blocks are
replaced by `[image content omitted]` (`src/mcp.ts`). The `manage_todos` tool lets
the model externalise a checklist that the chat renders (`todo-list.tsx`). Agent
profiles (`src/agents/*.md`) set model, temperature, maxSteps, a tool allow-list,
and the system prompt. A session remembers the last agent used as its default
(`Session.defaults`).

Why it is insufficient. The definition of done says Dulo must self-check before
reporting. Nothing in the loop asks for that, records it, or stops a premature
"done". A weaker model, or a strong one on a long task, will end early.

What changes. The Frontend Engineer role follows an explicit loop and cannot report
done without a filled, evidenced checklist. In Layer 2 the harness refuses a done
claim that lacks evidence and can ask a second role to review with fresh eyes.

Boundary. This design covers the loop, the review checklist, the stopping rules,
how they are written into the role, and the small harness pieces that enforce them.
It does not cover the workspace root, the scaffold, or the permission tiers; those
are roadmap Steps 2 and 3 and are named where this design depends on them.

## 3. System context

```
user message ──► session runner ──► runTurn (step loop) ──► tools
                                          │                  ├─ shell / write_file / read_file
                                          │                  ├─ manage_todos  (checklist → chat)
                                          │                  ├─ load_skill    (DoD checklist text)
                                          │                  ├─ browser MCP   (snapshot, console, evaluate, resize)
                                          │                  └─ report_done   (Layer 2: the done gate)
                                          │                         └─ nested runTurn as frontend-reviewer (Layer 2, optional)
                                          ▼
                                   assistant message + run.end
```

Touched: the Frontend Engineer profile (new), one skill (new), one tool (new,
Layer 2), one reviewer profile (new, Layer 2), `dulo.config.json` (a `loop` block,
Layer 2). Preserved: the step loop, the event stream, the session model, the
permission gate. Nothing about how turns, messages, or branches work changes.

## 4. Proposed design

### The loop

Every task runs through the same five stages, in order. The stage names are used
in the role's prompt, in the todo list the user sees, and in the report.

1. **Understand and clarify.** Once, before anything else. Read the request, ask
   the few questions the Definition of Done needs (pages or sections, style
   direction, fonts, colors and tone, key content), and write down every
   assumption made where the user did not answer. Output: the brief.
2. **Plan.** Turn the brief into a build plan and a checklist: the fixed
   Definition of Done items (section 4, "The Review step") plus one line per
   requested section. Write both to `manage_todos` so the user sees them, and to
   the brief file so they survive context condensing.
3. **Act.** Build. Scaffold, structure, sections, content, styling. Mark todo items
   as they finish. Change nothing about the brief.
4. **Review.** Stop building. Run every check in the checklist against the real
   project and record evidence for each item: pass or fail, with the output that
   proves it. No item passes from memory.
5. **Improve or stop.** If any item failed, fix the failures, worst first (broken
   or missing before polish), and go back to Review. If everything passed, or a
   stopping rule fired, stop and report.

One pass through Review and Improve is one **iteration**. The cap is three
iterations per turn by default (`loop.maxIterations`).

### How it works, one real case

A user writes: "Landing page for Northwind Coffee, a small roastery. Warm, simple,
one page." Dulo, as the Frontend Engineer, replies once with four questions:
which sections (hero, story, products, location, contact?), any brand colors or
fonts, the key facts to show (address, hours), and whether there is a logo. The
user answers two and says "you decide" for the rest. Dulo writes the brief with
the two answers and two stated assumptions (a warm cream and espresso palette; a
serif display font with a plain sans body), then a plan and a checklist through
`manage_todos`. The chat shows the checklist.

Dulo scaffolds the project in the workspace, builds five section components,
writes the content, and styles them. It marks the build todos done and starts
Review: `npm run build` (passes), `npm run dev` (starts on a port, URL captured),
opens the URL in the browser, takes the accessibility snapshot at desktop and at
400 px wide, reads the console, runs the overflow and contrast checks. The
snapshot shows four sections, not five: the location section is missing. The
console is clean. Review records DOD-4 (brief fit) as fail with the evidence
"snapshot lists headings: Hero, Our Story, Products, Contact; brief requires
Location". Iteration 1 ends.

Improve adds the section, Review runs again, everything passes. Dulo calls
`report_done` with the filled checklist (Layer 2) or, in Layer 1, includes it in
the report. The report says: what was built, the two assumptions, the path, the
command to run it, and the checklist with evidence. The user runs `npm run dev`
and sees the page.

### The Review step, against the Definition of Done

The checklist is fixed. Item ids never change once used; new checks get new ids.

| Id | Definition of Done says | What Review checks | Evidence that counts |
| --- | --- | --- | --- |
| DOD-1 | Clarification is complete | The brief names pages or sections, style direction, fonts, colors and tone, key content; every gap has a stated assumption | The brief file, quoted |
| DOD-2 | Properly built | Stack is React + TypeScript + Tailwind on Vite (or the agreed equivalent); `npm install` and `npm run build` exit 0; one component per section; no file over ~300 lines; no `any` | Last lines of each command's output; the file tree |
| DOD-3 | Design quality is solid | One `h1`; every section has a heading; fonts on the page are the brief's fonts; colors on the page are the brief's palette; contrast passes; at 400 px nothing overflows horizontally and navigation is usable; no broken images; hover and focus states exist on interactive elements | Accessibility snapshots at desktop and 400 px; `evaluate_script` results (computed `font-family`, `scrollWidth <= innerWidth`); `a11y_check_color_contrast`; the reviewer's judgment on hierarchy and spacing |
| DOD-4 | (brief fit, implied by all of the above) | Every requested section is present with its requested content; calls to action link somewhere; no lorem ipsum or `TODO` unless the brief asked for placeholders | Snapshot excerpts, one per section |
| DOD-5 | Ready to run and preview | `npm run dev` starts; the page loads at the printed URL; the console has no errors; a README states how to run it | Dev server output with the URL; console message list; the loaded page's snapshot |
| DOD-6 | Self-checked before reporting | Every item above has a status and evidence; the report includes the checklist | The filled checklist itself (Layer 2: `report_done` accepted it) |

Two honest limits. DOD-3 is the item a checklist can least fully capture; the
checks above are proxies for good design, and the owner's test briefs are what
calibrate the bar. And Dulo cannot see screenshots today: MCP image blocks are
dropped before the model sees them, and the default model is not vision-capable.
Until both change (roadmap Step 4, and image pass-through in `src/mcp.ts`), DOD-3
is judged from structure, computed styles, and the accessibility tree, not from
pixels. The report must say so.

### When the agent may stop

Exactly four stop reasons exist. The report names which one applied.

- **Pass.** Every checklist item is pass with evidence. Only this stop may use the
  word "done".
- **Cap.** The iteration cap is reached with items still failing. The report says
  "not done", lists the failing items with their evidence, and says what the next
  iteration would try. No "done" wording.
- **Blocked.** Something only the user can decide or provide: content Dulo cannot
  reasonably assume, a permission that was denied, a tool that is unavailable
  (for example no browser MCP, so DOD-5's preview cannot be proven), or the same
  item failing twice with no change in between. The report states what is
  finished, what is blocked, and the one question that unblocks it.
- **Cancelled.** The user stopped the turn. Nothing further is reported.

Two rules keep the loop from spinning. Each iteration must change something
concrete; an Improve that changes nothing is a Blocked stop. And an item that
fails twice in a row for the same reason is a Blocked stop, not a third attempt.

### How it is written into the role

The role's profile, `src/agents/frontend-engineer.md`, carries the loop as its
working process: the five stages in order, the clarifying checklist, the
assumption rule, the Review rule ("no item passes from memory; every pass quotes
its evidence"), the four stop reasons and the report shape for each, and the
instruction to keep the checklist in `manage_todos` and in the brief file. The
Definition of Done checklist itself lives once, in a skill,
`src/skills/frontend-definition-of-done.md`, so the builder and the reviewer read
the same text; the profile tells the role to load it at Plan and at every Review.
The profile sets `maxSteps` high enough for three iterations (recommended 40) and
allows the tools the loop needs: file tools, `shell`, `manage_todos`, `load_skill`,
the browser MCP tools, and `report_done`.

The reviewer profile, `src/agents/frontend-reviewer.md` (Layer 2), is read-only
plus browser tools. It receives the brief, the checklist, and the project path,
runs the same Review checks, and returns a structured verdict. It never edits.

### Components and responsibilities

**Frontend Engineer profile** (new). Owns the loop discipline, the questions, the
assumptions, the build, the self-review, and the report. Depends on the skill for
the checklist text and on the browser MCP for DOD-3 and DOD-5. Does not own
whether a done claim is accepted; that is the gate's job in Layer 2.

**Definition-of-Done skill** (new). Owns the checklist text and item ids. Depends
on nothing. Does not own how items are proven; each role does that.

**`report_done` tool** (new, Layer 2). Owns acceptance of a done claim: every
item present, every status `pass`, every evidence non-empty, and, when
`loop.independentReview` is on, a passing reviewer verdict. Rejects otherwise with
the list of unproven items, which sends the builder back to Improve. Counts calls
within the turn and, at `loop.maxIterations`, returns "cap reached, stop and
report not done". Depends on `runTurn` and the agent registry to run the nested
reviewer. Does not own the checklist text, the build, or the report.

**Frontend Reviewer profile** (new, Layer 2). Owns an independent verdict with
fresh context. Depends on the same skill and browser tools. Does not own fixing
anything.

**Config** (`dulo.config.json`, Layer 2). `loop: { maxIterations: 3,
independentReview: true, reviewer: "frontend-reviewer" }`.

### Decisions

**Two layers, identity first.** The loop is written into the role before any code
exists to enforce it, because the Mission says identity and process come first and
because Layer 1 can be tested with the test briefs immediately. Rejected: building
the gate first. Cost: until Layer 2 lands, a premature "done" is caught only by
the owner reading the report.

**The done gate is a tool, not a new loop controller.** `report_done` is a
normal tool the model must call; the harness never has to detect "the model thinks
it is finished" from prose. Rejected: a state machine in the session runner that
inspects assistant text. Cost: a model that forgets to call the tool ends the turn
without a done claim, which the report rule treats as not done; the profile
instructs the call explicitly.

**The independent reviewer runs nested inside `report_done`, in the same turn.**
The tool runs a second `runTurn` with the reviewer profile and returns its verdict
as the tool result. Rejected: enqueueing a reviewer turn through the message queue
and a follow-up builder turn, which would spread loop state across turns and put
automatic messages into the user's conversation. Cost: `report_done` needs access
to `runTurn` and the registry when it is created, and a nested run doubles model
cost for that call.

**Fixed checklist ids.** The same ids appear in the skill, the tool schema, the
reviewer's verdict, and the report, so a finding always points at one rule.
Rejected: free-form review notes. Cost: adding a check means touching the skill
and the tool schema together.

**The brief lives in a file, outside the deliverable.** `<workspace>/.dulo/<slug>/
brief.md` holds the brief, assumptions, and checklist, so Review and the reviewer
read the same source after context condensing (`TOKEN_BUDGET` is 24k tokens) and
the generated project stays exactly what the user asked for. Rejected: inside the
project, which would ship Dulo's notes with the user's site.

## 5. Invariants and requirements

### Invariants

- `INV-1` The role reports "done" only after a Review in which every checklist
  item is `pass` with non-empty evidence (Layer 2: only after `report_done`
  accepted the claim).
- `INV-2` Every Review runs its checks against the actual project through tools
  in that same Review; no item is marked pass from memory or from an earlier
  iteration.
- `INV-3` At most `loop.maxIterations` iterations run per turn; reaching the cap
  ends the turn with a "not done" report, never a "done" claim.
- `INV-4` An item that fails twice in a row for the same reason ends the turn as
  Blocked with a question; there is no third attempt on it in that turn.
- `INV-5` Review and the reviewer change no files; edits happen only in Act and
  Improve.
- `INV-6` Clarification happens once, before Plan; the loop re-opens it only by
  stopping as Blocked.
- `INV-7` Every report names exactly one stop reason: pass, cap, blocked, or
  cancelled.
- `INV-8` `report_done` rejects a claim that is missing any checklist id, any
  status other than `pass`, or any empty evidence, and the rejection lists the ids.

### Requirements

- The checklist is visible in the chat during the run (through `manage_todos`).
- The final report includes the project path, the run command, the assumptions,
  the stop reason, and the checklist with evidence.
- A "not done" or "blocked" report never uses the words "done", "finished", or
  "complete" for the whole task.
- The report is written for a non-technical reader; evidence may be technical but
  the summary is not.

## 6. Interfaces and data

`report_done` (tool, Layer 2), input:

```json
{
  "projectPath": "workspace/northwind-coffee",
  "runCommand": "npm run dev",
  "summary": "one paragraph for the user",
  "checklist": [
    { "id": "DOD-1", "status": "pass", "evidence": "brief.md: sections=…, fonts=…, palette=…, assumptions=2" },
    { "id": "DOD-2", "status": "pass", "evidence": "npm run build: 'built in 1.02s', exit 0" }
  ]
}
```

Output: `accepted` with the reviewer verdict when one ran, or `rejected: DOD-4
(evidence empty), DOD-5 (status fail)`, or `cap reached (3/3): stop and report
not done`. Validation is with zod, like the session routes.

Reviewer verdict (returned by the nested run, structured through a tool the
reviewer must call, `review_verdict`): `{ verdict: "pass" | "fail", findings:
[{ id, severity: "must-fix" | "should-fix", what, where, fix }] }`.

Config: `loop.maxIterations` (integer, default 3), `loop.independentReview`
(boolean, default true once the reviewer exists), `loop.reviewer` (agent name).

Brief file: `<workspace>/.dulo/<slug>/brief.md`, Markdown, sections: Request,
Answers, Assumptions, Plan, Checklist.

### Naming and identity

Checklist ids are fixed strings from the skill. `<slug>` is derived from the
brief's company or product name, lower-case, hyphenated, deduplicated with a
numeric suffix if the folder exists; roadmap Step 2 owns the exact rule. If the
name is missing, the slug is `landing-page-<n>`. Renaming a project later does not
move the brief file; the report links path and brief explicitly.

## 7. Failure behavior and lifecycle

The dev server fails to start (port busy, missing dependency): Review records
DOD-5 as fail with the output; Improve fixes it (another port, install); the cap
still applies. The browser MCP is not available: DOD-3 and DOD-5 cannot be proven;
the role stops as Blocked and says which tool is missing. A shell command is
denied by the permission gate: Blocked, naming the command. The step limit is hit
mid-loop: the existing wrap-up prompt runs; the profile instructs that a wrap-up
must report the true state (what passed, what did not) and never claim done. The
context is condensed mid-run: the brief and checklist are re-read from the brief
file at the next Review. The nested reviewer fails (model error): `report_done`
returns the error as a rejection; the builder may retry once, then stops as
Blocked. The user cancels: the turn is cancelled as today; partial work stays in
the workspace and the next turn can resume from the brief file. Several things
fail together: the first Blocked condition wins; the report lists all of them.

## 8. Security, privacy, and operations

Trust boundary. The loop runs shell commands (`npm install`, `npm run build`,
`npm run dev`) and writes files only inside the workspace. Until roadmap Step 3
lands its tiers, every one of these asks for permission, so a Layer 1 run is
interruptive but safe. The reviewer is read-only plus browser tools and cannot
change files. No deploy, no external write, no network beyond the local dev
server and the package registry `npm install` reaches.

Cost and limits. Each iteration adds model calls; the cap bounds it at three, and
the profile's `maxSteps` (40) bounds the turn. `TOKEN_BUDGET` (24k) will condense
long runs; the brief file is the recovery. Dev servers must be stopped at the end
of a turn or reused; a leaked server is a port held, not a safety issue. On the
free OpenRouter tier the shared daily cap can end a run mid-loop; that surfaces as
a failed turn, and the workspace keeps the partial project.

## 9. Acceptance criteria

- `AC-1` For each test brief, the transcript shows the five stages in order, with
  at least one Review whose evidence quotes real command and browser output
  before any report.
- `AC-2` When a required section is removed from the built project before Review
  (test setup), Review marks DOD-4 fail with the missing heading named, and
  Improve restores it before the report says done.
- `AC-3` `report_done` called with one item's evidence empty returns a rejection
  naming that id, and the turn continues rather than ending.
- `AC-4` With `loop.maxIterations` set to 1 and a brief that cannot pass, the
  report says "not done", lists the failing items, and contains no "done" claim.
- `AC-5` When the same item fails twice for the same reason, the turn ends with
  one question to the user and no third build attempt.
- `AC-6` A passing run's report contains the path, the run command, the
  assumptions, the stop reason "pass", and all six checklist items with evidence.
- `AC-7` With `loop.independentReview` on, a reviewer verdict of `fail` makes
  `report_done` reject, and the findings appear in the tool result.

## 10. Test approach

Layer 1 is proven with the test briefs in `docs/frontend-engineer-test-tasks.md`
run through the chat against a real model; the owner reads the transcripts and the
result for `AC-1`, `AC-2`, `AC-6`, `INV-1`, `INV-2`, `INV-6`, `INV-7`. Layer 2 adds
harness tests with the existing stub LLM (`src/session/testing/stub-llm.ts`), which
can script tool calls: a scripted `report_done` with an empty evidence field proves
`AC-3` and `INV-8`; a scripted loop that never passes proves `AC-4` and `INV-3`; a
scripted repeated failure proves `AC-5` and `INV-4`; a scripted reviewer `fail`
proves `AC-7`. `INV-5` is enforced by the reviewer profile's tool allow-list and
checked by reading it.

## 11. Risks and tradeoffs

- The model skips Review or marks items pass without evidence. Mitigation: Layer 2
  rejects empty evidence; Layer 1 relies on the prompt and the owner's reading.
- DOD-3 (design quality) is under-checked without vision. Mitigation: proxies and
  the reviewer's structural judgment now; image pass-through and a vision-capable
  reviewer model in Step 4; the report states the limit.
- Cost and time roughly double or triple per task. Mitigation: the cap, and
  `independentReview` can be turned off for cheap runs.
- Permission prompts on every command make Layer 1 runs tedious. Mitigation:
  roadmap Step 3 tiers; until then, "always" for the run.
- Context condensing loses the brief. Mitigation: the brief file, re-read at
  Review.

## 12. Open questions

- Should the independent reviewer be part of Step 2 or come later? Recommended:
  Step 2, on by default; fresh context is what makes Review honest. Does not block
  Step 1.
- Iteration cap default 3? Recommended yes. Does not block.
- Image pass-through in `src/mcp.ts` plus a vision-capable reviewer model: Step 4
  or earlier? Recommended: Step 4. Does not block.
- Brief file outside the deliverable (`<workspace>/.dulo/<slug>/`) or inside the
  project? Recommended: outside. Does not block Step 1.

## 13. Out of scope

- The workspace root, scaffold choice, and slug rule (roadmap Step 2).
- Permission tiers and the non-technical popup (roadmap Step 3).
- Model and provider choice (roadmap Step 4).
- Deployment of the result.
- Loops for roles other than the Frontend Engineer; the pattern is reusable, the
  checklist is not.
