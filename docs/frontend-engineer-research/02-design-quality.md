# Design quality research: what's checkable without seeing pixels

For DOD-3 ("Design quality is solid" — layout, spacing, hierarchy, fonts, and
overall visual quality are intentional and good; production-ready, not a rough
prototype — `CLAUDE.md` § Decisions 1) and the Review step in
`docs/loop-engineering-design.md` §4. Dulo's reviewer has the accessibility
tree, computed styles via a browser `evaluate` tool, console messages, and an
automated contrast check — no screenshots. Below: what reads as professionally
designed in 2025–2026, and which of that survives translation into a
DOM/computed-style/a11y-tree check.

---

## A. Checkable heuristics

Assumes an `evaluate_script`-style tool (arbitrary JS in the page), an
a11y-snapshot tool, a contrast checker, and viewport resize — what
`docs/loop-engineering-design.md` already assumes Dulo has.

### Typography

1. **Type scale has 4–7 distinct sizes.** Dedupe computed `font-size` across
   visible text nodes; flag >8 distinct values, or any two adjacent sizes
   <25% apart (Refactoring UI's rule — e.g. 30px next to 32px reads as a
   mistake, not a choice). [learnui.design](https://www.learnui.design/blog/ultimate-guide-font-sizes-ui-design.html); [Refactoring UI summary](https://www.sglavoie.com/posts/book-summary-refactoring-ui/).
2. **Body line length 45–90 characters, ideally 60–75.** Check the prose
   wrapper's computed `max-width` is ~45–75ch (or the px equivalent at base
   font size), or compute `clientWidth / averageCharWidth`. [Butterick, Line length](https://practicaltypography.com/line-length.html); [the ch unit](https://www.uiuxatlas.com/lessons/typography/line-length-and-the-ch-unit/).
3. **Line height 120–145% of font size for body text.** Compute
   `parseFloat(lineHeight) / parseFloat(fontSize)`; flag outside ~1.2–1.5.
   [Butterick, Line spacing](https://practicaltypography.com/line-spacing.html).
4. **≤2 type families (3 hard cap), each with a clear role** — and a real
   choice was made, not just the fallback stack. Dedupe the first font in
   every computed `font-family`; flag >3 families, or flag if every value
   resolves to `ui-sans-serif`/`system-ui`/`Arial` with nothing loaded via
   `document.fonts`/`@font-face` (a generic-default signal, not neutral).
   [The Crit, Font Pairing Guide](https://thecrit.co/resources/font-pairing-guide).
5. **All-caps text has added letter-spacing** (5–12%, or it turns illegible).
   For `text-transform: uppercase` elements, computed `letter-spacing` should
   not be `normal`/`0px`. [Butterick, key rules](https://practicaltypography.com/summary-of-key-rules.html).

### Spacing & layout

6. **Spacing snaps to a 4pt/8pt scale.** Sample computed `margin`/`padding`/
   `gap`; check what fraction are multiples of 4 (or 8) — an ad hoc mix
   (13px, 17px, 22px) reads as un-designed even with nothing visibly broken.
   [spec.fm, 8-Point Grid](https://spec.fm/specifics/8-pt-grid).
7. **Section rhythm is consistent.** Compare computed block padding across
   top-level `<section>`s; low variance reads intentional, high variance
   reads accidental — a soft signal for the reviewer, not a hard fail (real
   pacing varies spacing on purpose; see §B).
8. **Content width is bounded**: layout containers ~1200–1280px max-width,
   prose ~65ch. Unbounded full-bleed text is a common unstyled-scaffold tell.
   [CSS-Tricks, line length in CSS](https://css-tricks.com/setting-line-length-in-css-and-fitting-text-to-a-container/).
9. **No horizontal overflow at any tested width.**
   `document.documentElement.scrollWidth <= clientWidth` (small tolerance),
   checked at each resize — cheapest, highest-signal check here. When it
   fails, check whether the culprit is a flex/grid child stuck at its
   default `min-width: auto` (the exact bug this codebase already hit once —
   `context.md` §4's `min-w-0` decision row). [MDN, scrollWidth](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth).
10. **Alignment is deliberate.** Sibling elements meant to align (stacked
    headings, icon+label rows) share `getBoundingClientRect().x` within a
    couple of px — catches accidental misalignment, can't prove good taste.
11. **Breakpoints exist and content reflows**, not just shrinks. Resize to
    320/375/400/768/1024/1440; confirm nav's computed `display`/a toggle
    changes and multi-column sections drop to fewer columns. [Framer, breakpoints 2026](https://www.framer.com/blog/responsive-breakpoints/).
12. **Tap targets ≥24×24 CSS px** (WCAG 2.2 AA minimum; 44×44 recommended for
    primary mobile actions). `getBoundingClientRect()` on every `a`/`button`/
    `input`/`[role=button]`. [WCAG 2.2 SC 2.5.8](https://www.w3.org/TR/WCAG22/); [AudioEye summary](https://www.audioeye.com/post/wcag-22/).

### Color

13. **Text contrast ≥4.5:1** (≥3:1 for ≥18pt/24px, or ≥14pt/19px bold).
    Automated contrast tool against computed `color` vs. nearest
    non-transparent ancestor `background-color`. [WCAG SC 1.4.3](https://www.w3.org/TR/WCAG22/); [WebAIM, Contrast](https://webaim.org/articles/contrast/).
14. **Non-text UI contrast ≥3:1** (icons, borders, focus rings against
    adjacent color — WCAG 1.4.11). Same tool, applied to `border-color`/`fill`.
15. **Palette is small, roughly 60/30/10.** Cluster sampled computed
    `background-color`/`color`/`border-color` into distinct hex values; flag
    >6–8 genuinely distinct colors, or no single hue covering a clear
    majority. [UX Planet, 60-30-10](https://uxplanet.org/the-60-30-10-rule-a-foolproof-way-to-choose-colors-for-your-ui-design-d15625e56d25).
16. **State isn't color-only.** `.error`/`[aria-invalid="true"]` elements
    should carry text or an icon too, not just a color change.
17. **Hover/focus/active visibly change style.** Snapshot computed style at
    rest, dispatch real hover/focus (Playwright's `hover()`/`.focus()`
    trigger true pseudo-classes), recompute, diff must be non-empty.
    [Reflect, pseudo-elements in Playwright](https://reflect.run/articles/accessing-pseudo-elements-in-playwright/).

### Structure (landing-page composition)

18. **Exactly one visible `<h1>`.** `querySelectorAll('h1').length === 1`.
    [axe-core, page-has-heading-one](https://dequeuniversity.com/rules/axe/4.6/page-has-heading-one).
19. **Heading order never skips a level** (h1→h2→h3, never h2→h4). Walk
    heading nodes in DOM order. [axe-core, heading-order](https://rocketvalidator.com/accessibility-validation/axe/4.10/heading-order).
20. **Landmarks present and singular**: one `<main>`, `header`/`footer` not
    duplicated, no content orphaned outside a landmark. [axe-core, landmark-one-main](https://dequeuniversity.com/rules/axe/4.6/landmark-one-main).
21. **One primary CTA carries the most visual weight**; repeats reuse the
    same intent rather than competing. Compare font-size/prominence across
    all CTA-like elements. [Julian Shapiro, Landing Page Copywriting](https://www.julian.com/guide/startup/landing-pages) — CTAs should be "natural continuations" of the hero, not generic asks.
22. **Every major section has its own heading** — this is Dulo's own DOD-4
    check already (the Northwind Coffee example in the loop design caught a
    missing section exactly this way): count sections vs. headings nested
    inside each.
23. **No lorem ipsum/TODO placeholders unless requested; every image has
    `alt` and none are broken** (`img.complete && img.naturalWidth > 0`).
    [Keith Gaughan, detecting broken images](https://keith.gaughan.ie/detecting-broken-images-js.html).

### Responsive (what breaks at ~400px)

24. **No horizontal scrollbar at 400px/320px**, nav collapses to a usable
    pattern instead of clipping — same mechanism as #9, run at the widths
    where fixed-width elements fail first. [BrowserStack, breakpoints 2025](https://www.browserstack.com/guide/responsive-design-breakpoints).
25. **Mobile form inputs ≥16px font-size** (below this, iOS Safari
    auto-zooms on focus, which reads as broken).
26. **No fixed-px element wider than the viewport without `max-width:
    100%`.** Compare computed `width` to `window.innerWidth`.
27. **Layout re-flows, not just re-scales**, across desktop/tablet/mobile —
    verify by comparing bounding-box layout at each width, not just
    "nothing overflows."

### Accessibility gates that double as design checks

28. **Focus indicator visible, never silently removed.** Computed
    `outline-style` not `none` unless a replacement is confirmed by the
    hover/focus diff (#17). [WCAG 2.2 SC 2.4.11/2.4.13](https://www.w3.org/TR/WCAG22/).
29. **`prefers-reduced-motion` respected.** Emulate the media feature;
    computed animation/transition durations should collapse or a reduced
    variant should apply. [web.dev, prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion).
30. **No autoplaying motion >5s without a pause control** (WCAG 2.2.2).
    Query `video[autoplay]` and long-running CSS animations.
31. **Lighthouse Accessibility + Best Practices ≥90.** Run via the Chrome
    DevTools MCP `lighthouse_audit` tool; report failing audits by name.
    [DebugBear, Lighthouse Best Practices](https://www.debugbear.com/blog/lighthouse-best-practices).
32. **Console has zero errors on load** — cheap proxy for a broken build
    (missing asset, failed font load, render error).

---

## B. Taste: what a check can't prove

- **Hierarchy is felt, not just marked up.** The most important thing on the
  page should look the most important, regardless of its HTML tag —
  Refactoring UI's rule is to style by visual weight, not semantics.
  [sglavoie.com summary](https://www.sglavoie.com/posts/book-summary-refactoring-ui/).
- **Restraint.** Pick one place to be bold, keep everything else quiet.
  Anthropic's frontend-design skill states this almost as a thesis: *"Spend
  your boldness in one place... keep everything around it quiet and
  disciplined."* Most generic pages fail this either by being loud
  everywhere (shadow on every card, gradient on every heading) or loud
  nowhere (uniform gray-on-white, no focal point).
- **Intentionality.** Every visible choice should trace to a reason — this
  font because the brief said warm; this palette because the audience is
  financial analysts, not kids. Defaults everywhere (default stack, default
  Tailwind indigo, default card radius) read as unintentional even if each
  choice is individually fine. [Anthropic, frontend-design SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md).
- **Brand/subject fit.** Visual language should come from the thing being
  built, not a swapped-in unrelated template — the hardest to check from the
  DOM, since it requires comparing against the brief's subject, not a fixed
  rule.
- **Rhythm and pacing.** Good pages alternate density and openness (tight
  feature grid, then a spacious testimonial). §A's rhythm check (#7) flags
  *inconsistency* but can't tell a mistake from deliberate pacing.
- **Copy voice.** Generic copy ("Build faster. Ship smarter.") is a design
  smell as much as a writing smell — it signals nothing was actually decided
  about the product. Beyond a lorem-ipsum regex, this needs reading.

### Anti-pattern list: tells that a page "looks AI-generated" (2025–2026)

1. **Blue-to-purple gradient hero/button** — traces to Tailwind's
   `bg-indigo-500` default becoming the statistical median of training data;
   "the single loudest AI tell in 2026." [925studios](https://www.925studios.co/blog/ai-slop-design-tells); origin story via [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website) and [dev.to](https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p).
2. **Inter/Roboto everywhere, unreflectively** — "the safest possible
   answer," a tell when it's clearly the default rather than a choice.
   [925studios](https://www.925studios.co/blog/ai-slop-design-tells).
3. **Three-to-six identical rounded feature cards**, thin-line icon, two
   lines of text, one border-radius on everything regardless of hierarchy.
   [dev.to, Purple Gradient Problem](https://dev.to/james_anderson_h/the-purple-gradient-problem-why-ai-ui-all-looks-alike-and-how-to-fix-it-3j65); Anthropic calls this the "SaaS card kit."
4. **Fade-and-slide-up on every section, bounce/elastic hover on every
   card** — named explicitly by Anthropic's skill as "the generic default"
   that "reads as AI-generated."
5. **Template chrome**: tracked-out ALL-CAPS eyebrow labels, meta strings
   joined with middle dots, "WORD — fragment" labels, monospace for small
   data with no reason. [Anthropic frontend-design SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md).
6. **Glassmorphism plus neon glow; gradient text on big stat numbers.**
   [dev.to, Purple Gradient Problem](https://dev.to/james_anderson_h/the-purple-gradient-problem-why-ai-ui-all-looks-alike-and-how-to-fix-it-3j65).
7. **Weightless, interchangeable copy** that could belong to any product.
   [925studios](https://www.925studios.co/blog/ai-slop-design-tells).
8. **A centered hero with a single floating CTA** and no supporting visual
   or specific claim anchoring it. Same source as #6.
9. **The overcorrection cliché** — "I know purple is a tell, so I'll use
   cream+terracotta (or dark+acid-green) instead" — itself now recognizable
   enough to be its own cliché, per Anthropic's own skill.
10. **Forms with no validation states or required-field marks** — the model
    has seen the HTML shape of a form far more than it's seen someone use
    one. [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website).
11. **Untouched default Tailwind grays/shadows** shipped as the final
    design. [dev.to, Purple Gradient Problem](https://dev.to/james_anderson_h/the-purple-gradient-problem-why-ai-ui-all-looks-alike-and-how-to-fix-it-3j65).
12. **Broadsheet/editorial layout with hairline rules, zero radius**, used
    reflexively as "the sophisticated alternative" — also flagged by
    Anthropic's skill as a pattern, not a guaranteed fix.

---

## Sources

- Refactoring UI — [sglavoie.com](https://www.sglavoie.com/posts/book-summary-refactoring-ui/), [howtoes.blog](https://howtoes.blog/2025/07/04/refactoring-ui-complete-book-summary-all-key-ideas/), [learnui.design](https://www.learnui.design/blog/ultimate-guide-font-sizes-ui-design.html)
- Butterick's Practical Typography — [Line length](https://practicaltypography.com/line-length.html), [Line spacing](https://practicaltypography.com/line-spacing.html), [Summary of key rules](https://practicaltypography.com/summary-of-key-rules.html)
- [The Crit, Font Pairing Guide](https://thecrit.co/resources/font-pairing-guide)
- [spec.fm, The 8-Point Grid](https://spec.fm/specifics/8-pt-grid)
- [CSS-Tricks, line length](https://css-tricks.com/setting-line-length-in-css-and-fitting-text-to-a-container/); [UI/UX Atlas, the ch unit](https://www.uiuxatlas.com/lessons/typography/line-length-and-the-ch-unit/)
- [WebAIM, Contrast and Color Accessibility](https://webaim.org/articles/contrast/); [WCAG 2.2 spec](https://www.w3.org/TR/WCAG22/); [AudioEye, What's New in WCAG 2.2](https://www.audioeye.com/post/wcag-22/)
- axe-core rules — [heading-order](https://rocketvalidator.com/accessibility-validation/axe/4.10/heading-order), [landmark-one-main](https://dequeuniversity.com/rules/axe/4.6/landmark-one-main), [page-has-heading-one](https://dequeuniversity.com/rules/axe/4.6/page-has-heading-one)
- [UX Planet, The 60-30-10 Rule](https://uxplanet.org/the-60-30-10-rule-a-foolproof-way-to-choose-colors-for-your-ui-design-d15625e56d25)
- Julian Shapiro / Demand Curve — [Landing Page Copywriting](https://www.julian.com/guide/startup/landing-pages)
- CXL — [High-Converting Landing Page](https://cxl.com/blog/how-to-build-a-high-converting-landing-page/); [Above the fold](https://cxl.com/blog/above-the-fold/)
- [Vercel Labs, web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) (fetched `AGENTS.md` directly)
- [Anthropic, frontend-design SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
- AI-slop writing — [925studios](https://www.925studios.co/blog/ai-slop-design-tells), [dev.to, Purple Gradient Problem](https://dev.to/james_anderson_h/the-purple-gradient-problem-why-ai-ui-all-looks-alike-and-how-to-fix-it-3j65), [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website), [dev.to, blame indigo-500](https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p)
- [BrowserStack, breakpoints 2025](https://www.browserstack.com/guide/responsive-design-breakpoints); [Framer, breakpoints 2026](https://www.framer.com/blog/responsive-breakpoints/)
- [web.dev, prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion)
- [DebugBear, Lighthouse Best Practices](https://www.debugbear.com/blog/lighthouse-best-practices)
- [Reflect, pseudo-elements in Playwright](https://reflect.run/articles/accessing-pseudo-elements-in-playwright/)
- [Keith Gaughan, detecting broken images](https://keith.gaughan.ie/detecting-broken-images-js.html)

---

## What to put in the Definition-of-Done skill (ranked)

1. **Structure gates**: one `h1`, heading order, singular landmarks, no
   orphan content, alt text present, no broken images. Zero ambiguity,
   cheapest to run — unconditional pass/fail every Review.
2. **No horizontal overflow at 320/400/768/1440px + tap targets ≥24px.**
   Directly matches DOD-3's existing wording ("at 400 px nothing
   overflows... navigation is usable") and DOD-5. Very high signal for
   "rough prototype."
3. **Contrast**: text ≥4.5:1 (≥3:1 large), UI components ≥3:1. Already an
   existing tool (`a11y_check_color_contrast`) — just needs to run every
   Review, not only when it occurs to the model.
4. **Font-family count ≤2–3, matches the brief's stated fonts.** The most
   direct, currently-missing link to DOD-3's literal wording. Needs the
   brief's font choice recorded as a machine-checkable string, not prose.
5. **Palette check**: ≤6–8 distinct colors, overlapping the brief's stated
   palette. Same reasoning as #4 for "colors on the page are the brief's
   palette" — needs a similarity tolerance, not exact match (see below).
6. **Spacing-scale adherence + section-rhythm variance report.** Softer
   signal: report as a warning for the reviewer, not a hard fail (legitimate
   designs vary spacing for pacing).
7. **Focus states present and not suppressed; hover/focus/active actually
   change computed style.** Cheap, catches the single most common a11y
   regression (`outline: none` with no replacement).
8. **`prefers-reduced-motion` respected; console has zero errors;
   Lighthouse Accessibility + Best Practices ≥90.** Bundle as a "browser
   health" pass alongside DOD-5.
9. **No lorem ipsum/TODO placeholders; every major section has a heading.**
   Already effectively DOD-4 in the loop design (Northwind Coffee example) —
   formalize as its own skill item so it survives context condensing
   independent of the brief file.
10. **Soft anti-slop flags**: default-only font stack, indigo/purple hero
    gradient, uniform radius across unrelated components, identical feature
    cards. Meant to prompt the reviewer to look, not to fail the build
    outright — a real brand might legitimately want purple.
11. **Explicit reviewer-judgment step for hierarchy, restraint, brand fit,
    copy voice** (the §B taste qualities). Keep as a required, named step —
    not a checklist id — so "no item passes from memory" still applies to
    what can't be scripted: the reviewer must say, in words, why the design
    fits the brief.

## Open questions

- **Palette/font matching tolerance.** "Matches the brief's palette" needs a
  similarity metric (nearest-hex/delta-E), not exact match — real builds use
  tints/shades of brand colors, not the literal hex codes.
- **Can Dulo's browser tool trigger real `:hover`/`:focus-visible`?**
  Playwright's `hover()`/`.focus()` do; a plain `evaluate_script` dispatching
  synthetic `MouseEvent`s may not reliably match CSS `:hover`. Worth a spike
  before writing item 17 into the skill as a hard check.
- **Where does Lighthouse Performance/SEO fit** — DOD-3 or DOD-5? This doc
  puts Accessibility/Best Practices in design quality and leaves
  Performance/SEO to DOD-5; the loop design doesn't currently say either way.
- **Rhythm/alignment checks (#7, #10) are heuristic proxies, not hard
  failures** — they will sometimes flag legitimate variation as a defect.
  The skill needs to say explicitly these are "look closer" signals, not
  blocking checklist items, or Dulo will spend iterations "fixing" pacing
  that was fine.
- **Anti-slop flags are the least reliable checks here** — a legitimate
  brand can be purple; a deliberately minimal design can use one radius
  everywhere. Ship these as soft warnings only, never a blocking DOD item.
- **None of this replaces vision.** Every item is a proxy for what a human
  sees in one glance. The loop design's own risk list already says DOD-3 is
  "under-checked without vision" — this narrows the gap, it doesn't close
  it. Image pass-through (`src/mcp.ts`) and a vision-capable reviewer remain
  the real fix (roadmap Step 4).
