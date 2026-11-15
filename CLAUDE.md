# agent-sandbox

Controller in `src/` (Node), dashboard in `web/` (React, Tailwind v4, shadcn), docs in `docs/`.

## Design and UX work

Before designing, restyling, polishing or reviewing any UI (web dashboard, landing page, mobile
app, a new component or an existing one), read `web/DESIGN.md` first. Two parts of it are
mandatory, not background:

- **"Principles that shape every screen"** and **"Surfaces"**: the grammar every screen follows
  (ink on paper, colour only for machine state, tonal surfaces and tiles instead of outlined
  boxes, pill controls, sentence-case labels, one motion vocabulary).
- **"Inspiration sources"**: the reference libraries to consult *before* drawing anything new.
  For the look of an expensive, premium interface start with the five under "The expensive-UI
  references": hyperiux vault, vanta ui, bencho, obsidian ui and beste. Open them, borrow their
  taste and interaction patterns, never their code. When a brief says "more premium", "more
  modern", "feels cheap" or "not polished", compare the screen against those sites and name what
  differs before changing anything.

Verify visual work with screenshots in both colour schemes (see `.shots/pages-tour.mjs` and
`.shots/qa-fix.mjs`) and record new references or rules in `web/DESIGN.md`, not here.
