# How the best frontend/UI coding agents define identity and process

Research for Dulo's Frontend Engineer profile (`src/agents/frontend-engineer.md`, roadmap Step 1).
Question: how do v0, Lovable, Bolt, Cursor, Replit, Devin, Windsurf, and the strongest
Claude Code subagent packs frame identity and working process, and what should Dulo borrow?
Does not propose Dulo's own profile — that is a separate step.

## Sources read

Leaked/published product system prompts, read in full from
[x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools)
(143k stars, the canonical collection the task pointed at):

- v0 (Vercel) — [`v0 Prompts and Tools/Prompt.txt`](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/v0%20Prompts%20and%20Tools/Prompt.txt)
- Lovable — [`Lovable/Agent Prompt.txt`](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Lovable/Agent%20Prompt.txt)
- Bolt.new (StackBlitz) — [`Open Source prompts/Bolt/Prompt.txt`](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Open%20Source%20prompts/Bolt/Prompt.txt)
- Devin AI — [`Devin AI/Prompt.txt`](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Devin%20AI/Prompt.txt)
- Windsurf / Cascade — [`Windsurf/Prompt Wave 11.txt`](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Windsurf/Prompt%20Wave%2011.txt)
- Replit Agent — [`Replit/Prompt.txt`](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Replit/Prompt.txt)
- Cursor Agent (2025-09-03 build) — [`Cursor Prompts/Agent Prompt 2025-09-03.txt`](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Agent%20Prompt%202025-09-03.txt)

Claude Code agent/skill definitions, read in full:

- [wshobson/agents](https://github.com/wshobson/agents) (39.6k stars) —
  [`frontend-developer.md`](https://github.com/wshobson/agents/blob/main/plugins/frontend-mobile-development/agents/frontend-developer.md),
  [`ui-designer.md`](https://github.com/wshobson/agents/blob/main/plugins/ui-design/agents/ui-designer.md),
  [`accessibility-expert.md`](https://github.com/wshobson/agents/blob/main/plugins/ui-design/agents/accessibility-expert.md),
  [`design-system-architect.md`](https://github.com/wshobson/agents/blob/main/plugins/ui-design/agents/design-system-architect.md)
- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) (25k stars) —
  [`frontend-developer.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/01-core-development/frontend-developer.md),
  [`ui-designer.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/01-core-development/ui-designer.md),
  [`design-bridge.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/01-core-development/design-bridge.md)
- [anthropics/skills](https://github.com/anthropics/skills) (176k stars) —
  [`frontend-design/SKILL.md`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)

Articles and posts (2025–2026):

- Vercel — [How we made v0 an effective coding agent](https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent)
- Vercel — [How to prompt v0](https://vercel.com/blog/how-to-prompt-v0)
- Augment Code — [GitHub repo exposes system prompts from 28+ AI coding tools](https://www.augmentcode.com/learn/leaked-system-prompts-ai-coding-tools)
- Lovable — [We Gave Our Agent a Vent Tool](https://lovable.dev/blog/we-gave-our-agent-a-vent-tool)
- Lovable — [$85,000 in tokens later: what I learned from scaling agentic coding at Lovable](https://lovable.dev/blog/85000-in-tokens-later-scaling-agentic-coding-at-lovable)

Not fetched in full, only surfaced by search (not cited as claims below): assorted third-party
"prompting guide" sites for v0/Bolt/Lovable — these paraphrase the same leaked prompts above, so
the primary files were read directly instead.

## What the strongest prompts have in common

**Identity is short; behavior is long.** Every strong prompt states identity in one to three
sentences and spends the rest of the document (8–46 KB) on rules and examples, not adjectives.
v0: "You are v0, Vercel's highly skilled AI-powered assistant that always follows best
practices." Lovable: "You are Lovable, an AI editor that creates and modifies web applications."
Bolt: "You are Bolt, an expert AI assistant and exceptional senior software developer..." — one
line each. The weight is in what follows: concrete rules, numeric constraints, and worked
examples. This is the opposite of a personality essay.

**"Figure out what to build" is gated off from "build it," with a crisp trigger.** Lovable
defaults to a discussion mode and only starts editing on explicit action verbs ("implement,"
"code," "create," "add"); it says so directly: "Assume the user wants to discuss and plan rather
than immediately implement code." Devin runs a hard two-mode system, "planning" vs. "standard,"
and only leaves planning by calling `<suggest_plan/>` once genuinely confident. v0 has an
`EnterPlanMode` tool it calls for large or ambiguous asks before touching files. Cursor builds a
structured todo list before edits on anything non-trivial. The common shape: a named boundary
and an explicit condition for crossing it, not just "plan first" as a vibe.

**Ask only what's needed, then stop asking.** Lovable: "If any aspect of the request is unclear,
ask for clarification BEFORE implementing... wait for their response," but also "Don't hesitate
to explore more of the codebase or the web... The useful context may not be enough" before
bothering the user. v0's `AskUserQuestions` tool is explicitly barred from running in parallel
with other tools, because later steps depend on the answer. None of them re-ask per small
decision once the brief is set.

**Design rules are numeric and falsifiable, not adjectives.** v0: "ALWAYS use exactly 3-5 colors
total," "ALWAYS limit to maximum 2 font families total," "line-height between 1.4-1.6," "NEVER
use purple or violet prominently, unless explicitly asked." Lovable enforces a design-token
doctrine ("You never use classes like text-white, bg-white... You always use the design system
tokens") strictly enough to ban whole classes of ad hoc styling. Anthropic's `frontend-design`
skill goes further and names the actual current tells of generic AI output — specific hex values
(`#F4F1EA` cream, `#D97757` terracotta), "tracked-out ALL-CAPS eyebrow label," em-dash labels,
numbered markers used when content isn't really a sequence, "→" appended to link text. All four
treat visual taste as something with checkable rules, not something to leave to feel.

**Self-review before "done" is explicit, and the strongest ones make it structural.** Devin's
`<think>` tool is *mandatory* "before reporting completion to the user," specifically to check
the task is "completely fulfilled" and verification steps actually ran. Cursor's
`non_compliance` section: "If you report code work as done without a successful test/build run,
self-correct next turn by running and fixing first." Vercel's own account of v0 says plainly:
"your product's moat cannot be your system prompt" — they back the prompt with deterministic,
non-model checks (icon-name validation against real exports, dependency completion, AST checks
for required wrappers) rather than trusting a self-report
([How we made v0 an effective coding agent](https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent)).
Lovable's own retrospective on its agent notes the same failure mode from the outside: early on
the agent could get "stuck in a long loop of futile re-attempts" until they explicitly measured
and fixed for it
([We Gave Our Agent a Vent Tool](https://lovable.dev/blog/we-gave-our-agent-a-vent-tool)).

**Reports are short, and length is capped explicitly.** Lovable: "You MUST answer concisely with
fewer than 2 lines of text... unless user asks for detail." v0: a "postamble... of 2-4 sentences.
You NEVER write more than a paragraph unless explicitly asked." Cursor's `summary_spec`: "keep
the summary short, non-repetitive, and high-signal, or it will be too long to read." Three
unrelated products converge on the same cap.

**Tool calls are batched, not sequential, almost everywhere.** Lovable ("NEVER make sequential
tool calls that could be combined"), v0, and Cursor all carry near-identical "parallelize
independent work" sections. This is a harness-level trait more than an identity trait, but it is
close to universal.

## Notable differences

**Who the user is.** Lovable explicitly designs for a non-technical user: "most lovable users are
non technical," so the agent is told never to tell users to "manually edit files or provide data
such as console logs" — it reads its own logs and fixes things itself. v0, Bolt, Devin, Cursor,
and Windsurf all assume a developer audience: they cite diffs, name files with backticks for a
reader who will open them, and Devin talks about branches, PRs, and CI. Dulo's target user (a
non-technical person wanting a landing page) matches Lovable's assumption, not the majority's.

**How hard "done" is enforced.** Devin and Cursor bake a mandatory self-check into the model's
own turn. Bolt and v0 lean on deterministic tooling *outside* the prompt instead of a review
ritual inside it. Lovable's prompt has no explicit review step at all beyond a loose "Verify &
conclude" bullet — its actual rigor apparently comes from the harness and process changes
described in its engineering posts, not the system prompt text. Dulo's own Loop Engineering
design (fixed checklist ids, mandatory evidence, a `report_done` gate) is already stricter than
any single one of these read alone — the research suggests that's a strength worth keeping, not
a gap.

**Locked stack vs. generalist.** Lovable and Bolt hard-lock a stack and say so ("it is not
possible for Lovable to support other frameworks like Angular, Vue, Svelte, Next.js"; Bolt is
constrained to what WebContainer can run) and get to enforce strict, specific styling rules as a
result. wshobson's `frontend-developer.md` instead markets itself as fluent in "React 18+, Vue
3+, and Angular 15+" with no opinion imposed on any one of them. Dulo's own decision (React +
TypeScript + Tailwind, or "equivalent") sits closer to Lovable/Bolt than to the generalist framing
— worth noting because the strict design-token doctrine those two enforce only works *because*
the stack is fixed.

**Identity via examples vs. identity via declared rules vs. identity via capability list.** v0
carries a large "Alignment" section of worked example dialogues (a landing-page request walked
through step by step, an ambiguous big-ask routed into plan mode, etc.) — identity conveyed by
demonstration. Devin, Cursor, Lovable state rules declaratively with no worked dialogue. wshobson's
subagents (`frontend-developer.md`, `ui-designer.md`, `accessibility-expert.md`,
`design-system-architect.md`) instead read as capability résumés: a "Capabilities" section with
eight to ten sub-headings, each a dense bullet list of buzzwords ("React 19 features including
Actions, Server Components..."), then "Behavioral Traits" (adjective bullets: "Prioritizes user
experience and performance equally"), then a generic eight-step "Response Approach" that would fit
almost any coding task unchanged. VoltAgent's equivalents instead impose real structure: a
mandatory "Communication Protocol" that opens every task with a context-manager handshake, a
three-stage "Execution Flow" (Context Discovery → Execution → Handoff), example JSON progress
payloads mid-task, and a literal filled-in "Completion message format" string. VoltAgent's process
skeleton is much closer to what Dulo is building than wshobson's; wshobson's is closer to a
marketing sheet than a working process.

**Anthropic's skill is uniquely dated-and-honest about it.** It names specific hex codes and
phrasing patterns as *current* tells of generic AI design, and its own framing concedes this is a
snapshot ("AI-generated design right now clusters around some traits"). None of the commercial
products' system prompts commit to specifics this concrete inside a shipped, rarely-touched
prompt — likely because a permanent identity file is the wrong place for guidance that needs
refreshing every few months. That argues for where this kind of content should live in Dulo (see
Open questions).

## What to borrow for Dulo's Frontend Engineer (ranked)

1. **Keep the identity paragraph to a few sentences; spend the real length on checkable rules
   and a couple of worked examples.** Every strong prompt does this; wshobson's capability-list
   style is the visible counter-example, and it doesn't actually change model behavior the way a
   concrete rule or example does. Matches the Mission's "identity first, not a short prompt"
   without becoming a résumé.

2. **Give the Understand-and-clarify → Plan boundary a named, explicit trigger, not just a stage
   label.** Borrow the *pattern* from Lovable's action-verb trigger and Devin's `<suggest_plan/>`
   call: define the specific condition that ends clarification and starts Act, so the model
   can't dither indefinitely or skip straight to code inconsistently. `loop-engineering-design.md`
   names the stage; it does not yet name the trigger that ends it.

3. **Adopt Lovable's non-technical-user posture wholesale, not just its wording.** Never ask the
   user to read console output, run a command, or check a file themselves — the agent does that
   and reports findings in plain language. This is the one leaked prompt whose target user is
   Dulo's target user; it is worth reusing the posture, not only borrowing a phrase.

4. **Put numeric, falsifiable design ceilings in the profile or the DoD skill**: a color-count
   ceiling, a font-family ceiling, a line-height range, and a short named list of generic-AI
   tells to avoid (adapted from `anthropics/skills/frontend-design`). DOD-3 in
   `loop-engineering-design.md` is currently the least checkable item on the list; borrowed
   numeric ceilings turn "design quality is solid" into something Review can actually grep or
   measure, not just eyeball.

5. **Nest a plan → review-against-brief-for-genericness → build → self-critique loop *inside*
   Act, specifically for visual design**, distinct from the outer Plan → Act → Review → Improve →
   Stop loop. This is `anthropics/skills/frontend-design`'s own process, and it directly answers
   the honest limitation the loop design doc already states about DOD-3 (no vision model yet, so
   design quality is judged from structure and computed styles, not pixels).

6. **Cite Devin's mandatory pre-completion self-check and Cursor's "no done claim without a
   passing build/test" rule as precedent for Dulo's `report_done` gate.** Both exist in shipped
   products, independently of each other and of Dulo. Combined with Vercel's own statement that
   the prompt "cannot be your moat," this is external validation that Layer 2 (a structural gate,
   not prose self-assessment) is the right call, and that Layer 1 alone (prompt-only) is a known
   weak point worth moving past quickly.

7. **Match Replit's propose-then-apply posture for anything outside the already-agreed build**,
   over Bolt/v0/Cursor's edit-directly-and-report-after posture. Dulo's own trust-boundary
   decision (CLAUDE.md, Decisions §4) already calls for this; Replit is the clearest existing
   precedent for how such a profile reads when *every* change is a proposal, not just risky ones.

8. **Prefer a locked stack over a framework-generalist framing**, matching Lovable/Bolt over
   wshobson's React/Vue/Angular-fluent framing. Dulo's Decisions §1 already specifies React +
   TypeScript + Tailwind "or equivalent"; the research suggests tightening toward "or equivalent"
   being rare, not a real menu, because a fixed stack is what let Lovable enforce a strict
   design-token discipline in the first place.

9. **Borrow VoltAgent's literal completion-message template**, adapted for a non-technical
   reader instead of an engineer handoff. A filled-in example sentence disciplines the shape of a
   final report far better than an instruction like "report clearly" — and Dulo's own DoD already
   specifies what the report must contain (path, run command, assumptions, checklist with
   evidence); a template turns that list into prose the way VoltAgent's agents do for their own
   (more technical) handoffs.

10. **Cap the prose wrapper around the report, independent of the checklist itself** — short
    summary, evidence in the checklist, expand only if asked — matching Lovable/Cursor/v0's near-
    identical length caps. This also matches the owner's own global response-style rule
    (`~/.claude/CLAUDE.md`) and the loop design's own requirement that "the summary is not"
    technical even when the evidence is.

11. *(Later, not urgent for Step 1.)* Consider v0's pattern of injecting fresh, version-pinned
    framework facts into the prompt rather than trusting stale training data, once Dulo locks a
    scaffold version in Step 2 — React/Vite/Tailwind conventions drift, and v0's own team built
    tooling specifically to avoid citing an outdated API
    ([How we made v0 an effective coding agent](https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent)).

12. *(Minor.)* Borrow Windsurf's instruction to revise the plan itself when new information
    changes it, not only tick off checklist items, as a small addition to Dulo's Improve stage.

## What to avoid

- **wshobson's capability-list-as-identity shape.** Long buzzword bullets under "Capabilities,"
  "Behavioral Traits," and "Knowledge Base" read impressively but say nothing about when to stop,
  when to ask, or what "done" means — exactly the gap Dulo's Mission calls out ("a strong
  professional identity and working process, not just a short prompt"). It is the negative
  example to check `frontend-engineer.md` against, not a template.
- **Windsurf's hardcoded misdirection.** Its leaked prompt instructs the model to answer "GPT 4.1"
  if asked what model it is, regardless of the truth. Do not carry over any instruction that has
  Dulo misrepresent what it is or how it works if a user asks directly.
- **Trusting prose self-assessment alone for "done."** Lovable and Bolt's prompts have no
  structural done-gate; Vercel's own account of v0 explicitly distrusts the prompt as the
  enforcement point. Dulo's Layer 2 (`report_done`) is already the more disciplined design —
  avoid quietly regressing to a Layer-1-only, self-reported "done" once Layer 1 ships and Layer 2
  feels like it can wait.
- **Assuming a technically literate audience by default.** Cursor, Devin, Windsurf, and v0 all
  write for a developer who reads diffs and knows git. Copying their communication style wholesale
  would fight Dulo's own non-technical-user premise.
- **Copying shouted emphasis and product-specific ceremony verbatim** (Bolt/Devin's "ULTRA
  IMPORTANT," Bolt's single-artifact XML tags, Replit's bespoke `<proposed_*>` tag vocabulary).
  These are tuned to particular models and product surfaces at a particular time, not portable
  process lessons — borrow the underlying rule, not the incantation.
- **Hardcoding today's "generic AI look" tells permanently into an always-loaded identity file.**
  Anthropic's own skill concedes its specifics are a snapshot ("right now"). Baking specific hex
  codes into `frontend-engineer.md` risks the same staleness the skill itself warns about; see
  Open questions for where this content should actually live.

## Open questions

- Should Dulo hard-lock the stack (refuse Vue/Angular/plain-HTML requests outright, the way
  Lovable and Bolt do) or keep CLAUDE.md's softer "React + TypeScript + Tailwind, or equivalent"?
  The research favors hard-locking for enforceability, but that is a product decision, not a
  research finding.
- Where should the numeric design-quality ceilings and the generic-AI-tells list live —
  `frontend-engineer.md` (always loaded) or `frontend-definition-of-done.md` (loaded at Plan and
  Review, per the roadmap)? Anthropic's own skill treats this content as needing periodic
  refreshing, which argues for the skill file, not the identity file.
- Should Layer 1 (prompt-only, before `report_done` exists in the harness) include a Devin-style
  mandatory pre-completion reasoning step as a stopgap, given both Devin's and Cursor's shipped
  precedent that this measurably changes completion honesty?
- How much of v0's "identity via worked examples" approach (the Alignment section's sample
  dialogues) is worth the file length it costs, given Dulo's own file-size discipline
  (`~/.claude/rules/common/coding-style.md`: files under ~800 lines) and that `reviewer.md`, the
  one Dulo profile that exists today, is only 9 lines of prompt body?
- Mission says Dulo "asks good clarifying questions up front... about the product." Lovable's
  prompt is stricter: it defaults to a discussion-only mode until the user uses an explicit action
  verb. Given most people arrive at Dulo already wanting a landing page built, should the Frontend
  Engineer default toward asking-then-acting in one pass (current Loop Engineering design) or
  toward Lovable's stricter discussion-first default?
