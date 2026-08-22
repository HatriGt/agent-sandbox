# agent-sandbox — Style Reference

> **Modelled on the [CRM AI Agent reference](https://crm-ai-agent-tau.vercel.app/)** (assistant
> "Rune") — its clean, airy, soft-neutral light aesthetic — mapped onto our domain: a console for
> delegating coding tasks to ephemeral microVM sandboxes running the Claude Code agent. We clone the
> reference's *look and feel* (palette, typography, radii, spacing, layout structure, card/pill/bubble
> styling) but NOT its concepts: there are no CRM nav items (Balances/Customers/Contracts), no fake
> multi-workspace switcher, and no fabricated agent roster. Every region shows real product data.
>
> Built on **shadcn (neutral base) + prompt-kit + Geist**. The chat surface — the product's core — is
> composed from prompt-kit's purpose-built AI-chat components (ChatContainer, PromptInput, Steps, Tool,
> Markdown, ScrollButton) rather than hand-rolled bubbles, so it reads like a real assistant UI. The
> shell of the console (sidebar, Sandboxes table, command palette) shares the same token base.
> Run STATE is the loudest signal; geometry is the reference's; nothing is bespoke where a proven part exists.

**Theme:** dual — **soft-neutral light is the default and primary target** (the reference is light);
dark is a tuned dark version of the same feel (near-neutral charcoal, not the old blue). Toggled by a
`dark` class on `<html>`.

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

The colour system is a **soft warm-neutral light theme** (canvas hue ~95, very low chroma) with a
**restrained slate-indigo accent** (hue ~272), modelled on the reference's near-monochrome palette:
white floating cards on a faint warm canvas, colour reserved for the single accent and functional
state hues. Defined once in `index.css` under `:root` (light) and `.dark`. There is no runtime theme
provider — the `useTheme` hook in `App.tsx` toggles the `dark` class on `document.documentElement`
and persists to `localStorage`. Tailwind v4 reads the tokens through `@theme inline`.

### Key patterns cloned from the reference

- **Floating shell** — sidebar and workspace are detached, `rounded-2xl`, softly elevated cards on a
  breathing canvas.
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

## Typography — Geist

- **Geist Variable** (sans) — the single UI face. Vercel's product/dev-UI grotesk, self-hosted variable
  via `@fontsource-variable/geist` (no Google Fonts request, no FOUT, offline-correct).
- **Geist Mono Variable** — machine text only: identifiers, vitals (tabular), tool calls, log output,
  stamps.

Geist is wired in `main.tsx` (self-hosted variable fonts) and set as `--font-sans` / `--font-mono` in
the `@theme inline` block, so Tailwind's `font-sans` / `font-mono` and the `body` default both use it.

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

## Shapes — medium radii (reference feel)

`--radius` is `0.875rem`; `--radius-sm/md/lg/xl` derive from it in `@theme inline`. Cards and the
floating shell use `rounded-2xl`, list rows / nav items / palette rows use `rounded-xl`/`rounded-lg`,
and chips (starters, answer buttons, the "N tools used" pill, the Search pill) are `rounded-full` to
match the reference's soft, airy geometry. The only genuinely round things are the live dot and
avatars (`--radius-pill`).

## Motion

One authored animation: the live indicator `breathe`. Everything else is CSS hover/transition. All
motion collapses under `prefers-reduced-motion: reduce`.

## Accessibility

- Contrast: text tiers (`--foreground`, `--muted-foreground`) and the accent-as-text (`--azure-text`
  → `--primary`) are tuned to read AA against card/canvas in both light and dark.
- Touch targets: a global `@media (pointer: coarse)` rule floors interactive elements at 44px without
  inflating desktop density.
- Focus: a visible 2px `--accent-text` ring on `:focus-visible`.
