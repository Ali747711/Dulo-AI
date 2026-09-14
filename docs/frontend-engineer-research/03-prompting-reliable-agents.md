# Research: writing a system prompt for a reliable multi-stage agent

> For the Frontend Engineer profile (`src/agents/frontend-engineer.md`,
> `docs/loop-engineering-design.md`). Question: how should a system prompt be
> written so an LLM agent reliably follows a multi-stage process, asks good
> questions, self-reviews honestly, and stops correctly — across models? 2026-09-14.

## Sources read

Anthropic — "Building Effective Agents," Schluntz & Zhang, 2024-12-19
(anthropic.com/engineering/building-effective-agents) · "Prompting best practices"
(platform.claude.com/docs/.../claude-prompting-best-practices) · "Best practices for
Claude Code" (code.claude.com/docs/en/best-practices) · Agent SDK, "Handle approvals
and user input" / `AskUserQuestion` (code.claude.com/docs/en/agent-sdk/user-input).

OpenAI — "GPT-4.1 Prompting Guide" and "GPT-5 Prompting Guide," OpenAI Cookbook
(cookbook.openai.com) · Model Spec, chain-of-command (model-spec.openai.com).

Google — "Prompt design strategies," Gemini API docs (ai.google.dev/gemini-api).

Self-correction (peer-reviewed) — Madaan et al., "Self-Refine," arXiv:2303.17651
(2023) · Shinn et al., "Reflexion," arXiv:2303.11366, NeurIPS 2023 · Gou et al.,
"CRITIC," arXiv:2305.11738, ICLR 2024 · Huang et al., "Large Language Models Cannot
Self-Correct Reasoning Yet," arXiv:2310.01798, ICLR 2024 · Kamoi et al., "When Can
LLMs Actually Correct Their Own Mistakes?," arXiv:2406.01297, TACL 2024.

Stopping/completion (2026 preprints, not yet independently replicated — used only
as corroboration of the older literature above) — "When Agents Do Not Stop,"
arXiv:2607.01641 · "From Confident Closing to Silent Failure," arXiv:2606.09863 ·
"When Agents Commit Too Soon," arXiv:2606.22936 · agentpatterns.ai, "Premature
Completion" (practitioner) · digitalapplied.com, "Define Done, Not Effort"
(practitioner) · futureagi.com glossary, loop detection (practitioner, secondary).

Question-asking — "Ask or Assume?," arXiv:2603.26233 (preprint) · "Ask Early, Ask
Late, Ask Right," arXiv:2605.07937 (preprint) · Horvitz, "Principles of
Mixed-Initiative User Interfaces," CHI 1999 (read via secondary summary — ACM
original paywalled).

Prompt hygiene — Liu et al., "Lost in the Middle" (read via secondary
citations/snippets, not primary text) · Chroma Research, "Context Rot," 2025
(trychroma.com/research/context-rot).

All web sources accessed 2026-09-14.

## Findings

### 1. Agentic prompting guidance — universal vs. model-specific

**Universal (stated or measured by all three vendors):** be explicit and literal
rather than relying on inferred intent; require explicit planning before tool calls
(OpenAI measured **+4% pass rate on SWE-bench** from one planning sentence; Anthropic
frames the same idea as "reflect on tool results before proceeding"); give the model
a way to verify and require evidence over assertion (the single most load-bearing
idea across every source — see §2–3); structure mixed prompts with tags/delimiters
(XML for Claude; XML or Markdown headings for Gemini); prefer positive framing with a
stated reason over "don't" (Anthropic: an explained rule generalizes, a bare
prohibition doesn't). Confidence: high — directly stated or measured, not inferred.

**Model-specific — do not port verbatim:** OpenAI's literal "keep going until the
user's query is completely resolved" persistence sentence was written because GPT-4.1
defaults to chatbot-like turn-taking; Anthropic's current Claude models default the
opposite way and Anthropic's own migration notes say to *dial back* "you MUST"
language tuned for older models because newer ones over-trigger on it. Claude Opus 5
verifies its own work well by default, so inherited "verify before finishing"
instructions now cause wasteful over-verification on it — the opposite problem a
weaker model has. Reasoning/effort dials (Claude `effort` + adaptive thinking; GPT-5
`reasoning_effort`) are vendor-specific parameters, not prompt text.

**Implication for Dulo:** write the profile at the universal level above; keep any
per-model dial (verification verbosity, effort) out of the shared prompt, since it
must run on OpenRouter free models today and Claude/OpenAI/Gemini later (Decision 3).
None of these vendor docs benchmark small/free models — calibration needs Dulo's own
test briefs.

### 2. Self-correction research: when does review actually help?

Five papers, 2023–2024, converge on one answer. Self-Refine (Madaan 2023) gets ~20%
improvement from purely self-generated critique — but its tasks are later flagged as
unusually forgiving of intrinsic self-judgment. Reflexion's (Shinn 2023) strongest
result (91% pass@1, HumanEval) leans on **environment-sourced** signals (unit test
results), not model opinion. CRITIC (Gou 2023) states its finding as the paper's
thesis: "external feedback [is of] crucial importance... in promoting the ongoing
self-improvement of LLMs." Huang et al. (2023) is the sharp negative case: LLMs
"struggle to self-correct... without external feedback, and at times... performance
even degrades after self-correction." Kamoi et al.'s 2024 survey resolves the set:
self-correction from a model's own prompted feedback alone is not demonstrated to
work outside a few unusually suited tasks; it works when there is **reliable external
feedback**, or when correction was fine-tuned in — not available to a system-prompt-
only agent. Confidence: high, independent groups converge, and Anthropic's own Claude
Code docs echo it as design law: "Claude stops when the work looks done. Without a
check it can run, 'looks done' is the only signal available... Give Claude something
that produces a pass or fail." This validates, rather than changes, Dulo's existing
evidence-based Review design.

**Implication:** never phrase Review as "check your work" (invites intrinsic
self-judgment). Phrase it as "run `<check>`, quote its output as the evidence."

### 3. Checklists, definition of done, and stopping

"Premature completion" — declaring success at the first sign of progress while
requirements go unverified — is independently named by at least four 2026 research
efforts under different labels ("fixing correct code," "gave up prematurely,"
"inflated resolution rates"), attributed to training data dominated by single-fix
trajectories plus context pressure making re-reading the spec costlier than
declaring victory. "From Confident Closing to Silent Failure" (2606.09863) frames it
as a reporting gap: confident closing language with nothing re-checking the world
against the claim; fix is evidence over assertion, same as §2. "When Agents Commit
Too Soon" (2606.22936) documents an earlier-stage version: agents lock onto one
reading of ambiguous input and defend it rather than revise — relevant to why Dulo
clarifies *before* Plan. On loops, "When Agents Do Not Stop" (2607.01641) is blunt:
every confirmed infinite-loop case shared one cause, "the repeated path is not
covered by a strong bound," with continuation left "controlled by model outputs"
instead of a deterministic condition; its recommendation is explicit stopping rules,
not reliance on model behavior. Practitioner framing (futureagi.com, secondary):
"the cap is not the fix, it is the fire alarm... raising the number just means it
loops longer... before stopping." "Definition of done" as a prompt pattern
(digitalapplied.com) converges on the same four moves already in Dulo's design: a
measurable end state, a named check, the check's real output as evidence, iterate
until it holds.

Confidence: high for "evidence over assertion" and "bounds must be deterministic";
medium for the specific 2026 preprints individually, used here only as corroboration
of the older literature.

### 4. Question-asking discipline

Models under-ask by default — "state-of-the-art LLMs often do not ask clarifying
questions when presented with an ambiguous request... instead respond directly,"
traced to RLHF preference data rewarding a direct answer — so Dulo needs explicit,
not incidental, instruction to overcome this default. "Ask or Assume?" (2603.26233)
shows uncertainty-calibrated asking (conserve questions on simple tasks, ask on
complex/ambiguous ones) beats both never-ask and always-ask baselines, and that
decoupling "is this ambiguous" from "go execute" helps — the same shape as Dulo's
separate Understand-and-Clarify stage. "Ask Early, Ask Late, Ask Right" (2605.07937)
is the most load-bearing finding for Dulo's "clarify once, up front" rule: timing
beats volume, and goal-level clarification "loses nearly all value after 10% of
execution," while "deferring any clarification type past mid-trajectory degrades
performance *below never asking at all*" — a late question is worse than none,
because the agent already committed on a wrong assumption. Real models currently get
this wrong in both directions (some sessions over-ask, some never ask). Horvitz's
mixed-initiative principles (1999, secondary source) are the HCI-side version of the
same trade-off — weigh interruption cost against the cost of a wrong guess, scaled by
confidence and reversibility — arrived at independently by the 2026 ML papers.
Confidence: medium on Horvitz specifics (not read primary), high on the timing
finding's direction.

**Phrasing for non-experts:** Claude Code's own `AskUserQuestion` tool is a concrete,
shipped design worth copying structurally: 1–4 questions per round, 2–4 labeled
options each with a plain-language description, plus a free-text "other." This turns
"compose an answer" into "recognize and pick," which is the right shape for a
non-technical user answering about pages/style/fonts/colors. Confidence: high — this
is a production design, not a claim.

### 5. Prompt hygiene: length, structure, conflicts

Anthropic's own CLAUDE.md guidance states the dilution risk directly: "Bloated
CLAUDE.md files cause Claude to ignore your actual instructions," with a concrete
test — "would removing this line cause a mistake? If not, cut it" — and a note that
emphasis stops working under overuse ("if you emphasize many lines, none of them
stands out"). Chroma's "Context Rot" (2025) supplies a mechanism: contrary to the
assumption of uniform context use, performance "grows increasingly unreliable as
input length grows," and degrades faster when the needed instruction isn't a close
lexical match to nearby text — i.e., paraphrased/implicit rules decay faster than
exact-keyword ones. "Lost in the middle" (secondary source) is the positional
version: best attention at the start and end, worst in the middle; Gemini's docs
independently give the same practical rule (constraints/persona at the very start,
the specific ask at the very end). OpenAI's Model Spec chain-of-command
(System > Developer > User > Guideline) is a designed answer to instruction
conflicts — its existence is evidence conflicts are common enough to need a standing
resolution order; inside one profile, the analogous move is stating priority once,
clearly, rather than restating rules informally in several places.

Confidence: high that bloat causes ignored instructions (stated by the vendor whose
product this pattern is drawn from) and that positional effects exist (widely
replicated, though not read first-hand here); medium-high on Chroma's specific
similarity mechanism (single industry source, not peer-reviewed, but consistent with
the academic result).

## Rules for Dulo's Frontend Engineer profile (ranked)

1. Every Review checklist item's evidence must be a quoted tool/command/browser
   result; "pass" without one is invalid — an instruction to fetch-and-quote, not to
   self-judge. *Source: CRITIC; Kamoi 2024; Huang 2023; Claude Code best practices.*
   Validates the existing DOD table / `report_done` schema.
2. State the four stop reasons as a closed, named list, and forbid "done" /
   "finished" / "complete" outside the pass branch in that same sentence.
   *Source: 2607.01641; 2606.09863.* Matches INV-7.
3. Write the iteration cap and "fails twice in a row → Blocked, not a third try" as
   a literal numeric condition, not "keep trying until it works." *Source: 2607.01641;
   futureagi.com.* Matches INV-3/INV-4.
4. Phrase clarifying questions as a short structured set — a few questions, 2–4
   labeled options each with a plain description, plus free text — not an open
   paragraph. *Source: Anthropic's `AskUserQuestion` design.*
5. Clarify once, before Plan, and say explicitly that a later clarification is worse
   than none — a missed requirement past that point becomes a stated assumption or a
   Blocked stop. *Source: 2605.07937 (goal-clarification value collapses ~10% in;
   late clarification underperforms never asking).* Matches INV-6.
6. When the model chooses not to ask, require it to write the assumption down in
   plain language next to what triggered it. *Source: 2603.26233 (default behavior
   is silent assumption).* Matches DOD-1.
7. Prefer positive instructions with a one-clause stated reason over bare
   prohibitions — a reason is also more likely to transfer to a non-Claude model.
   *Source: Anthropic prompting best practices.*
8. Keep the profile to identity + the five-stage skeleton; keep the DOD checklist
   text in its own skill file, loaded at Plan and Review, not inlined. *Source:
   Anthropic CLAUDE.md guidance; Chroma context-rot.* Already the design's decision —
   research is a reason to hold the line as the profile grows.
9. Put non-negotiable rules (stop-reason list, no-pass-without-evidence, the
   assumption rule) at the very start or end of the profile, never mid-prose.
   *Source: lost-in-the-middle; Gemini placement guidance.*
10. Scope the independent reviewer strictly to the fixed checklist ids and forbid
    free-form nitpicks beyond them. *Source: Claude Code best practices, verbatim: "a
    reviewer prompted to find gaps will usually report some, even when the work is
    sound... tell the reviewer to flag only gaps that affect correctness or the
    stated requirements."* Directly shapes `frontend-reviewer.md`.
11. Give explicit permission and a mechanism (the brief file) to keep going across a
    long build without stopping early "because it's been a while." *Source:
    Anthropic's context-awareness guidance; GPT-4.1 persistence reminder.*
12. Calibrate the model's own risk judgment with a reversibility test, in addition to
    the harness's permission gate. *Source: Anthropic's "balancing autonomy and
    safety" sample prompt; GPT-5's tiered uncertainty thresholds.* Reinforces
    Decision 4 at the identity level.
13. Treat the profile text as vendor-neutral: encode the underlying behavior
    (persistence, plan-before-act, verify-before-claiming) in plain instructional
    language; let per-model config carry any vendor-specific dial. *Source: the
    model-specific-vs-universal split in §1; required by Decision 3.*
14. Use a small, consistent set of structural tags for the stop-reasons/checklist/
    assumptions blocks so a weaker model can pattern-match structure over prose.
    *Source: Anthropic XML-tag guidance; Gemini delimiter guidance.*
15. Never phrase the Review instruction as "double-check" or "does this look right"
    — name the check. A sharper restatement of rule 1: the failure mode is choosing
    an easy-sounding, ungrounded verb. *Source: Huang 2023; Kamoi 2024; 2606.09863.*

## Pitfalls to avoid

- Premature completion on first sign of progress — a build that compiles isn't a
  build that matches the brief; the checklist is the completion signal, not a
  compile success. (agentpatterns.ai; 2606.22936)
- Model-controlled loop bounds — "keep iterating until it feels done" must never be
  the only stop condition; the cap is a counter the harness/prompt enforces
  deterministically. (2607.01641)
- Reusing verification phrasing tuned for a different model unchanged — can flip
  from fixing under-verification to causing wasteful over-verification. (Anthropic,
  Opus 5 guidance)
- A reviewer that free-associates findings beyond the checklist — produces scope
  creep and over-engineering pressure instead of a clean pass/fail. (Claude Code
  best practices)
- An over-specified profile — every added rule competes with every existing rule for
  attention; bloat makes the model ignore parts of all of it. (Anthropic CLAUDE.md
  guidance; context rot)
- Asking too many questions, or asking late — both measured worse than one
  well-timed round; late is worse than none. (2605.07937)
- Negative-only instructions with no stated reason — weaker compliance even on
  Claude, weaker transfer across vendors.
- Assuming "cannot self-correct without external feedback" is a Claude-specific
  finding — it was tested across the GPT-3.5/4 family too; don't assume a stronger
  frontier model is exempt.

## Open questions

- None of the vendor guides or self-correction papers benchmark small/free
  OpenRouter models (what Dulo runs on today per Decision 3); whether these
  techniques transfer with the same effect size is untested here — check against
  Dulo's own test briefs.
- DOD-3 (design quality) is the checklist item this literature engages with least;
  the loop design already names the no-vision limit honestly. This research
  confirms proxies-not-pixels is reasonable for now, but doesn't resolve it.
- The clarification-timing papers measure developer-facing coding agents with
  precise specs, not a non-technical user describing a landing page casually;
  "ask goal questions in the first 10%" likely translates to "ask before any code
  exists" but wasn't tested in that form.
- The 2026 preprints on stopping/false success are recent and not yet independently
  replicated or peer-reviewed; used here only because they agree with the
  established literature and with Anthropic's own shipped guidance.
- No source derives "3" as a principled iteration cap — it's a practitioner/product
  default in Dulo's design, not something this research independently justifies.
- Horvitz's principles and "Lost in the Middle" were read secondhand, not in full
  primary form; verify against primary text before quoting either directly in a
  design document.
