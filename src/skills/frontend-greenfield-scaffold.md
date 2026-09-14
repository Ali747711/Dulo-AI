---
name: frontend-greenfield-scaffold
description: "How to create and lay out a new landing-page project in the workspace — the scaffold tool, the file blueprint, and the conventions for tokens, fonts, content, images and meta tags. Load at the start of Act."
---

# Building a new landing page

Everything happens in the workspace. You never touch Dulo's own files, and every path
you give a tool is relative to the workspace root.

## 1. Create the project

```
scaffold_project { slug: "northwind-coffee", name: "Northwind Coffee" }
```

The slug is the folder and package name: lower-case letters, digits and hyphens, taken
from the business name. It copies Dulo's landing-page template, fills the name in, and
installs the dependencies. It refuses a folder that already has something in it, so
pick another slug rather than overwriting someone's work.

You get back the file tree. Read `src/content/site.ts`, `src/index.css` and
`index.html` before changing anything: they are where almost all of your work happens.

## 2. What the template gives you

```
<slug>/
├── index.html                 title, description, Open Graph tags, favicon link
├── package.json               scripts: dev, build, preview, typecheck, lint
├── vite.config.ts             React + Tailwind plugins; nothing to change
├── tsconfig*.json             strict TypeScript; nothing to change
├── public/favicon.svg         a plain mark to recolour or replace
└── src/
    ├── main.tsx               mounts the app; nothing to change
    ├── index.css              @theme design tokens, base styles, reduced-motion
    ├── App.tsx                header, the sections in order, footer
    ├── content/site.ts        every word and detail on the page, typed
    └── components/
        ├── layout/            Header, Footer
        ├── sections/          Hero, and one file per section you add
        └── ui/                Button, Container, SectionHeading
```

The template ships deliberate placeholders: `TODO` strings in `site.ts` and
`index.html`. They exist so an unfinished page fails DOD-4 loudly instead of shipping
quietly. Replace every one of them.

## 3. The order that works

1. **Tokens first** (`src/index.css`). Put the palette and the typefaces from your
   design direction into the `@theme` block. Every colour and font on the page comes
   from here; no ad hoc hex values in components.
2. **Fonts.** Install them, then import them above the `@theme` block:
   ```
   npm install @fontsource-variable/fraunces @fontsource-variable/dm-sans
   ```
   ```css
   @import "@fontsource-variable/fraunces";
   @import "@fontsource-variable/dm-sans";
   ```
   and point the tokens at them: `--font-display: "Fraunces Variable", serif;`.
   Self-hosted, so there is no third-party request and no flash of the wrong font.
   Never download font files with a script.
3. **Content** (`src/content/site.ts`). Write the real copy from the brief: the
   headline, the sections, the address, the hours. Add fields as the brief needs them.
   This file is what the review reads to check the page against the brief, so keep
   everything there rather than inline in components.
4. **Sections.** One file per section under `src/components/sections/`, named for what
   it is (`Story.tsx`, `Menu.tsx`, `Visit.tsx`). Each is a `<section>` with an `id`,
   opening with `<SectionHeading>`. Add them to `App.tsx` in the brief's order and to
   `site.nav`.
5. **Meta** (`index.html`). Real title, a description under 160 characters, the same
   text in the Open Graph tags. Recolour `public/favicon.svg` to the palette.
6. **README.** Say what the site is and how to run it.

## 4. Conventions that keep the checks passing

- One `<h1>`, in the hero. Every other heading is `<h2>` or deeper, in order.
- Landmarks: one `<header>`, one `<main>`, one `<footer>`, `<nav>` labelled.
- Images: always `width` and `height` (or an aspect ratio) so nothing jumps as they
  load. The hero image stays eager with `fetchpriority="high"`; everything below the
  fold gets `loading="lazy"`. Every image needs `alt`, empty if purely decorative.
- Buttons and links: use the shared `Button`, so hover and focus states exist once.
  Anything tappable is at least 44 px tall.
- Spacing from Tailwind's scale (multiples of 4). No arbitrary values unless you can
  say why.
- Motion: the template already honours `prefers-reduced-motion`. Keep it that way, and
  animate one thing, not every section.
- No backend: a contact form that cannot send must say so, or be a `mailto:`/`tel:`
  link instead.

## 5. Run it and look at it

```
dev_server { action: "start", project: "northwind-coffee" }
```

Returns the URL. The server keeps running after the turn, which is what makes the page
previewable; stop it with `action: "stop"` when the work is finished, and use
`action: "status"` to see what is running. Never try to start a server with `shell`:
that tool stops any command after 30 seconds.

Check the build with `shell` before opening the browser: `npm run build` in the project
runs the type check and the production build. One command per `shell` call, no `&&`.

## 6. Versions

The template pins these, verified 2026-09-14. Do not bump them mid-build; if they need
refreshing, that is a separate change with `npm run template:check` to prove it.

| Package | Version |
| --- | --- |
| vite | ^8.3.0 |
| react, react-dom | ^19.3.0 |
| @vitejs/plugin-react | ^6.1.1 |
| tailwindcss, @tailwindcss/vite | ^4.3.3 |
| typescript | ~6.0.2 |
| oxlint | ^1.82.0 |
