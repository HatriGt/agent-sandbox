# agent-sandbox — Style Reference

> Built on **shadcn (neutral base) + prompt-kit + Geist**. The chat surface — the product's core — is
> composed from prompt-kit's purpose-built AI-chat components (ChatContainer, PromptInput, Steps, Tool,
> Markdown, ScrollButton) rather than hand-rolled bubbles, so it reads like a real assistant UI. The
> shell of the console (sidebar, Sandboxes table, command palette) shares the same shadcn token base.
> Run STATE is the loudest signal; geometry is shadcn's; nothing is bespoke where a proven part exists.

**Theme:** dual (neutral dark default, neutral light), toggled by a `dark` class on `<html>`.

## Foundation

The colour system is shadcn's **canonical neutral theme** (the exact oklch values from ui.shadcn.com),
defined once in `index.css` under `:root` (light) and `.dark`. There is no runtime theme provider — the
`useTheme` hook in `App.tsx` toggles the `dark` class on `document.documentElement` and persists to
`localStorage`. Tailwind v4 reads the tokens through `@theme inline`.

Two layers sit on top:

- **prompt-kit components** (`src/components/ui/{chat-container,prompt-input,steps,tool,message,`
  `reasoning,scroll-button,markdown,code-block}.tsx`) install as standard shadcn and read the same
  `--background / --foreground / --primary / --muted …` contract, so the chat surface and the rest of
  the app are one system. Installed via `npx shadcn add https://prompt-kit.com/c/<name>.json`.
- **an app vocabulary** (`--azure` → primary, `--ink` → foreground, `--ash` → muted-foreground,
  `--trace` for the terminal ground, plus functional status hues `--attention` / `--ok`) *derived*
  from the shadcn tokens in `@theme inline`, so existing components inherit the base with no per-line
  edits. A handful of legacy raw-var aliases (`--surface`, `--canvas`, `--line`, `--accent-text`) map
  onto the shadcn tokens for the same reason.

### Chat surface (prompt-kit)

- **Conversation column** — `ChatContainerRoot / ChatContainerContent / ChatContainerScrollAnchor`
  (built on `use-stick-to-bottom`) owns anchoring: it sticks to the newest turn, yields when the reader
  scrolls up, and a `ScrollButton` floats in to jump back down.
- **Composer** — both the Hub "new machine" box and the Thread `SendBar` are prompt-kit `PromptInput`
  (autosizing textarea, Enter-to-send, `PromptInputActions`). SendBar keeps the reply/ask segmented
  control on top so the two destinations stay unambiguous.
- **Agent prose** renders through prompt-kit `Markdown` (+ `CodeBlock`) at 16px full-measure, no bubble.
- **Tool output** — shell commands render as a terminal panel on the `--trace` ground (`$ cmd` + folded
  output); other tools are compact rows with the argument in a code chip. prompt-kit's `Tool` and
  `Steps` primitives are available for richer structured-tool rendering.

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
