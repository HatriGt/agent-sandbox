# agent-sandbox — Style Reference

> Built on **Radix Themes + Geist**. A dense agent-ops console (Linear / Vercel lineage) that stands
> on a real, opinionated design system instead of hand-tuned tokens — so nothing reads as generic.
> Run STATE is the loudest signal; one accent (indigo) carries every action; geometry is Radix's.

**Theme:** dual (deep-slate dark default, cool-paper light), owned entirely by the Radix `<Theme>`.

## Foundation

The app is wrapped in a single Radix `<Theme>` (see `App.tsx`):

```tsx
<Theme appearance={dark ? "dark" : "light"} accentColor="indigo" grayColor="slate" radius="medium" scaling="100%">
```

- **`accentColor="indigo"`** — the one action hue. Radix generates the full 1..12 scale + alpha + a
  contrast-safe `--accent-contrast` for text on the fill, per mode. We never pick accent hex by hand.
- **`grayColor="slate"`** — the cool neutral field. Radix generates `--gray-1..12` and `--gray-a1..12`
  (alpha) per mode; every surface, text tier, and hairline is one of these.
- **`radius="medium"`** — drives `--radius-1..6`; our radii map onto that scale so shape matches the
  Radix components.
- **`appearance`** follows the theme toggle (dark by default; persisted in `localStorage`). Radix owns
  light/dark, so there is no separate hand-maintained dark block.

Everything else (`index.css`) is a thin **mapping layer**: the app's semantic variables and the shadcn
contract are *derived* from Radix tokens, so all existing components inherit Radix's palette, its
guaranteed AA contrast, and its geometry for free.

## Tokens — Colors (all derived from Radix scales)

| Semantic var | Maps to (Radix) | Role |
|---|---|---|
| `--canvas` | `--color-background` | Page field (slate, per mode). |
| `--surface` | `--gray-2` | Panels, cards, active rows. |
| `--raised` | `--gray-3` | Hover / popover lift. |
| `--fg` | `--gray-12` | Primary text. |
| `--muted-fg` | `--gray-11` | Secondary text — AA by Radix construction. |
| `--line` | `--gray-a5` | Hairlines (alpha: reads on any surface). |
| `--line-strong` | `--gray-a7` | Hover borders, scrollbar thumb. |
| `--accent` | `--accent-9` | THE action fill (buttons, primary CTA). |
| `--accent-fg` | `--accent-contrast` | Text on the accent fill. |
| `--accent-text` | `--accent-11` | Accent as text/icon/state (working), focus ring. |
| `--danger` | `--red-9` | Destroy + non-zero exit. |
| `--attention` / `--attention-text` | `--amber-9` / `--amber-11` | Needs-you (the one state with a deadline). |
| `--ok` | `--green-11` | Completed / healthy. |
| `--trace` | `--gray-1` | Terminal ground (darkest neutral surface). |

State is the one exception to "one accent": working (accent), needs-you (amber), done (slate), error
(red) each carry a functional hue, but **always** with a glyph + word (see `stamp.tsx`) so colour is
never the sole carrier.

## Typography — Geist

- **Geist Variable** (sans) — the single UI face. Vercel's product/dev-UI grotesk, self-hosted variable
  via `@fontsource-variable/geist` (no Google Fonts request, no FOUT, offline-correct).
- **Geist Mono Variable** — machine text only: identifiers, vitals (tabular), tool calls, log output,
  stamps.

Geist is applied by overriding Radix's `--default-font-family` (and its mono/code/em/quote font tokens)
on `.radix-themes` **outside any `@layer`** — Radix's stylesheet is un-layered and would otherwise win.

### Type Scale (dense console; agent prose is the one step-up)

| Role | Size | Line height |
|---|---|---|
| stamp | 10.5px | 1.2 (0.06em, uppercase, mono) |
| micro | 11px | 1.4 |
| meta | 13px | 1.5 |
| body | 14px | 1.6 |
| prose (agent output, read) | 16px | 1.65 (`max-width: 72ch`) |
| h3 | 18px | 1.35 |
| h2 | 22px | 1.25 |
| h1 | 28px | 1.15 |
| display | 34px | 1.1 |

`.prose-agent` is the single place type steps up (16px), because it is read, not scanned.

## Shapes — Radix radius scale

Radii map onto Radix's `--radius-1..6` (driven by `radius="medium"`): `--radius-sm/md/lg/xl` →
`--radius-2/3/4/5`. The only genuinely round things are the live dot and avatars (`--radius-pill`).
Focus rings use the console shape (`--radius-sm`), not a pill.

## Motion

One authored animation: the live indicator `breathe`. Everything else is CSS hover/transition. All
motion collapses under `prefers-reduced-motion: reduce`.

## Accessibility

- Contrast is AA-by-construction: text tiers use `--gray-11/12` and `--accent-11`, which Radix
  guarantees against their paired surfaces in both modes.
- Touch targets: a global `@media (pointer: coarse)` rule floors interactive elements at 44px without
  inflating desktop density.
- Focus: a visible 2px `--accent-text` ring on `:focus-visible`.
