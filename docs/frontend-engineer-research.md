# Frontend Engineer: research report and what we took from it

Written 2026-09-14 for roadmap Step 1. Four research memos were produced in parallel
and are kept in `docs/frontend-engineer-research/`; this page is the decision record:
what went into `src/agents/frontend-engineer.md`, `src/skills/frontend-definition-of-
done.md`, and `docs/frontend-engineer-test-tasks.md`, why, and what was left out. Read
the memos for sources and quotes.

| Memo | Question it answers |
| --- | --- |
| `01-agent-identities.md` | How v0, Lovable, Bolt, Cursor, Replit, Devin, Windsurf, and the strongest Claude Code agent packs define identity and process |
| `02-design-quality.md` | What reads as professionally designed in 2025 to 2026, and which of it can be checked from the DOM and computed styles without seeing pixels |
| `03-prompting-reliable-agents.md` | How to write a system prompt that reliably follows a multi-stage process, asks well, self-reviews honestly, and stops correctly, across models |
| `04-brief-and-stack.md` | What a professional landing-page brief asks, how agencies talk to non-technical clients, and the verified 2026 Vite + React 19 + TypeScript + Tailwind v4 setup |

Also read: the locally installed skills `frontend-design` (Anthropic), `web-design-
guidelines` (Vercel's Web Interface Guidelines, fetched fresh), `premium-web-design-
system`, and `ui-ux-pro-max` (landing-page patterns, font pairings).

## Decisions taken into the profile

| Decision | Why | From |
| --- | --- | --- |
| Identity in four sentences; the length goes to rules, process, and templates | Every strong shipped prompt does this; capability-list identities (wshobson style) do not change behaviour | 01 |
| Six "rules that never bend" at the top, repeated in one line each at the bottom | Attention is strongest at the start and end of a prompt and weakest in the middle | 03 |
| Review is "run the check, quote the output", never "check your work" | Self-correction without external feedback does not work (Huang 2023, Kamoi 2024); tool output is the external feedback | 03 |
| Four stop reasons as a closed list; "done" only in a pass report | Every documented infinite loop or false success came from a stop condition left to the model | 03 |
| Cap of three iterations and "fails twice for the same reason means blocked", stated as numbers | A bound must be deterministic to be a bound | 03, loop design |
| Clarify once, before Plan, with an explicit end condition (each of six things answered or assumed) | Late clarification measured worse than none; Lovable and Devin both gate planning from building with a named trigger | 01, 03 |
| Questions as a structured set: 2 to 4 labelled options plus "you decide", one round, skip allowed | Copies the shape of Claude Code's own `AskUserQuestion`; recognising beats composing for a non-expert | 03, 04 |
| The six things to clarify: action, sections, audience, content and who supplies it, brand assets, feel and references | Ranked from eight agency and platform questionnaires by how much the answer changes the page; budget and timeline dropped as irrelevant to Dulo | 04 |
| Every unanswered choice becomes a written assumption next to what it affects | Models assume silently by default; the Definition of Done requires the assumption to be stated | 03, Decision 1 |
| Non-technical posture: the user never reads a log, runs a command, or opens a file for Dulo | Lovable is the one shipped prompt written for non-technical users and it makes exactly this rule | 01 |
| Reply in the user's language; name things as the user sees them; short messages with explicit caps | Lovable, v0, and Cursor all cap output length explicitly; agencies use the client's words | 01, 04 |
| Frontend only, honest placeholders for backend needs, propose before changing anything outside the brief | Mission and Decision 4; Replit's propose-then-apply posture is the precedent | 01, CLAUDE.md |
| Stack locked to React + TypeScript + Tailwind on Vite unless the user names another | Lovable and Bolt can enforce strict design rules only because their stack is fixed | 01, 04 |
| Design direction written and tested for genericness before any file exists; one signature element; restraint | Anthropic's `frontend-design` process, adapted; the "would this fit another business" test is its self-critique step | frontend-design skill, 02 |
| Numeric design ceilings in the profile: two families, 4 to 7 sizes, line height near 1.5, 60 to 75 characters, 4 or 8 px spacing, one primary action | v0 hard-codes numeric ceilings; Refactoring UI and Practical Typography supply the numbers | 01, 02 |
| Only the top four generic-AI tells named in the profile; the full list lives in the skill | Specific tells go stale; Anthropic's own skill says its list is a snapshot | 01, 02 |
| Default assumptions spelled out (palette, two families, section order, real copy, mailto/tel contact, wordmark) | These are the gaps clients most often leave; experienced designers have defaults for each | 04 |
| Literal report templates for question, pass, and not-done messages | A filled template disciplines a report better than "report clearly" (VoltAgent's completion format) | 01 |
| Pre-report step: re-read the brief file and the checklist, then name the stop reason | Devin's mandatory pre-completion check; Cursor's "no done without a passing build" | 01 |
| `maxSteps: 40`; tools limited to files, shell, todos, skills, docs lookup, and the browser; no GitHub, Vercel, Sentry, Linear, or raw HTTP | Three iterations need room; the tool list is the frontend-only boundary made structural | loop design, Decision 4 |

## Decisions taken into the definition-of-done skill

- Structure gates (one `h1`, heading order, singular landmarks, alt text, no broken
  images) are unconditional pass or fail: cheap and unambiguous (02).
- No horizontal overflow at 320, 400, 768, and 1440 px; tap targets at least 24 px:
  the highest-signal "rough prototype" detectors (02).
- Contrast every Review with the a11y tool, not only when it occurs to the model (02).
- Font families in use, and colors in use, compared with the brief with tolerance for
  tints and shades, never exact match (02).
- Spacing-scale adherence, section rhythm, and the generic-AI tells are soft warnings
  for the reviewer to look closer, never blocking items: legitimate designs vary (02).
- A named judgment step in words (hierarchy, restraint, brand fit, copy voice) so "no
  pass from memory" still applies to what cannot be scripted (02, 03).
- The checks a command can prove (install, build, type errors, lint, section files
  against the brief) are separated from the checks that need the browser (04).
- Concrete browser snippets for each check, so Review means running them, not
  describing them (03).

## Deliberately left out

- Worked example dialogues in the profile (v0's "Alignment" section): the length cost
  is high and the templates cover the shape. Revisit if Step 1 transcripts show drift.
- Exact package versions and scaffold commands in the profile: they drift monthly and
  belong in a scaffold skill (Step 2) with a date on it.
- Shouted emphasis, product-specific tag vocabularies, and any instruction that has
  Dulo misrepresent what it is.
- A model name in the profile: model choice is Decision 3's business and Step 4's work.

## Open questions carried forward

For Step 2 (greenfield build):

- Invoke `npm create vite@latest -- --template react-ts` live, or vendor a template
  Dulo owns? Research favours live plus a small patch step (04).
- TypeScript 6.x (the template's pin) versus 7.x (npm `latest`): follow the pin (04).
- `oxlint` (the template's default, syntax-only) versus wiring the scaffolded ESLint
  config so `any` is caught: decide in the scaffold skill (04).
- Can the browser tools trigger real `:hover` and `:focus-visible` reliably? Spike
  before making the state-change check a hard item (02).
- Palette and font matching tolerance: nearest-color distance, not exact hex (02).
- Where Lighthouse Performance and SEO belong, DOD-3 or DOD-5 (02, 04).
- The no-logo default (typographic wordmark) and the contact-form default (mailto or
  a visibly inactive form) are this research's proposals; confirm with the owner (04).
- Use `ui-ux-pro-max` as the single source of font pairings and palettes instead of a
  second list in a skill (04).

For Step 4 (model): none of the sources benchmark small or free models; whether these
techniques hold on the current OpenRouter default is exactly what the test briefs
measure (03). Image pass-through in `src/mcp.ts` and a vision-capable reviewer remain
the real fix for design-quality review (02).

## What to refresh, and when

- The generic-AI tells list in the skill: every few months, from writing on "AI-
  generated website look"; the current list is dated 2026-09.
- Versions in the scaffold skill (Step 2): on each scaffold change.
- The test briefs: sharpen or replace any brief every run passes.
