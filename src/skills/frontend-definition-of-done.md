---
name: frontend-definition-of-done
description: The review checklist a frontend build must pass before it is called done, with the exact checks and the evidence each needs. Load at Plan to write the checklist, and at every Review to run it.
---

# Frontend definition of done

Six items, DOD-1 to DOD-6. At Plan, copy them, plus one line per requested section,
into `manage_todos` and into the brief file. At Review, run every check below against
the real project and record, per item, pass or fail and the exact output that proves
it.

Rule of evidence: a pass quotes a tool, command, or browser result from this Review.
"It looked fine", "I wrote it that way", or a result from an earlier round is a fail.

Hard checks fail the item. Soft checks never fail an item on their own: they tell you
to look closer and to say, in words, whether the choice was deliberate for this brief.

## Setup for a Review

1. Commands, from the project folder: `npm run build` (this includes the type check),
   then `npm run lint` if the script exists. Quote the last lines and the exit status.
   The `shell` tool runs one allow-listed program with its arguments: no `&&`, pipes,
   redirection, or background jobs, and it stops the command after 30 seconds. Run
   one command per call.
2. Dev server: a running server needs a tool that keeps a process alive. Use the
   dev-server tool when one is listed (it starts the server, gives you the URL, and
   stops it). If none is listed, DOD-5 cannot be proven: record it as fail with the
   reason "no tool can keep a dev server running", finish the command-level checks,
   and stop as blocked. Never try to run the server through `shell`; it is killed
   after 30 seconds and proves nothing.
3. Browser: open the URL, wait for the page to load, run the checks at 1440 px wide,
   then resize to 400 px and run the responsive checks again. Read the console last.
   When Review ends, stop the server through the same tool that started it.

Prefer the `playwright_browser_*` tools. The `chrome-devtools_*` equivalents work the
same way: `evaluate_script` for `browser_evaluate`, `take_snapshot` for
`browser_snapshot`, `resize_page` for `browser_resize`, `list_console_messages` for
`browser_console_messages`.

## DOD-1 Clarification is complete

Pass when `.dulo/<slug>/brief.md` names all six: the visitor's one action; the
sections or pages; the audience; the key content and who supplies it; the brand assets
or the chosen substitutes; the feel. And it lists every assumption made. Check by
reading the file and quoting the six fields. Fail when a field is empty or an
assumption exists only in the chat.

## DOD-2 Properly built

Hard:

- Stack: `package.json` lists react, react-dom, typescript, tailwindcss, and
  `@tailwindcss/vite`; `vite.config.ts` uses the Tailwind plugin; design tokens live in
  an `@theme` block in `src/index.css`. Quote the lines.
- `npm run build` exits 0. Quote the last three lines.
- `npm run lint` exits 0 when the script exists.
- Structure: one component file per requested section under `src/components/sections/`;
  the content in one typed file (`src/content/site.ts`); no source file over 300 lines
  (`wc -l`); no `any` (`grep -rn ": any\|as any\|<any>" src` returns nothing).

Soft: shared primitives (button, container, section heading) exist and are used, so
hover and focus states are defined once.

## DOD-3 Design quality is solid

Hard, from the accessibility snapshot and `browser_evaluate` at 1440 px:

- Exactly one `h1`: `document.querySelectorAll('h1').length === 1`.
- Heading levels never skip: walk `h1` to `h6` in DOM order; each heading is at most
  one level deeper than the one before it.
- Landmarks: one `main`, one `header`, one `footer`; every `nav` labelled when there is
  more than one.
- Fonts in use are the brief's:
  `[...new Set([...document.querySelectorAll('body *')].map(e => getComputedStyle(e).fontFamily.split(',')[0].trim()))]`
  lists at most three families, includes the two chosen, and is not only system
  fallbacks (`ui-sans-serif`, `system-ui`, `Arial`, `Times`). They loaded:
  `document.fonts.check('16px "<Family>"')` is true for each.
- Type scale: the distinct computed `font-size` values across visible text number 4 to
  7 (hard fail above 9). Adjacent sizes at least 20 % apart is soft.
- Body line height between 1.35 and 1.7 on paragraphs:
  `parseFloat(getComputedStyle(p).lineHeight) / parseFloat(getComputedStyle(p).fontSize)`.
- Contrast: run the contrast tool (`a11y_check_color_contrast`, or
  `a11y_test_accessibility`) against the page. Text needs 4.5:1, or 3:1 at 24 px and
  above or 19 px bold. No failures.
- Colors in use: the distinct computed `color`, `background-color`, and `border-color`
  values, ignoring fully transparent ones, form at most 8 clusters (hard fail above
  10), and the brief's palette is present, counting tints and shades as matches.
- Interactive states: for the primary button and one link, the computed style at rest
  differs after `browser_hover`, and after focusing it from `browser_evaluate`. On
  focus, `outline-style` is not `none` unless the diff shows a replacement ring.
- Images: `[...document.images].filter(i => !(i.complete && i.naturalWidth > 0)).length === 0`;
  every `img` has an `alt` attribute; every `img` has `width` and `height` or an
  aspect ratio.
- Motion: with reduced motion emulated (`chrome-devtools_emulate`, if it offers it;
  otherwise confirm a `prefers-reduced-motion` rule exists in the CSS), long
  animations stop; nothing autoplays longer than 5 seconds without a control.

Soft, reported as warnings, then judged in words:

- Spacing: sampled `padding`, `margin`, and `gap` values are mostly multiples of 4;
  section paddings are consistent unless the pacing is deliberate.
- Content width is bounded: containers around 1200 to 1280 px, prose around 65ch.
- Generic-AI tells (this list is dated 2026-09 and needs refreshing): an
  indigo-to-purple gradient chosen by default; Inter or Roboto chosen by default;
  three to six identical rounded cards with thin-line icons; fade-and-slide-up on every
  section and bounce on every hover; ALL-CAPS tracked eyebrow labels and middle-dot
  meta strings; glass panels with neon glow; gradient text on statistic numbers; copy
  that could belong to any product; a centred hero with one floating button and no
  specific claim; the overcorrection (cream plus terracotta, or black plus acid green)
  chosen reflexively; untouched default Tailwind grays and shadows; hairline rules and
  zero radius as "the sophisticated alternative". A brief may ask for any of these.
  The flag means: confirm it was chosen for this brief, and say why.

Judgment, required, in words: does the most important thing look the most important?
Is boldness spent in one place? Does every visible choice trace to the subject or the
brief? Does the copy sound like this business and no other? Two to four sentences.
This is the part no script proves, so it is never skipped.

## DOD-4 Brief fit

Hard:

- Every section in the brief has a heading in the snapshot. Quote the heading list.
- Every key content item (address, hours, prices, names) appears verbatim. Quote it.
- Every call to action links somewhere real (`href` is not `#` or empty), and the
  primary action appears at least twice.
- No placeholder text: `grep -rni "lorem\|ipsum\|TODO\|your company\|placeholder" src`
  returns nothing, unless the brief asked for placeholders.

## DOD-5 Ready to run and preview

Hard:

- The dev server started and printed a local URL. Quote the line.
- The page loads at that URL: the snapshot contains the `h1` text.
- Console: zero errors at load (`browser_console_messages`). List any warnings.
- Responsive at 400 px, and at 320 px when time allows:
  `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`;
  the navigation is usable (a visible menu control, or visible links); no element with
  a fixed width wider than the viewport.
- Tap targets: every `a`, `button`, `input`, and `[role=button]` has a bounding box of
  at least 24 by 24 px at 400 px; the primary action at least 44 by 44.
- The README states the run command.

Soft: `chrome-devtools_lighthouse_audit` Accessibility and Best Practices score 90 or
above. Report failing audits by name.

## DOD-6 Self-checked before reporting

Pass when every item above has a status and quoted evidence from this Review, the
todos are updated, and the checklist section of the brief file matches. Where the
`report_done` tool exists, pass means it accepted the claim.

## Recording

For each item write `DOD-n: pass` or `DOD-n: fail`, then one or two lines of quoted
output. A fail names what to change. Update `manage_todos`. Then, and only then,
decide: Improve (any fail, fewer than three iterations used, and something concrete to
change), or Stop with pass, cap, or blocked.
