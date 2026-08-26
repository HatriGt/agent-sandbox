# agent-sandbox — design reference

> An operator console for a small fleet of ephemeral microVMs running Claude Code. One person, three
> scenes: a second screen beside Cursor, the only screen when away from the IDE, and a phone in
> daylight. The surface exists to answer two questions fast — *does anything need me?* and *what is
> this machine doing right now?* — and to act on the answer without leaving the page.
>
> Built on **shadcn/ui (neutral) + Radix primitives + prompt-kit chat components + Tailwind v4**, with
> **Inter** (UI), **Hedvig Letters Serif** (the one expressive moment: the greeting) and **Geist Mono**
> (machine data only). Components are vendored under `src/components/ui/` and edited in place.

## Principles that shape every screen

1. **`needs you` is the loudest thing on screen.** Amber is reserved for it: the sidebar queue card,
   the state pill, the paused-question card, the composer's halo, the "Answer" button. Nothing else
   is amber.
2. **Colour is functional.** Six states carry six hues, each with a drawn icon and a word so the
   meaning survives colour-blindness and sunlight: working (live blue, breathing), needs you (amber),
   done (green), failed (red), idle (grey), **sleeping** (violet — an idle-stopped microVM whose
   workspace survives; a reply wakes it). The single primary action is ink. Everything else is ink on
   paper.
3. **Two voices, never confusable.** The agent is full-measure prose with a small label. You are the
   one bubble (a quiet muted fill, right-aligned). A **side question** — answered by a separate
   read-only helper inside the sandbox, never by the agent — is a dashed card that says so every time.
   (It was called "Co-pilot"; that implied steering, which it cannot do.)
4. **Show what is alive, never imply history.** No trends, KPI tiles or aggregates. The one
   "dashboard" element is the **capacity strip** — `MSB_MAX_BOXES` slots coloured by the machine in
   each — because it is the present shape of the fleet, not a chart over data that was never stored.
   Lifecycle facts ("42m left of the run cap", "stops in ~9m if quiet") come from real config and
   real timestamps; the idle figure is labelled as an estimate.
5. **The phone is the same product.** Single-pane on mobile (rail ↔ workspace), the same state pills,
   the same composer with the destination selector; vitals move to the Fleet view.

## Layout

Flat two-pane console — no floating cards, no gaps, one hairline between the panes.

- **Sidebar (17rem, collapsible to 3.5rem):** brand + live health line → **New task** (the primary
  fill) → search (⌘K) → *needs-you queue card (amber, only when non-empty)* → **Machines** list,
  triage-ordered (waiting → working → rest) → footer with **Fleet view**, freshness ("Updated 3s
  ago") and the theme toggle. No fabricated profile or avatar.
- **Workspace:** Hub, Thread, Booting placeholder, or Fleet.
- **Hub:** top-anchored (never vertically centred, so nothing jumps). Serif greeting → one honest
  fleet sentence built from live data → composer (repo/branch attach inside, starters below) →
  *Live now* → *Started from this browser*.
- **Thread header (one row, 56px):** state pill · task title · friendly name (mono) · vitals (mono,
  ≥lg only) · role tag · destroy (icon → armed "Confirm destroy" + cancel, 4s auto-disarm, Esc).
- **Fleet:** title + inline counts → *Waiting on you* (amber cards) → aligned table (state / task /
  machine / actions), stacked rows on mobile.

## Tokens (`src/index.css`)

shadcn's semantic contract plus a functional layer. Every value is exposed via `@theme inline` so
each usage is a real utility (`text-live`, `bg-attention/18`) — never an arbitrary `text-[var(--x)]`.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `oklch(.992 .001 286)` | `oklch(.17 .005 286)` | page |
| `--card` | white | `oklch(.205 .005 286)` | sidebar, composer, panels |
| `--foreground` | zinc-950 | `oklch(.95 .002 286)` | text |
| `--muted-foreground` | `oklch(.5 .016 286)` | `oklch(.7 .012 286)` | secondary text (≥4.5:1) |
| `--primary` | ink | near-white | the one filled action |
| `--live` | `oklch(.52 .2 262)` | `oklch(.74 .15 262)` | working, links, caret, selection, focus ring |
| `--attention` / `-text` / `-ink` | amber fill / amber text / text-on-amber | needs you |
| `--ok` | green | green | done, `$` prompt |
| `--destructive` | red | red | failed, destroy |
| `--trace` / `--trace-fg` | near-black / light | darker / light | terminal panels (dark in both themes) |

Radius base `0.5rem`; pills for state and small controls; `rounded-2xl` composer; `rounded-xl` cards.
Elevation is declared once per surface — border **or** `shadow-xs`, never both.

### `cn()` and the type scale

`lib/utils.ts` extends tailwind-merge with the custom `text-*` sizes (`micro meta body lead prose h3
h2 h1 display`). Without it, tailwind-merge classifies those as *colours* and drops a real colour class
that precedes them — the bug that made the primary button ink-on-ink. Keep the list in sync with
`@theme`.

## Type

- **Inter** 14px body / 13px meta / 11px micro. `.label` = 11px/500 sentence-case sans for section
  and role labels. No uppercase eyebrows.
- **Hedvig Letters Serif** 34px/400 for the Hub greeting only.
- **Geist Mono** via `.stamp` (11px, tabular) for ids, vitals, paths, commands, log output — data, not
  costume.
- Agent prose `.prose-agent`: 15px/1.65, 74ch measure, real GFM tables, fenced code in `CodeBlock`.

## Chat surface

- `ChatContainerRoot/Content` (use-stick-to-bottom) owns anchoring; `ScrollButton` returns you.
- `SayItem` — prose; `StreamingMarkdown` reveals only the unseen tail of the live block.
- `ToolGroup` — consecutive tools fold into "N steps · Bash · Read" with per-tool running/failed
  state; `ShellItem` is a terminal panel (`$ cmd`, folded output with line count); `StepItem` is a
  compact row with the argument in a code chip.
- `YouItem` — muted bubble, labels "Task" / "You".
- `QuestionCard` — the agent's pause as a real decision control (Claude Code / Cursor shape): one-line
  question, optional collapsible context, selectable options with number keys and ↑/↓, "Something
  else…" free text, one explicit **Send answer**. The agent writes a structured question
  (`lib/question.ts` parses it; legacy `(A)/(B)`, `1)`, `[x]` shapes still work). The sentinel file
  and the mechanism never appear in the thread — `.agent.*` tool steps are filtered out.
- `QueuedItem` — a follow-up sent while the agent was mid-turn: dashed bubble, "Queued · delivers when
  this turn finishes", cancel. The controller holds it and resumes the run the moment it ends.
- `ObserverItem` — dashed card, "Side question · answered from the sandbox, not by the agent".
- `WorkingIndicator` — three live-blue dots; label "Starting up" until the first output.
- **Composer (`SendBar`)** — one input, the agent is the primary destination and is *always*
  sendable: mid-turn messages queue ("Queue for agent", clock icon) instead of being refused. The
  secondary chip is **Side question**. `@` (or the @ button) opens `MentionMenu` — the workspace file
  list from `/files.json`, narrowed as you type, ↑/↓/Enter/Tab/Esc; mentions expand to
  `/workspace/<path>` references in the message. Dashed border in side-question mode.

## Motion (`motion/react` + CSS)

One idea — liveness — expressed consistently: `breathe` on working dots, the streaming caret, the
working dots, the `sheen` on an occupied capacity slot. Structure moves with purpose only: machine
rows `layout`-animate to their new triage position when a state flips; the needs-you card grows in
and out; panes cross-fade in 160ms; the Hub's three blocks stagger in once. Loading is a `shimmer`
skeleton shaped like the real thread. Everything collapses under `prefers-reduced-motion`.

## Instant switching

`useWatchStream` keeps the last snapshot of every box this tab has seen and reopens the SSE with
`?from=<offset>`; hovering a row prefetches. Server-side, `WatchHub` shares one tail loop per box
and answers from cache. The first paint of a thread is the cached log or a skeleton — never blank.

## Keyboard

`n` new task · `⌘K` search · `j`/`k` next/previous machine · `/` focus the composer · `g f` fleet ·
`Esc` cancels an armed destroy. The URL hash (`#/box/<name>`, `#/fleet`) is the route, so reload and
share work.

## Data honesty

`/fleet.json` (boxes + lifecycle + capacity, 3s poll with visibility pause, `/monitor.json`
fallback for older controllers), `/watch.sse` (live log, cached + resumable; poll fallback),
`/ask.json`, `/resume.json`, `/teardown.json`, `/delegate.json`, `/artifact`. Nothing on this page
is invented: no analytics, no cost, no history beyond this browser's own session storage.
