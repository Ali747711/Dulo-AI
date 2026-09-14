# The client brief and the greenfield stack: what to ask, what to scaffold

Research for Dulo's Frontend Engineer profile (`src/agents/frontend-engineer.md`, roadmap Step 1) and the greenfield build (roadmap Step 2, `docs/loop-engineering-design.md` §4). Two questions: (A) what does a professional landing-page brief ask, and how do good agencies talk to non-technical clients; (B) what is the current (2026) best-practice scaffold for Vite + React 19 + TypeScript + Tailwind v4. `01-agent-identities.md` and `02-design-quality.md` cover identity and design-quality checks; `03-prompting-reliable-agents.md` covers prompting; this is the concrete brief-questions-and-stack-versions companion 01 deferred ("the exact scaffold version in Step 2 ... conventions drift"). 2026-09-14.

## Sources

**A — brief templates and client communication** (fetched 2026-09-14; dates below are each article's own published/updated date where shown):

- Marker.io, "Website Design Questionnaire: Questions to Ask Your Web Design Clients," updated 2024-08-13. https://marker.io/blog/website-design-questionnaire
- ybug, "Website design questionnaire: 32 questions to ask your client before you start," published 2026-06-09. https://ybug.io/blog/web-design-client-questionnaire
- Holabrief, "The Ultimate 10-Question Website Design Questionnaire + Template" (no date shown). https://www.holabrief.com/questionnaire/website-design-template
- Bonsai, "Web Design Client Questionnaire Template" (no date shown). https://www.hellobonsai.com/form-template/web-design-client-questionnaire
- HubSpot, "How to Write a Creative Brief in 11 Simple Steps," updated 2025-12-03. https://blog.hubspot.com/marketing/creative-brief
- HubSpot, "8 Questions to Help You Write a Compelling Marketing Brief," updated 2025-03-14. https://blog.hubspot.com/marketing/marketing-brief
- Julian Shapiro, "Landing Page Copywriting," Startup Handbook (no date shown). https://www.julian.com/guide/startup/landing-pages
- GoDaddy Garage, "How to write irresistible web design proposals that win clients" (no date shown). https://www.godaddy.com/garage/write-web-design-proposal/
- HubSpot, "Website design proposal: A streamlined approach to pitching," updated 2025-10-23. https://blog.hubspot.com/website/website-design-proposal-example
- Storydoc, "Web Design Proposal Examples to Get Clients (+Templates)" (no date shown). https://www.storydoc.com/blog/website-project-proposal-examples
- Smashing Magazine, "Why Content Is Such A Fundamental Part Of The Web Design Process," published 2021-04-21. https://www.smashingmagazine.com/2021/04/content-fundamental-part-web-design-process/

**B — stack versions and docs** (verified live 2026-09-14):

- npm registry, `npm view <pkg> version` / `time`: vite 8.3.0 (2026-09-10), react & react-dom 19.3.0 (2026-09-09), typescript 7.0.2 as the `latest` dist-tag (2026-07-08), tailwindcss & @tailwindcss/vite 4.3.3 (2026-07-16), @vitejs/plugin-react 6.1.1 (2026-08-28), create-vite 9.2.1 (2026-09-10), eslint 10.10.0 (2026-09-04), oxlint 1.82.0, typescript-eslint 8.70.0, @fontsource-variable/inter 5.3.0.
- The `create-vite@9.2.1` `template-react-ts` sources, read directly from `https://cdn.jsdelivr.net/npm/create-vite@latest/template-react-ts/`: `package.json`, `eslint.config.js`, `tsconfig.json`/`tsconfig.app.json`/`tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `README.md`.
- Tailwind CSS docs, "Installation: Using Vite." https://tailwindcss.com/docs/installation/using-vite
- Vite guide (scaffolding command, Node version requirement). https://vite.dev/guide/
- Fontsource docs, "Getting Started: Variable Fonts." https://fontsource.org/docs/getting-started/variable
- web.dev, "Browser-level image lazy loading for the web." https://web.dev/articles/browser-level-image-lazy-loading
- 2026 Core Web Vitals roundups (search-aggregated, e.g. corewebvitals.io) confirming LCP/INP/CLS thresholds are unchanged from prior known values.
- 2026 OG-image/favicon guides (search-aggregated, e.g. opengraph-check.com "Favicon in Vite and React SPA," ccbd.dev "Open Graph React SEO") on SVG favicons and SPA meta-tag limits.
- Accessibility landmark guidance (search-aggregated, e.g. accessibilitychecker.org, LogRocket) on header/nav/main/footer landmark rules.

## A. The brief

### A.1 Ranked clarifying questions

Ranked by how much the answer changes the built page, for Dulo's actual context (one session, no billing, frontend-only, immediate local preview) — not a generic agency's ranking. The first six are the ones to ask together, up front, in one message; the rest are safe to skip unless the user brings them up.

| # | Ask this (plain language) | Why it matters | Seen in |
| - | -------------------------- | --------------- | ------- |
| 1 | "What's the single most important thing you want someone to do after landing on this page — call, visit, order, sign up, something else?" | Sets the CTA, the hero copy, and what "done" even means; every source treats this as the root question. | ybug Q1–2, marker.io Q1, Julian Shapiro's single-CTA rule, HubSpot marketing-brief Q1/Q6 |
| 2 | "What should the page cover? For example: welcome, your story, menu or products, location and hours, contact." | Directly the shape of the build — DOD-1 and DOD-4 check the site against this list. | ybug Q7/Q23, Bonsai Q12, Holabrief, Decision 1 |
| 3 | "Who is this mainly for — new customers discovering you, existing regulars, tourists, other businesses?" | Drives tone, imagery, and what gets emphasized (price vs. quality vs. convenience). | ybug Q8–10, marker.io Q3, Bonsai Q9, Holabrief Q8 |
| 4 | "What must be on the page (address, hours, prices, your story)? Do you have the text or photos ready, or should I draft something you can edit?" | The most common real-world stall; resolves whether Dulo writes the copy itself or waits on the client. | ybug Q24, Bonsai Q3, Smashing Magazine, Holabrief Q5 |
| 5 | "Do you already have a logo, brand colors, or fonts I should use?" | The biggest fork in the design decision tree: use theirs, or Dulo picks sensible defaults. | ybug Q14, marker.io Q7, Bonsai Q5/Q20, Holabrief Q6 |
| 6 | "In a few words, how should it feel — warm, sleek, playful, minimal? Any sites you like or want to avoid?" | Feeds palette/font/imagery choice directly when there are no brand assets; folds in competitor references. | ybug Q11–12/Q15–16, Holabrief Q3–4, Bonsai Q10–11, Julian Shapiro |
| 7 | "Do you have real photos to use, or should I source images that fit the mood?" | High visual impact, but safe to default (stock/illustration in one consistent style). | ybug Q17–18, Bonsai Q13–14 |
| 8 | "What contact info, address, hours, or social links should appear?" | Usually a short factual answer, but a wrong or missing one is the most visible kind of "broken" to a real visitor. | Bonsai/Holabrief company-profile questions, Decision 1's "key content" |
| 9 | "Anything else that matters — another language, something to avoid, accessibility needs, a hard deadline?" | Catches the long tail without a long questionnaire; matches the Mission's "other meaningful details." | ybug's logistics cluster (Q25–30) |
| 10 | Budget / timeline / CMS / analytics — *usually skip* | Every general template asks this, but it is low-impact for Dulo specifically: a human agency prices and staffs against it; Dulo builds in one sitting with no billing, so the answer rarely changes the artifact. Ask only if the user raises it. | ybug Q21/26/27/29/30, Bonsai Q18–19, Holabrief Q9–10 |

### A.2 Default assumptions experienced designers make

What to assume, by default, for anything the top six leave unanswered:

- **Palette.** A neutral base (white, cream, near-black) plus one accent, taken from the logo if given, else chosen from the business's mood (e.g. warm roast browns and cream for a coffee roastery).
- **Fonts.** Exactly two families — one for headings (a serif or display face for warmth, a bold grotesque for modern/tech), one plain, readable sans for body and UI. Never more than two.
- **Section order.** Hero (one H1, one CTA) → proof/value → story/about → offering (menu/products/services) → testimonials if any → location/contact → footer. Matches Julian Shapiro's template almost exactly, and every questionnaire's implicit page list.
- **Copy tone.** Plain, second person, short sentences, specific over generic — "cold-brew nitro on tap" beats "quality beverages." One CTA, repeated at top and bottom, worded as an action ("Order now," "Find us"), not vague ("Learn more").
- **Imagery.** Real photos when the client has them; otherwise a small, consistent set in one style — never mixed styles, never obvious filler.
- **Content ownership.** Dulo writes real, on-brief copy — never lorem ipsum — and says plainly that it's a first draft the user can edit. Matches `loop-engineering-design.md`'s DOD-4 ("no lorem ipsum ... unless the brief asked for placeholders") and answers Smashing Magazine's core complaint (content arrives late or never) by not waiting on it.
- **Contact "forms."** A static `mailto:`/`tel:` link, or a form with no submit handler, stated as an assumption every time — Dulo has no backend role yet (Mission, Role clarity), so a form that looks live but goes nowhere must never ship unlabeled.

### A.3 What clients most often fail to provide

In order of how often it comes up across the sources above: final copy/text (named first by Smashing Magazine, Elegant Themes, and ybug alike); real photography, a logo, or brand guidelines (Holabrief, ybug Q14, Bonsai Q5); a stated goal more specific than "make it look good" (ybug Q1–3); competitor or reference examples, unless directly asked (Bonsai Q10–11); and exact contact/legal details, which tend to arrive last. Each gap has a default in A.2 — the point of asking the top six is to replace as many of these gaps as possible with real answers, not to block on them.

### A.4 Plan/delivery communication template

The researched proposal structures (GoDaddy's and HubSpot's 8 sections, Storydoc's 9) are built for a multi-week sales engagement with a signature step. Dulo's version compresses the same underlying moves — plain language, benefits over tools, explicit assumptions, visual proof — into two chat messages instead of a document, matching the Northwind Coffee example already worked through in `loop-engineering-design.md` §4.

**Up-front question message** (end of Understand, before Plan): one line restating the request in the user's own words ("use the same language your client uses," per Storydoc/HubSpot); the top questions from A.1, asked together, framed so any of them can be skipped ("Answer what you know — I'll make sensible choices for the rest and tell you what I assumed"); no jargon, no framework names, no file-structure talk (GoDaddy/HubSpot: benefits over tools).

**Delivery report** (at Stop, after Review passes): what was built, as plain bullets naming actual sections ("a hero, your story, the menu, location and hours"), never "components"; the assumptions actually used, stated as facts — "I used a warm cream-and-espresso palette and a serif heading font, since no brand colors were given" — not hedged; exactly how to preview it (the one command, the URL, nothing more technical unless asked); the Definition-of-Done checklist translated to plain language per item, not raw ids ("everything you asked for is on the page," not "DOD-4 pass"); one line inviting changes, since this replaces the agency's "next steps/signature" step — Dulo doesn't need a separate acceptance step, and only stops short for the four reasons `loop-engineering-design.md` already defines (pass / cap / blocked / cancelled).

## B. The stack, verified 2026-09-14

### B.1 Scaffold commands and verified versions

```
npm create vite@latest <project-name> -- --template react-ts
cd <project-name>
npm install tailwindcss @tailwindcss/vite
npm install @fontsource-variable/<font-name>   # one package per font family
npm install
npm run dev
```

`vite.config.ts` adds one plugin; `src/index.css` becomes the single global-styles file:

```ts
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [react(), tailwindcss()] })
```

```css
@import "tailwindcss";
@import "@fontsource-variable/<font-name>";

@theme {
  --color-brand: #6f4518;      /* design tokens live here, not a tailwind.config.js */
  --font-display: "Font Name Variable", serif;
}
```

No PostCSS config and no `tailwind.config.js` are needed — `@tailwindcss/vite` handles scanning and generation. Vite itself requires Node `^20.19.0 || >=22.12.0`.

| Package | Version (2026-09-14) | Published |
| --- | --- | --- |
| vite | 8.3.0 | 2026-09-10 |
| create-vite (scaffolder) | 9.2.1 | 2026-09-10 |
| react / react-dom | 19.3.0 | 2026-09-09 |
| @vitejs/plugin-react | 6.1.1 | 2026-08-28 |
| tailwindcss / @tailwindcss/vite | 4.3.3 | 2026-07-16 |
| typescript (npm `latest` tag) | 7.0.2 | 2026-07-08 |
| typescript (template's own pin) | `~6.0.2` | — |
| oxlint | 1.82.0 | — |
| typescript-eslint | 8.70.0 | — |
| @fontsource-variable/inter (example family) | 5.3.0 | — |

Two findings worth flagging before either becomes a default:

1. **TypeScript: 6.x, not 7.x, is what actually gets installed.** npm's `latest` tag points at 7.0.2 — the native, Go-ported compiler line — but the shipped `template-react-ts/package.json` pins `"typescript": "~6.0.2"` (tilde, patch-only, not caret). A fresh scaffold plus `npm install` therefore lands on TypeScript 6.0.x. Recommendation: follow the template's pin; treat a deliberate move to 7.x as its own verified decision, not something that happens by default via `npm install typescript@latest`.
2. **The default linter changed from ESLint to oxlint.** The template's `lint` script is now `oxlint` (Rust-based), and its README frames ESLint as optional. An `eslint.config.js` (flat config: `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`) is still scaffolded alongside it, but wired to no script. Plain `oxlint` is syntax-only — catching `any` (a hard rule in the user's global coding style) needs oxlint's type-aware mode, which per the template's own README requires installing `oxlint-tsgolint` and hand-writing `.oxlintrc.json`; neither exists by default. See Open questions.

### B.2 Project blueprint

```
<project-slug>/
├── index.html              # title, meta description, OG/Twitter tags, favicon link, viewport — static, so crawlers see it with no JS run
├── package.json             # scripts: dev, build, preview, typecheck, lint
├── tsconfig.json              # project-reference root (template default, unchanged)
├── tsconfig.app.json            # app compiler options — add "strict": true explicitly (not set by the template; see B.1)
├── tsconfig.node.json             # type-checks vite.config.ts
├── vite.config.ts                  # react() + tailwindcss() plugins
├── eslint.config.js                  # flat config, kept for editors/CI even if oxlint runs `npm run lint`
├── README.md                           # what this is, how to run it, what was assumed
├── public/
│   ├── favicon.svg                       # template default; recolor to the brief's palette
│   └── og-image.png                        # 1200×630 social preview image
└── src/
    ├── main.tsx                              # createRoot + StrictMode (template default, unchanged)
    ├── index.css                               # @import "tailwindcss"; + @theme tokens + font imports
    ├── App.tsx                                   # composes Header + ordered section list + Footer; no business logic
    ├── content/
    │   └── site.ts                                 # one typed object: brand name, nav, per-section copy — the brief made data
    ├── components/
    │   ├── layout/
    │   │   ├── Header.tsx                              # <header> + <nav> landmark, logo, mobile menu
    │   │   └── Footer.tsx                               # <footer> landmark, contact/legal, social links
    │   ├── sections/
    │   │   ├── Hero.tsx                                   # <section>, one h1, one primary CTA
    │   │   ├── Story.tsx                                   # one file per requested section from the brief
    │   │   ├── Offering.tsx                                 # menu / products / services
    │   │   └── Contact.tsx                                   # address, hours, mailto/tel or static form
    │   └── ui/
    │       ├── Button.tsx                                      # one CTA style, shared so hover/focus states exist once
    │       ├── Container.tsx                                     # max-width + padding wrapper
    │       └── SectionHeading.tsx                                 # consistent heading style per section
    └── lib/
        └── seo.ts                                                   # optional: derives index.html meta from content/site.ts
```

Every section is its own file (one component per requested section, matching DOD-2's "one component per section, no file over ~300 lines"); `content/site.ts` is the single place that encodes what the brief asked for, so Review can check DOD-1/DOD-4 by reading one file plus the section-file list, not the whole tree.

### B.3 Conventions

- **Design tokens.** Live in Tailwind v4's `@theme` block inside `src/index.css`, next to the `@import "tailwindcss";` line — not a `tailwind.config.js`.
- **Fonts.** Self-hosted via `@fontsource-variable/<name>` (one install + one import per family) rather than a Google Fonts `<link>` — no third-party request at load time, and the package's own CSS already sets sane `font-display` behavior. Reference the family as `"<Name> Variable"` in CSS.
- **Images.** `width`/`height` (or `aspect-ratio`) on every `<img>` to hold layout for CLS. Everything below the fold gets `loading="lazy"`; the hero/LCP image stays eager, with `fetchpriority="high"` and no `loading="lazy"` — lazy-loading the LCP candidate is a common, well-documented regression.
- **SEO/meta/OG.** This is a plain Vite SPA with no SSR/prerender step, so `<title>`, the meta description, and Open Graph/Twitter tags all go directly in `index.html`, not injected by JavaScript — crawlers and link-unfurlers do not execute the app. OG image at 1200×630.
- **Favicon.** The template already ships `public/favicon.svg`; keep SVG as the primary format, recolored to the brief's palette. Add an `.ico` fallback only if a legacy-browser requirement ever actually comes up.
- **Accessibility landmarks.** One `<header>`, one `<nav>` (label it if there is more than one), exactly one visible `<main>`, one `<footer>`; never nest a landmark inside another.
- **Performance.** 2026's "good" Core Web Vitals thresholds are unchanged: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, at the 75th percentile. The conventions above (eager hero image, sized images, self-hosted fonts) are what keep LCP/CLS green without extra tooling.

### B.4 What the agent can verify by command vs. needs a browser for

| Check | How | Command or browser |
| --- | --- | --- |
| Install/build succeed | `npm install`, `npm run build` (`tsc -b && vite build`) exit 0 | command |
| Type errors, including `any` | the build's `tsc -b` step | command |
| Lint (syntax, hooks, unused vars) | `npm run lint` (`oxlint`) | command |
| File-size / one-component-per-section discipline | read the file tree, line counts | command |
| Every requested section exists | check `content/site.ts` and `components/sections/*` against the brief | command |
| Dev server starts, prints a URL | `npm run dev` | command |
| Page renders, console is clean | open the URL, read console messages | browser |
| Fonts/colors on the page match the brief | computed-style read (`evaluate_script`) | browser |
| Contrast | `a11y_check_color_contrast` | browser |
| Landmarks, heading structure, one h1 | accessibility snapshot | browser |
| No horizontal overflow at ~400px | resize + `scrollWidth` check | browser |
| Hover/focus states exist | real interaction (`hover()`/`.focus()`), not a static snapshot — 02's open question on whether this is reliably scriptable still stands | browser |
| Real LCP/CLS numbers (not proxies) | `performance_start_trace`/`performance_stop_trace` or `lighthouse_audit` (Chrome DevTools MCP) | browser, not yet wired into Review — see 02's open question on where Performance/SEO fits |
| A social preview card renders correctly on a given platform | cannot be verified by the agent at all | not verifiable — a known gap, same spirit as DOD-3's vision limitation |

## What goes in the Frontend Engineer profile vs. a skill

Same split `loop-engineering-design.md` already uses for the Definition of Done — voice and process in the always-loaded profile, reference material in a skill loaded on demand — applied to this research.

**Profile** (`src/agents/frontend-engineer.md`, always loaded): the six ranked questions from A.1, in the profile's own words; the assumption-statement rule; the two message shapes from A.4 (how Dulo actually talks); the instruction to write real content, never lorem ipsum. This is small and defines identity — it should change rarely.

**Skill** (new — e.g. `src/skills/frontend-greenfield-scaffold.md`, a sibling to `frontend-definition-of-done.md`, loaded at Act): the exact scaffold commands, the version table, the project blueprint tree, and all of B.3's conventions. Version numbers and file trees belong here, not in the profile, because they need updating on a schedule the identity prompt shouldn't be touched for — the same reasoning 01 gives for the design-quality specifics.

This document is neither — it is a dated research memo, read once by whoever writes the profile and the skill, not loaded by Dulo at runtime.

## Open questions

- **Vendored template vs. invoking the real scaffolder at runtime.** Roadmap Step 2 left this open. This research favors invoking `npm create vite@latest -- --template react-ts` live — it already ships the current oxlint default and tsconfig — plus a small patch step for Tailwind/content/components, over Dulo owning a full vendored copy that drifts the way 01 warns generic scaffold conventions do. Needs a decision, and a check that the target environment actually has registry access at build time.
- **TypeScript 6.x vs. 7.x.** Recommend following the template's tilde pin for now; revisit once `@vitejs/plugin-react` and `typescript-eslint` publish explicit 7.x support.
- **oxlint vs. ESLint as the enforced `npm run lint`.** The template default doesn't catch `any` without extra setup; the user's global rules assume ESLint/Prettier. Decide whether the greenfield skill adds oxlint's type-aware config, wires up the already-scaffolded `eslint.config.js` instead, or runs both.
- **No-logo default.** The most common gap (A.3) is no logo. Should the skill generate a simple typographic mark for the favicon/header, or omit a mark entirely?
- **Contact "forms."** Default should be a `mailto:`/`tel:` link or a non-submitting form, stated as an assumption every time, since Dulo has no backend role yet — confirm this is the intended hard default, not just this doc's guess.
- **Real LCP/CLS via Lighthouse/trace tools.** 02 already asks where Performance/SEO fits against DOD-3/DOD-5; this doc adds that the concrete tools (`lighthouse_audit`, `performance_start_trace`/`performance_stop_trace`) already exist in the harness's Chrome DevTools MCP. Resolving 02's question would let Review use real numbers instead of the B.3 conventions as a proxy.
- **Font-pairing source of truth.** The already-installed `ui-ux-pro-max` skill ships 74 font pairings and 192 palettes. The greenfield skill should likely call that rather than hardcoding a second, competing shortlist — worth confirming, since the Mission argues against duplicate complexity.
