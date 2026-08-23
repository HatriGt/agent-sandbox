# agent-sandbox — Style Reference

> **Cloned inch-by-inch from the [CRM AI Agent reference](https://crm-ai-agent-tau.vercel.app/)**
> (assistant "Rune"), studied *live in a browser* at 1440×900 and measured via `getComputedStyle`. We
> mirror its exact chrome, layout, typography, colours, radii and component shapes, mapped onto our
> domain: a console for delegating coding tasks to ephemeral microVM sandboxes running the Claude Code
> agent. We clone the reference's *look and feel* but NOT its concepts: there are no CRM nav items
> (Balances/Customers/Contracts), no fake multi-workspace switcher, and no fabricated agent roster.
> Every region shows real product data.
>
> Built on **shadcn (neutral base) + prompt-kit + Inter/Hedvig/Geist Mono**. The chat surface — the
> product's core — is composed from prompt-kit's purpose-built AI-chat components (ChatContainer,
> PromptInput, Steps, Tool, Markdown, ScrollButton) rather than hand-rolled bubbles. The shell of the
> console (sidebar, Sandboxes table, command palette) shares the same token base. Run STATE is the
> loudest signal; geometry is the reference's; nothing is bespoke where a proven part exists.

**Theme:** dual — **zinc-on-white light is the default and primary target** (the reference is light);
dark is a coherent zinc charcoal version of the same feel. Toggled by a `dark` class on `<html>`.

## Extracted reference spec (measured live via getComputedStyle @ 1440×900)

The reference renders **light** when the OS prefers light (it follows `prefers-color-scheme`; we
forced light via CDP `Emulation.setEmulatedMedia` to measure the intended primary theme).

| Property | Measured value |
|---|---|
| Body / UI font | **Inter** (`font-family: Inter, …`), 14px body |
| Greeting font | **Hedvig Letters Serif** (serif display), ~30px, weight 400 |
| Mono | none distinct in reference (we keep Geist Mono for machine text) |
| Canvas / page bg | pure white `rgb(255 255 255)` |
| Sidebar bg | white, separated by a single hairline `border-r` (no float, no gap) |
| Card / panel bg | white |
| Border / hairline | zinc `~rgb(228 228 231)` (very low chroma, cool) |
| Primary text | near-black zinc `~rgb(24 24 27)` |
| Muted / nav-inactive text | zinc `~rgb(113 113 122)` |
| Accent (active nav fill) | subtle zinc surface fill, not a saturated hue |
| Sidebar width | ~208–224px (we use 208px / `13rem`) |
| Radii | tight **6–8px** on cards, nav rows, chips, search pill (`rounded-md`) |
| Layout | **flat two-column**: `border-r` sidebar + white content, no floating cards |
| Hero | **left-aligned** serif greeting → subtitle → composer → skill-chip row |
| Composer | single rounded surface, controls on bottom row |

## Mapping the reference onto our domain

| Reference region | Our surface |
|---|---|
| Workspace switcher | Brand/identity header for **agent-sandbox** (icon + name + live status). No fake workspaces. |
| Search ⌘K pill | Search pill wired to the **CommandPalette** (⌘K), which searches machines by task. |
| Left nav (Home/Inbox/…) | **Chat** and **Sandboxes** — the two real destinations. No invented CRM items. |
| Sidebar chat/agent list | **MachineList** — live sandbox machines: state + task + short-name + uptime. |
| Center hero empty state | **Hub** — time-aware greeting, assistant-voice subtitle, delegate composer, starter chips, previous runs. |
| Center chat state | **Thread** — breadcrumb (Agent / machine / task), agent prose, "N tools used" pills, clarifying-question-with-buttons, artifacts, vitals in the header. |
| Right agent-roster panel | **Omitted** — our data has no roster; forcing a third column would mean fake content. Two-column shell keeps the faithful feel. |

## Foundation

The colour system is a **cool zinc-on-white light theme** (near-zero chroma, cool hue ~275) matching
the reference's near-monochrome palette: white sidebar and content separated by a hairline, colour
reserved for the single accent and functional state hues. Defined once in `index.css` under `:root`
(light) and `.dark`. There is no runtime theme provider — the `useTheme` hook in `App.tsx` toggles the
`dark` class on `document.documentElement` and persists to `localStorage`. Tailwind v4 reads the
tokens through `@theme inline`.

### Key patterns cloned from the reference

- **Flat shell** — the sidebar is a flat white column separated from the content by a single
  `border-r` hairline (no float, no gap, no elevation), exactly like the reference.
- **"N tools used" pill** (`ToolGroup`) — consecutive tool calls fold into one summary pill that
  expands to the individual terminal panels / tool rows.
- **Clarifying-question-with-buttons** (`AskingItem`) — when the agent halts with a question that
  contains inline options (`[Acme Corp] [New Acme Corp]` or a `1) … 2) …` list), those render as
  one-click answer buttons that release the run; otherwise the free-text reply below is used.
- **Breadcrumb** — the thread header carries an `Agent / <machine> / <task>` trail.

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

## Tokens — Colors (oklch, defined in `index.css`)

The base is the shadcn semantic contract (`--background/--foreground/--primary/--muted/--border/…`);
the app vocabulary below is *derived* from it in `@theme inline` so existing components inherit the
base with no per-line edits. Light values shown; `.dark` swaps the same names.

| Semantic var | Light value / maps to | Role |
|---|---|---|
| `--background` / `--canvas` | `oklch(0.975 0.003 95)` | Warm-neutral page field the cards float on. |
| `--card` / `--raised` | `oklch(1 0 0)` | White floating panels, cards, popovers. |
| `--surface` | `oklch(0.968 0.003 95)` | Hover / active rows, inset pills. |
| `--foreground` / `--ink` | `oklch(0.24 0.008 275)` | Primary text. |
| `--muted-foreground` / `--ash` | `oklch(0.52 0.008 275)` | Secondary text (AA on card/canvas). |
| `--border` / `--line` | `oklch(0.915 0.004 95)` | Hairlines. `--line-strong` for hover borders. |
| `--primary` / `--azure` | `oklch(0.46 0.11 272)` | THE action fill (buttons, primary CTA). |
| `--accent-fg` | `--primary-foreground` | Text on the accent fill. |
| `--accent` / `--accent-foreground` | soft neutral / slate-indigo | Active nav, selected rows, agent avatar. |
| `--azure-text` | `--primary` | Accent as text/icon/state (working), focus ring. |
| `--danger` | `oklch(0.577 0.222 27.3)` | Destroy + non-zero exit. |
| `--attention` / `--attention-text` | amber | Needs-you (the one state with a deadline). |
| `--ok` | green | Completed / healthy; the `$` shell prompt glyph. |
| `--trace` / `--trace-fg` | dark ground / light text | Terminal panels — **verified legible in BOTH themes** (light text on dark ground in both). |

State is the one exception to "one accent": working (accent), needs-you (amber), done (slate), error
(red) each carry a functional hue, but **always** with a glyph + word (see `stamp.tsx`) so colour is
never the sole carrier.

## Typography — Inter + Hedvig Letters Serif (the reference's exact faces)

Both are freely available and self-hosted via fontsource (no Google Fonts request, no FOUT,
offline-correct):

- **Inter Variable** (sans) — the single UI/body face, matching the reference's measured
  `font-family: Inter`. Via `@fontsource-variable/inter`.
- **Hedvig Letters Serif** — the greeting/display serif, matching the reference's hero. Via
  `@fontsource/hedvig-letters-serif`. Used through `font-serif` on the Hub greeting.
- **Geist Mono Variable** — machine text only (identifiers, vitals, tool calls, log output, stamps).
  The reference has no distinct mono face; we keep Geist Mono because the product needs one.

Wired in `main.tsx` (self-hosted) and set as `--font-sans` / `--font-serif` / `--font-mono` in the
`@theme inline` block.

### Type Scale (matched to the reference)

| Role | Size | Line height |
|---|---|---|
| stamp | 10.5px | 1.2 (0.06em, uppercase, mono) |
| micro | 11px | 1.4 |
| meta | 13px | 1.5 |
| body | 14px | 1.5 |
| prose (agent output, read) | 15px | 1.65 |
| h3 | 16px | 1.4 |
| h2 | 20px | 1.4 |
| h1 (greeting) | 30px | 1.2 (**serif**, weight 400) |
| display | 30px | 1.2 |

The greeting is the one place type steps up into the serif face at 30px/400, exactly as the reference.

## Shapes — tight radii (reference feel)

The reference uses **6–8px** corners throughout. Cards, nav items, chips, the Search pill and "New
task" button all use `rounded-md`; the composer uses `rounded-xl`. Only genuinely round things (live
dot, avatars, send button) use `--radius-pill`. No `rounded-2xl` floating-card treatment — the shell
is flat with a hairline `border-r`.

## Motion

One authored animation: the live indicator `breathe`. Everything else is CSS hover/transition. All
motion collapses under `prefers-reduced-motion: reduce`.

## Accessibility

- Contrast: text tiers (`--foreground`, `--muted-foreground`) and the accent-as-text (`--azure-text`
  → `--primary`) are tuned to read AA against card/canvas in both light and dark.
- Touch targets: a global `@media (pointer: coarse)` rule floors interactive elements at 44px without
  inflating desktop density.
- Focus: a visible 2px `--accent-text` ring on `:focus-visible`.
