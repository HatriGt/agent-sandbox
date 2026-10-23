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

1. **`action needed` is the loudest thing on screen — and it is ink, not a hue.** Weight and motion
   carry it: a strong hairline on paper, a ping dot, and the one filled button
   (Answer / Approve). Never a tinted fill — a grey wash reads as *disabled*, the opposite of "your
   turn". The sidebar queue card, the state pill, the question and scheduled cards and the approval
   chips all follow this (`--attention` tokens). No halo: a wide near-white shadow reads as a glow
   on a dark page.
2. **Colour is for what the machine is doing.** working (live blue, breathing), done (green), failed
   (red), idle (grey), **sleeping** (violet — an idle-stopped microVM whose workspace survives; a reply
   wakes it), each with a drawn icon and a word so the meaning survives colour-blindness and sunlight.
   **Amber (`--warn`) is a fact, not a request:** a meter running high, a weak password, a PR with
   changes requested, a trial ending, an unsaved file. Used sparingly; never for "action needed".
   Everything else is ink on paper.
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

## Inspiration sources

Consult these before a UI polish pass — borrow taste and interaction patterns, never code. When the
brief is "more modern", "smoother" or "premium", start here rather than inventing from scratch.

**Component libraries and kits (settings surfaces, sheets, segmented controls, list states)**

- [skiper ui](https://skiper-ui.com) — @Gur__vi. The bouncy accordion in the app is credited to it.
- [cult ui](https://cult-ui.com) — @nolansym.
- [amicro](https://amicro.vercel.app) — @SubhanHQ.
- [bundui](https://bundui.io) — @TobyBelhome.
- [string tune](https://string-tune.fiddle.digital) — @penev_tech.
- [Emil Kowalski — design engineering skill](https://www.ui-skills.com/skills/emilkowalski/emil-design-eng)
  — the motion rules we follow: 150–250 ms ease-out, few-but-meaningful animations, real touch
  targets, respect `prefers-reduced-motion`.
- [rareui.com/components](https://www.rareui.com/components) — component gallery.
- [libraries.dev](https://libraries.dev) — index of component libraries.
- [vanta ui](https://vantaui.com) — @vanta_ui. Recreations of shipped SaaS products (Twenty, Wise,
  Dropbox, OpenAI); the reference for *how a real dashboard spaces and weights things*.
- [paceui](https://paceui.com) — shadcn/Base UI kit with an Agent Console template, light/dark pairs
  for every block, and "Crafts" (small animated interactions).
- [beste](https://ui.beste.co) — shadcn blocks and "pieces"; tonal colour, hairlines, tabular numerals,
  every motion piece declares a reduced-motion fallback.
- [great-ui](https://great-ui.com), [easyui](https://easyui.site), [obsidian ui](https://obsidianui.dev)
  — @athrix_codes — free motion-first component sets (gooey/liquid/unfold effects; use for ideas, not
  for the console's chrome).
- [dev.cards](https://dev.cards) — complete interface sections with honest local behaviour; serif +
  sans + mono mixing, square-cornered construction marks, one accent on a cream ground. The closest
  cousin to this console's "ink on paper" rule.

**Tables (the shared `ui/table.tsx` + `ui/data-table.tsx` come from these)**

- [HextaUI — Table / Data table](https://hextaui.com/docs/data-table) — MIT, shadcn API. The source of
  our table primitive: CSS-variable density (`--table-cell-px/py`, `--table-head-h`), the `surface`
  frame (rounded-xl hairline ring, tinted head), color-mix hover, sticky head with a hairline once
  scrolled, `align="end"` → tabular numerals, `h-24` empty cell, skeleton rows.
- [EasyUI — Advanced data table](https://www.easyui.site/components/advanced-data-table) — MIT. Taken:
  the empty state (icon chip, title, one action), ChevronsUpDown at 30% when unsorted, and
  asc → desc → none cycling. Not taken: its own `surface-*` tokens, bulk-action bar.
- [Orbit agent workspace](https://orbit-agent-workspace.vercel.app/) — the taste bar for density: 38px
  rows, 30px uppercase 11px header in the faintest ink, hairlines at 6% white, whole row is the
  button, hover at 2.5% white, status as dot + word (not a filled pill), ids/times in 12px mono.
- [kargulstudio/sales-crm](https://github.com/kargulstudio/sales-crm) — MIT. Taken: 38/42px head/cell
  heights, meta lines with a 1px divider, `$`-style muted unit prefixes on numbers, the 120px
  centred empty row, active row = card tint.
- Column widths: once rows paint, every column that declares a `width` is fitted to its widest
  content (header included, 56–360px; one max-content measure pass before paint) and the flexible
  column keeps at least 240px, scrolling sideways below that. Drag a header's right edge to resize
  (←/→ on the focused grip nudges 16px); widths persist per table in `localStorage asb.cols.<key>`
  (`resizeKey`, default aria-label); double-click the grip to return the column to auto.
- Runs columns follow the automation: PR/issue automations read Pull request → Repository →
  Author → Status → Verdict/What happened → Findings/Result → Comment → Took → When; alerts read
  Alert → Severity → …; schedules lead with What happened.
- Motion (index.css `dt-*`): rows rise 5px in, 26ms stagger capped at 14 rows; a sort replays a 12ms
  stagger; a row that arrives on a later poll rises and flashes live-blue once; live dots ring outward
  (box-shadow ping); loading cells shimmer; the sort icon morphs (chevrons → arrow, rotates for desc).
  A clickable row shows a 2px ink accent bar on its left edge that grows from the centre (scaleY,
  220ms) on hover, keyboard focus or selection. A search edit fades the rows that stop matching
  (180ms) and re-staggers the survivors with the sort stagger; the "n of m" count springs
  (`NumberTicker`). Polls never replay entrances. Reduced motion (`[data-motion="reduced"]`) drops
  all movement.
- `DataTable` props beyond rows/columns: `bordered` (default **true**: `rounded-xl border bg-card
  shadow-xs`, head row at muted/40, last row without a bottom hairline; skeleton rows sit in the same
  card) — pass `bordered={false}` only where the table already lives inside another surface, never
  wrap a bordered table in a Card/Panel. `search={{ placeholder, text }}` adds a toolbar above the
  card: search input (`/` focuses, Esc clears), live "n of m", and a "No rows match … · Clear search"
  row. `toolbar` puts extra controls (filter chips, buttons) at the right of that toolbar.
  `actions={(row) => …}` adds a right-aligned trailing cell that fades in on row hover/focus (always
  visible on touch); clicks inside it never open the row. Keyboard: ↑/↓ or `j`/`k` move between
  clickable rows, Enter (or Space) opens. A sorted column's header is bright ink.

**Motion and interaction detail**

- [hyperiux vault](https://vault.hyperiux.com) — @_hyperiux_. Source-first interaction effects;
  the stated rule — "if motion does not earn its place, it does not belong" — is ours too.
- [bencho](https://bencho.dev) — @cabralorenzo. Micro-interactions on ordinary controls; every
  block is live, not mocked — the standard for the visualizer cards (hover a step, pin a node).
- [kobra.systems](https://kobra.systems) — @haaarshsingh. Every state designed, light and dark;
  reference for input states and the sweep/landing timings (0.4 s sweep with ~45 ms stagger,
  spring `duration 0.3, bounce 0.2` for digits) — close to our `viz-row-new` 30 ms stagger.
- [micro](https://micro.vercel.app) — micro-motions catalogue (was 404 on 2026-10-05; re-check).

**Loaders and waiting states (what a visual fence shows while it streams — `VizSkeleton`, Working line)**

- [generativeloaders.com](https://generativeloaders.com) — `generative-loaders`: Decode, Typewriter,
  Skeleton, Cascade, Wipe, Line-by-line, Terminal, Dissolve… — text-shaped loaders for generative
  UI. Our rule stays: a value is never shown before it is complete, so of these only the
  shape-preserving ones (Skeleton, Cascade, Line by line) fit a visualizer; Decode/Typewriter
  belong to prose streaming only.
- [loading.daniasyrofi.com](https://loading.daniasyrofi.com) — @dani_asyrofi. Signal Relay, Orbit
  Status, Sweep Track, Step Trace, Retrieval Fanout, Lift Queue: small loaders that *name the kind
  of wait*. Honours reduced motion (preview goes still). Reference for the per-fence skeleton
  (`SKELETON_TITLE`) — a sequence diagram waits differently from a table.
- [metal.jakubantalik.com](https://metal.jakubantalik.com) — `metal-fx`, WebGL liquid-metal border.
  Pure eye-candy; NOT for the console chrome (one accent, ink on paper). Noted only as the bar for
  a "premium" upgrade CTA if one ever ships.

- [60fps.design](https://60fps.design) — UI animation and interaction details (the first stop for
  motion polish).
- [codedvisuals.com/visuals](https://codedvisuals.com/visuals) — coded visual effects.

**Layout, pages and galleries**

- [loadmo.re](https://loadmo.re) — bold mobile websites (the reference for the mobile app).
- [navbar.gallery](https://navbar.gallery) — navigation treatments.
- [supahero.io](https://supahero.io) — hero sections.
- [cta.gallery](https://cta.gallery) — calls to action.
- [recent.design](https://recent.design), [inspora.design](https://inspora.design) — recent visual
  design archives.
- [styles.refero.design](https://styles.refero.design) — DESIGN.md files written for AI agents.
- [posts.design](https://posts.design) — social post design.
- [cuedesign.space](https://cuedesign.space) — hand-curated Awwwards/Behance-tier component
  references with a prompt per component; the taste bar, not a source of code.
- [designbookmark.com](https://designbookmark.com) — directory of 2,500+ design tools and galleries;
  start here when a reference above goes stale.

## Layout

A framed console. The rail, the shell bar and the status bar share one tinted tone (`--sidebar`);
the content pane is a lighter sheet with a 14px top-left corner and a top and left hairline, like a
document on a desk. No floating cards inside the sheet, no gaps between panes. Phones keep the flush
pane.

- **Sidebar (17rem, collapsible to 3.5rem):** brand + live health line → **New task** (the primary
  fill) → search (⌘K) → *action-needed queue card (paper, ink hairline, only when non-empty)* → **Machines** list,
  triage-ordered (waiting → working → rest) → footer with **Fleet view**, freshness ("Updated 3s
  ago") and the theme toggle. No fabricated profile or avatar.
- **Workspace:** Hub, Thread, Booting placeholder, or Fleet.
- **Hub:** top-anchored (never vertically centred, so nothing jumps). Serif greeting → one honest
  fleet sentence built from live data → composer (repo/branch attach inside, starters below) →
  *Live now* → *Started from this browser*.
- **Thread header (one row, 56px):** state pill · task title · friendly name (mono) · vitals (mono,
  ≥lg only) · role tag · destroy (icon → armed "Confirm destroy" + cancel, 4s auto-disarm, Esc).
- **Fleet:** title + inline counts → *Waiting on you* (hairline cards) → aligned table (state / task /
  machine / actions), stacked rows on mobile.

## Tokens (`src/index.css`)

shadcn's semantic contract plus a functional layer. Every value is exposed via `@theme inline` so
each usage is a real utility (`text-live`, `bg-attention/18`) — never an arbitrary `text-[var(--x)]`.
The table shows the two base palettes, Light (`:root`) and Graphite (`.dark`). The other seven
themes override a subset of these in `:root[data-theme="…"]` blocks; see **Themes** below.

| Token | Light | Dark (Graphite) | Role |
|---|---|---|---|
| `--background` | `oklch(.992 .001 286)` | `oklch(.17 .005 286)` | page |
| `--card` | white | `oklch(.205 .005 286)` | sidebar, composer, panels |
| `--foreground` | zinc-950 | `oklch(.95 .002 286)` | text |
| `--muted-foreground` | `oklch(.5 .016 286)` | `oklch(.7 .012 286)` | secondary text (≥4.5:1) |
| `--primary` | ink | near-white | the one filled action |
| `--live` | `oklch(.52 .2 262)` | `oklch(.74 .15 262)` | working, links, caret, selection, focus ring |
| `--attention` / `-text` / `-ink` | ink / ink / paper | near-white / near-white / charcoal | action needed — hairline, the one filled button; never a tinted fill, never a halo |
| `--warn` / `-text` | amber / dark amber | amber / light amber | a fact that is off (meter high, weak password, changes requested, trial ending) |
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

## Themes (`src/lib/theme.ts`)

Nine themes, three light and six dark, chosen from the theme panel (the palette icon in the sidebar
footer and in the collapsed rail, and a row in Account → Appearance). The registry is one ordered
table, `THEMES: { id, label, scheme, description, preview }[]`; the id lands on `<html data-theme>`
and the scheme toggles the `dark` class, which every `.dark` selector (syntax tokens, `.raised`,
code blocks, Mermaid) still keys off. Token overrides live in `index.css` as `:root[data-theme="…"]`
blocks after `.dark`, so a dark theme inherits Graphite's functional hues and shadows unless it
overrides them. `preview` repeats seven tones (page, rail, card, ink, muted ink, hairline, live)
that the panel's miniatures are drawn in, and the fixture asserts the rendered page background
equals `preview.background`, so the registry and the CSS cannot drift.

| Theme | Scheme | Intent | Page / rail / card |
|---|---|---|---|
| **Light** | light | White paper, zinc ink. The original light tokens; the default light. | `.992` / `.962` / white |
| **Linen** | light | Warm paper, warm ink (hue 60–85, chroma ≤ .02). The accent stays brand indigo so state colours do not drift. | `.975 .009 80` / `.945 .012 80` / `.99 .005 85` |
| **Mist** | light | Cool grey-blue paper (hue 240, chroma .012) and slate ink (hue 250). The accent turns steel blue (`.5 .16 250`) to sit in the same family; hairlines and shadows carry the slate. | `.962 .012 240` / `.925 .016 240` / `.985 .007 240` |
| **Black** | dark | Pitch black, the default dark. The page is `oklch(.1 0 0)` (#030303), so the rail cannot sit below it; it steps *up* to `.16` and the sheet reads as a dark well in a lighter frame. Cards `.15`, popovers `.19`, borders `white/.10`. The terminal tone steps up the same way (`.16`). | `.10` / `.16` / `.15` |
| **Graphite** | dark | Charcoal, the previous dark, every value kept. | `.175` / `.125` / `.215` |
| **Midnight** | dark | Navy-indigo on the `--live` hue (262, chroma .03). Cards lean six degrees violet, hairlines carry the hue (`oklch(.78 .1 262 / .16)`), shadows are navy rather than black. | `.17 .03 262` / `.125 .028 262` / `.215 .032 268` |
| **Nord** | dark | Polar grey-blue (hue 245, chroma .02), a step lighter than Graphite so it reads as slate, not charcoal. The accent is a desaturated frost cyan (`.8 .09 215`) instead of indigo; the ring follows it. | `.225 .02 245` / `.18 .018 245` / `.265 .022 245` |
| **Forest** | dark | Deep green neutrals (hue 155, chroma .025) with moss cards. The accent is mint (`.82 .13 172`), and `--ok` leans yellow-green (`.78 .16 135`) so working and done stay two colours. | `.185 .025 155` / `.14 .022 155` / `.23 .03 152` |
| **Dusk** | dark | Warm aubergine (hue 340, chroma .03) with a rose-gold accent (`.8 .1 20`). Hairlines and shadows carry the plum; the destructive red stays darker and more saturated than the accent. | `.185 .03 340` / `.14 .028 340` / `.23 .033 345` |

The panel (`components/ThemePicker.tsx`) is a 21rem popover of theme cards in two columns, grouped
under "Light" and "Dark". Each card is a miniature of the console drawn with real DOM in the
theme's own `preview` tones: a rail strip with two working rows, the sheet with its hairline frame,
a task bubble, two text lines, a live row and the composer bar with its live caret. The active card
has a 2px `--ring` and a check. The hover-preview rule: resting the pointer on a card for 150ms
applies that theme to the whole app through `applyTheme` (DOM only, nothing stored); leaving the
panel, pressing Escape or closing it puts `readTheme()` back; a click or Enter commits through
`setTheme` and closes. Arrow keys walk the grid (left/right by one, up/down by a row) and preview as
they go, so a keyboard user sees the same try-before-you-keep. The popover has only its standard
150ms origin-aware grow-in; the theme switch itself has no transition, which some people make many
times a day. The palette keeps one "Switch to light/dark theme" command that flips scheme and lands
on the theme the user last used in that scheme (`asb-theme-light` / `asb-theme-dark`), plus a
"Theme: <name>" command per theme. The landing page's sun/moon toggle goes through the same module.

Storage and migration: `asb-theme` holds the id. On first load without it, the legacy `asb-dark`
maps `true` → Black and `false` → Light; absent, the OS preference picks Black or Light. The inline
script in `index.html` mirrors this (an id regex and a dark-id regex, plus a placeholder shell tint
per theme) so the first paint is already the right theme.

## Type

- **Inter** 14px body / 13px meta / 11px micro. `.label` = 11px/500 sentence-case sans for section
  and role labels. No uppercase eyebrows.
- **Hedvig Letters Serif** 34px/400 for the Hub greeting only.
- **Geist Mono** via `.stamp` (11px, tabular) for ids, vitals, paths, commands, log output — data, not
  costume.
- Agent prose `.prose-agent`: 15.5px/1.7, 72ch measure, 1em paragraph rhythm, lists at 0.45em, inline
  code as a quiet tinted chip (no border, 0.86em) so dense technical paragraphs read as text, not as
  a wall of boxes. Real GFM tables, fenced code in `CodeBlock`.

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
- **Composer (`SendBar`, toolbar in `composer/Toolbar.tsx`)** — one input, the agent is the primary destination and is *always*
  sendable: mid-turn messages queue ("Queue for agent", clock icon) instead of being refused. The
  secondary chip is **Side question**. `@` (or the @ button) opens `MentionMenu` — the workspace file
  list from `/files.json`, narrowed as you type, ↑/↓/Enter/Tab/Esc; mentions expand to
  `/workspace/<path>` references in the message. Dashed border in side-question mode.

## Output visualizers

Agent markdown upgrades itself (`docs/output-visualizers.md` is the contract): GFM tables become
sortable data tables (numeric alignment, magnitude bars, copy-CSV), task lists become progress
checklist cards, `json` fences a collapsible explorer, ASCII trees a real tree with file marks —
and the opt-in fences `chart` / `stats` / `flow` / `tree` (taught to the agent via
`AGENT_SYS_PROMPT`) render SVG charts, KPI tiles, and pipelines. All of it in
`components/viz/`, wired at the single `ui/markdown.tsx` chokepoint so every surface and the
streaming reveal get it. Series colors are the CVD-validated `--viz-1…8`; every card carries a raw
toggle; anything malformed falls back to a plain code block — a visualizer never loses content.

**Diagram libraries.** Graphs (```graph / ```dag / mermaid flowcharts) render on `@xyflow/react`
with a `@dagrejs/dagre` layout (`viz/GraphCanvas.tsx`); sequence diagrams and every other mermaid
kind render with `mermaid` (`viz/MermaidBlock.tsx`). Both are `import()`ed on demand — never in the
main chunk — and themed from tokens (`.asb-flow` `--xy-*` overrides in `index.css`; mermaid
`themeVariables` resolved from computed CSS vars, re-rendered when `.dark` flips). Charts stay
hand-drawn SVG. Every `VizFrame` card has a maximize button: fullscreen dialog with zoom/pan.

## Sending

The composer echoes a message the instant Enter is pressed (withdrawn only if delivery fails); the
controller kicks the run detached instead of waiting for the agent's next boundary. Every new turn
enters with the same short rise; the state pill crossfades on change.

## Launch: one screen from Send to first output

Pressing Send replaces the Hub with the thread layout in one 140ms fade (the Hub exits with no
beat, nothing slides or morphs): header with the task title and a `Starting` pill, the Task bubble
in its final spot, a thread-shaped shimmer below, an inert composer frame at the bottom. That
screen holds through delegate pending, box booting, the URL moving to `/dashboard/box/<name>` and
an empty first snapshot; only the skeleton is ever replaced, by real output.

- `BootingThread` is a static copy of `Thread`'s shell (same header geometry, `ChatContainer`
  column, `data-turn="task"` bubble, `ThreadSkeleton`). Change one, change the other.
- Neither animates on mount; the Task bubble is `noEnter` in both. Pane key stays `"launch"` for the
  launched box (App), so the URL change and the BootingThread → Thread hand-off are not pane swaps.
- Thread keeps the skeleton while the snapshot's log is empty and the run has not ended
  (`emptyLaunch`), and App backfills the task as typed when the fleet lists the box without one.
- Delegate failure: back to the Hub, text restored, error shown.
- Check: `node .shots/launch-frames.mjs [ok|fail] [reduce]` samples every 100ms and asserts the
  bubble rect never changes and no frame lacks bubble + skeleton/content.

## Motion (`motion/react` + CSS)

One idea — liveness — expressed consistently: `breathe` on working dots, the streaming caret, the
working dots, the `sheen` on an occupied capacity slot. Structure moves with purpose only: machine
rows `layout`-animate to their new triage position when a state flips; the action-needed card grows in
and out; panes cross-fade in 160ms; the Hub's three blocks stagger in once. Loading is a `shimmer`
skeleton shaped like the real thread. Everything collapses under `prefers-reduced-motion`
(`MotionConfig reducedMotion="user"` + the global CSS rule; dialogs and sheets keep a 120ms fade).

**Nothing cuts.** Every state change goes through one of the shared primitives, never a bare
conditional render:

| Change | Primitive |
|---|---|
| skeleton → content, label A → B, tab panel, view switch | `ui/swap` `Swap` (`mode="popLayout"` for anything that ticks) |
| a section/notice/sub-form appearing | `ui/collapse` `Collapse` (height auto + fade) |
| rows entering / leaving / re-sorting | `AnimatePresence initial={false}` + `motion.li|tr layout="position"` with an opacity(+height) exit |
| two icons sharing a slot (Sun↔Moon, Bell, Copy↔Check, spinner↔icon) | `ui/icon-swap` `IconSwap` (scale .6 + 2px blur crossfade, `rotate` for toggles) |
| a count that changes | `ui/number-ticker` `NumberTicker from={value}` (tabular, springs) |
| a filter radiogroup | `ui/filter-chip` `FilterChip group="…"` — the ink fill slides via `layoutId` |
| a busy button | `<Button loading>` — the leading icon crossfades to the spinner, width never shifts |
| a popover | scale .97 + 4px from its trigger side (`menuMotion(still, side)`) |
| a Radix Sheet with conditional content | keep the last draft mounted while closing — `{editing && <SheetContent/>}` kills the exit |

The interaction grammar (150ms colour/border/shadow/transform ease, 0.985 press, 0.97 on filled
buttons) lives in `@layer base` so a component's own `transition-*`/`duration-*` utilities still
win; it transitions `translate`/`scale`/`rotate` too, so Tailwind hover lifts ease rather than snap.
Elements that own their own press add `.no-press`; links styled as buttons add `.press`.

## Instant switching

`useWatchStream` keeps the last snapshot of every box this tab has seen and reopens the SSE with
`?from=<offset>`; hovering a row prefetches. Server-side, `WatchHub` shares one tail loop per box
and answers from cache. The first paint of a thread is the cached log or a skeleton — never blank.

## Routes (react-router v7, browser history)

`/` public landing (also `/dashboard/welcome`) · `/dashboard` hub · `/dashboard/box/:name` thread ·
`/dashboard/fleet` · `/dashboard/accounts`. `lib/route.ts` owns the mapping; `useGo` carries `?token=`
across every navigation; legacy `#/box/x` links redirect once. Fleet and Accounts pages and the landing
are code-split; the last fleet snapshot is cached in `sessionStorage` so the shell paints instantly.

## Machines vs capacity

The Machines list shows RUNS only. An unclaimed warm box is capacity, not a run: it appears in the
capacity strip, the "1 warm machine ready" line and the Fleet view — never as a list row. This also
makes a warm claim read as one clean transition (booting placeholder → claimed row).

## Reasoning and plans

Thinking blocks fold to "Thought for Ns" (live: "Thinking…"); `PlanBoard` renders the agent's
TodoWrite plan as a live checklist (done ✓ / in progress / todo, n/m, per-step durations), shown once
in its latest state — as a dock beside the thread on wide screens, inline otherwise. Both come from
sentinel blocks the in-box formatter writes (`⟦think⟧`, `⟦plan⟧`).

## Integrations

`/dashboard/integrations` (`/accounts` redirects): a settings page shaped like one. Each section is a
titled block with a one-line purpose and an (i) tooltip for the why; what is connected shows as compact
rows (avatar/glyph · name · facts · switch/actions); one primary **Add** button per section opens a
dialog (`ui/dialog.tsx`) whose field-level hints sit under the fields. No explanatory paragraphs.
- **GitHub accounts** — the login-keyed token store on the VPS, masked. Add by "Sign in with GitHub"
  (OAuth device flow, when `GITHUB_OAUTH_CLIENT_ID` is set) or by pasting a PAT (probed, then stored).
  Mark a default for task-only runs; remove with an armed confirm. Tokens never reach the browser.
- **MCP servers** — the tools the agent can call inside every sandbox. Add via a form (stdio / http /
  sse, command or url, env, headers) or paste the `mcpServers` JSON any agentic IDE exports. Stored on
  the VPS (`~/.agent-sandbox/mcp.json`, 600); before each run/turn the enabled servers are written into
  the box and passed to `claude --mcp-config`, with their tools allowed. Enable/disable per server;
  secret values come back masked.

## Access (interim)

`TokenGate` fronts `/dashboard/*`: paste the controller token once; it is verified, kept in
`localStorage`, and sent as a bearer header on every call. Nothing carries the token in a URL any
more — the stream is fetch-based SSE, downloads are fetch + blob. A 401 anywhere signs out. One token
is one operator. Old `?token=` links are consumed once and stripped.

## Keep (pin)

A pin in the thread header holds a sandbox: it still sleeps when quiet, but the maintainer never reaps
it — only Destroy does. Shown as a `kept` pill in the header, "kept" in the machine list and "kept ·
until destroyed" in the Fleet time-left column. Off by default; per sandbox.

## File marks

`lib/fileIcon.tsx`: a 16px neutral square with the extension in mono (TS, JS, MD, {} …) used in the
`@` menu, composer chips and the changes dock. The type is read from the letters, not a brand colour,
so a dock of changed files stays on the console's palette. Editor chrome (tabs, file tree) keeps the
coloured VS Code icon theme through `lib/vscodeIcons` directly, where a coloured mark is the
convention the reader expects.

## Resilience

`ErrorBoundary` wraps the console: a render error shows the message with Try again / Reload instead
of a blank page. `api.parse` treats a non-JSON 200 (index.html during a deploy) as an error, and the
fleet response is shape-checked, so a transient bad response cannot crash a `useMemo`.

## Composer context

Picking a file from the `@` menu turns it into a removable **chip** above the text (Cursor's context
pills), not an `@path` token in the prose; the message carries the files as explicit `/workspace`
references.

## Repositories

Runs get repositories three ways: the Hub composer's **Attach repos** picker (multi-select from the
connected accounts' repos, per-repo branch), **auto-attach** when the task names a known repo
("elseco deal service" → `atom-insurance/elseco-deal-service`, exact name match only), and the thread's
**Connected** strip with **Add repo**, which clones into the running sandbox at `/workspace/<name>` with
the account that can access it and tells the agent at its next turn. `@` mentions search those repos.

## Changes and the file pane

`ChangesPanel` folds what the agent changed — "N files changed · +adds −dels", each file with a
language monogram (`lib/fileIcon.tsx`), path and its own counts; new/deleted/renamed marked. Clicking
a file opens `FilePane`, a VS Code-style side panel (46% on desktop, full-screen overlay on phones)
with **Diff** (two-gutter unified diff from `git diff HEAD`, hunk headers, tinted rows; new files as
all-added) and **File** (shiki-highlighted content, markdown rendered) tabs, plus download. Data:
`/changes.json` (git numstat + untracked + loose files), `/diff.json`, `/artifact`.

## Result cards

A Bash step whose output is a test run (vitest/jest, node:test, pytest, go test) renders as a
`TestResultsCard` — passed/failed/skipped chips, duration, per-file cases with timing, raw output one
click away; groups containing one open by default. PRs the run opened surface in the
`PullRequestFloat` (state glyph, `#142 Title`, `repo · head → base · +/- · files`; metadata via
`/pr.json` through a connected account). Answering a question hides the card at once and shows "Answer sent — resuming".

## Keyboard

`n` new task · `⌘K` search · `j`/`k` next/previous machine · `/` focus the composer · `g f` fleet · `g a` integrations ·
`Esc` cancels an armed destroy. The URL hash (`#/box/<name>`, `#/fleet`) is the route, so reload and
share work.

## Data honesty

`/fleet.json` (boxes + lifecycle + capacity, 3s poll with visibility pause, `/monitor.json`
fallback for older controllers), `/watch.sse` (live log, cached + resumable; poll fallback),
`/ask.json`, `/resume.json`, `/teardown.json`, `/delegate.json`, `/artifact`. Nothing on this page
is invented: no analytics, no cost, no history beyond this browser's own session storage.

## Round: transcript navigation, changes dock, integrations table (2026-08-27)

- **Conversation minimap** (`thread/ThreadMinimap.tsx`): a rail of ticks, one per turn you sent
  (task, follow-ups, answered questions), positioned proportionally in the scroller. Hover = preview
  card (your message + how the agent began its reply); click = smooth jump. Active tick tracks scroll.
- **Answered questions stay in the transcript**: `agentSh` stamps `⟦ask⟧…⟦/ask⟧` right before the
  `⟦you⟧` answer, so the parser can fold them into one `AnsweredQuestionItem` — the question, every
  option, the one you chose highlighted (or your free-text answer).
- **Changes dock** (`thread/ChangesDock.tsx`): the changed-files summary lives above the composer, not
  in the conversation — a collapsed bar (monogram stack · N files · +/−) that expands upward into the
  list; click a file to open the pane. Per-write tool rows stay in the thread.
- **Integrations** is a settings surface: one search field (`/` focuses it) filtering both tables,
  sticky sub-nav with counts, filter chips for servers (All/On/Off/stdio/Remote), brand tiles from
  `simple-icons` (`lib/brandIcon.tsx`, transport glyph fallback), inline edit/rename dialog.
- **Sleep TTL is visible**: `/fleet.json` exposes `asleepSec` + `lifecycle.sleepTtlSec`; sleeping
  rows say "gone in 20m" / "destroyed in 20m", kept rows say "kept"; Fleet has "Destroy N sleeping".
- **No stale shells**: `index.html` is `no-store`, hashed assets immutable; router `errorElement`
  renders the same recovery screen as the ErrorBoundary.

## Round: quiet work lines, link chips, PR column (2026-08-27)

- **Tool groups** are a disclosure line, not a pill: `› Worked · 4 steps · 2 files · 1 command`
  (live: `Working · 2/4 steps` with a breathing dot). Open → numbered timeline. Prose stays prose.
- **Links** in agent prose render as chips (`ui/link-chip.tsx`): icon for what they point at —
  PR (`queue-service#142`), issue, commit, file, repo, or `host/first-segment…` — plus an arrow.
  Author-given link text is kept.
- **Pull request** lives in its own right-hand column (`thread/PullRequestPanel.tsx`) on xl+
  screens: tinted state header (#, repo, link out), title, Branch / Changes / Author rows. Narrower
  screens keep the in-flow card. The transcript itself only carries the link chip.
- **No horizontal scroll**: inline `code` in prose wraps (`overflow-wrap: anywhere`) — a 3000px
  path in a backtick span was widening the whole thread — shell commands wrap, and the chat
  scroller clips x-overflow as a backstop.

## Round: one column, floating PR (2026-08-27)

- **One column.** Conversation, changes dock and composer are one flex column sharing `max-w-3xl`
  and the same inner gutter, with the file pane as a sibling — nothing beside the thread can shift
  the composer away from the text again. The scroll-to-latest button is our own (`stick.isAtBottom`),
  centred over the column, never stuck at the top.
- **Pull request is a floating chip** (`thread/PullRequestFloat.tsx`), top-right of the thread:
  `#142 · ready to merge`. Click → card modelled on the reference: verdict header (Ready to merge /
  Checks failing / Changes requested / Merge conflicts / Merged / Draft) with `#n · N checks`, a
  globe link and a **Merge** button (two-click; runs `gh pr merge --merge` inside the sandbox via
  `/pr/merge.json`), then Review (decision + reviewers with avatars), Committed (files, +/−, branch,
  author) and Checks. `/pr.json` now carries mergeable, reviews and check-run rollups.
- Header: no `0s` countdown (reads "soon"); the role pill hides when a box is kept.
- Composer hint is one clause: `Enter to send · @ to mention a file`.

## Round: wake on open, workspace explorer (2026-08-27)

- **Opening a sleeping thread wakes it** (`POST /wake.json` → `msb start`, hub cache dropped). The
  old "this machine is asleep, type to wake it" card is a **WakingCard**: pixel-grid wave, elapsed
  seconds, three stages (boot → restore → reconnect) that tick off; it says "Awake" and leaves once
  the box reports running. The composer says "Type ahead — sends once the sandbox is awake".
- **Workspace pane** (`thread/WorkspacePane.tsx`, header folder-tree button or any file in the
  changes dock): VS Code-shaped — collapsible tree (repos as roots with a branch glyph, folders with
  change counts, files with marks and +/−, "Go to file" filter), tab strip of open files, and per
  file **Diff / File / Edit**. Edit is `CodeEditor` (the JSON editor generalised: gutter, shiki,
  caret line); ⌘S / Save writes back via `PUT /file.json` (base64, path-confined, 2 MB cap) and
  refreshes the change list. `GET /tree.json` is the @-mention index without the 40-match limit.
- Inspiration taken from beautifului.dev: pixel-grid loading state with elapsed time, task-row
  status language, tabbed file/diff panel.

## Round: the workspace as an editor (2026-08-27)

- **Icon theme** (`lib/vscodeIcons.tsx`): brand glyphs from simple-icons in their conventional
  colours for ~70 languages/tools, name-aware specials (package.json → npm, tsconfig, Dockerfile,
  .env, README, LICENSE, CHANGELOG, lockfiles, CI workflows, *.test.*), and folders coloured by
  role (src blue, test green, docs purple, public yellow, components pink, config orange…). `FileMark`
  now delegates to it, so chips, the dock and mentions all upgraded at once.
- **WorkspacePane** is laid out like VS Code: activity bar (Explorer · Go to file · Source Control
  with a change badge · close), sidebar view, editor group with tabs + breadcrumbs + Diff/File/Edit,
  status bar (branch with ↑↓, changes, files, language, mode). Tree rows have indent guides, repo
  roots show their branch, folders show the count of changes inside, changed files carry VS Code's
  M/A/D/U/R letters.
- **Source Control** (`POST /git.json`, `src/git-ops.ts`): branch strip with ahead/behind and a
  Push button, commit message (⌘Enter) + "Commit N files" (git add -A && commit as the box's
  identity), changes list with +/− and status letters (click → diff), last commit and push output.
- Reference patterns from beautifului.dev applied here: task-row status letters, tabbed code/diff
  panel, sidebar nav with a gliding active indicator.

## Round: images to the agent, quieter chrome (2026-08-27)

- **Image attachments** in the composer: paste, drop, or pick (image button). Thumbnails with remove
  sit above the text; on send each image is uploaded into the sandbox (`/workspace/.attachments/…`
  via `PUT /file.json` with `encoding: base64`) and the message ends with "Attached image (open with
  the Read tool): - /workspace/.attachments/…" so Claude Code views it with its Read tool. The You
  bubble shows the pictures (fetched through `/artifact`) instead of the paths. Attachments are
  excluded from the change list.
- **Chrome audit fixes**: header vitals fold into one `up · cpu · mem` group (role pill dropped — the
  state pill says it); the empty "No repository attached" strip is gone (an Attach-repo icon in the
  header instead); Thought rows share the Worked line's shape; a shell panel's output preview sits
  inside the panel as a footer row instead of floating below it; the changes dock drops its duplicate
  icon; the composer hint is one line; the workspace pane is resizable (drag its edge) and no longer
  repeats the file/changes count twice.

## Round: design audit + image viewer (2026-08-27)

Audit against live screenshots. Fixed:
- Raw dumps (diffs, `cat -n` listings, here-docs) the formatter attributed to the agent were rendered
  as markdown bullets → detected by shape (`looksLikeDump`) and shown as a folded "Raw output · N lines".
- "Session started" re-logged on every follow-up turn → only the first is shown.
- "stops in ~0s if it stays quiet" / "0s if quiet" → "going to sleep any moment" / "soon".
- PR chip floated over conversation text → it lives in the header with the other status chips; the
  card drops down from it.
- Hub "Live now" listed the warm pool box as a run ("idle · No task yet") while the sidebar hid it →
  excluded; the footer line already says a warm machine is ready.
- Fleet header was a three-line paragraph → one line of facts.
- **Lightbox** (`ui/lightbox.tsx`): click any image — a composer thumbnail or a picture in the
  conversation — for an in-page viewer: fit/actual toggle, − % + zoom, scroll-to-zoom around the
  cursor, drag to pan, double-click to toggle, download, Esc/backdrop to close.

## Typography system (audit, 2026-08-27)

One scale, used everywhere — `micro 11 · meta 13 · body 14 · lead 15 · prose 15 · code 12.5 · h3 16 ·
h2 20 · h1 28` (all registered with tailwind-merge). Rules the audit enforced:
- **Conversation reads at one size.** Agent prose and the operator's bubbles are both 15px; the
  composer stays UI-size (14).
- **Mono is for data, never sentences.** Ids, paths, durations, counts, commands → `.stamp`/mono.
  Words ("going to sleep any moment", "if quiet", "kept · wakes on reply") → sans `text-micro`.
- **One code size** (`text-code`, 12.5px) for shell panels, raw output, diffs, the editor and
  fenced blocks — they were 11 / 12.5 / 13.5 before.
- **One chip anatomy in the header**: h-6, `text-micro` semibold, rounded-full (state · kept · PR).
- **Titles are sans** in the app (`text-h1` semibold, −0.02em). Serif is the landing page's voice only.
- **Section headings**: page `h1` → section `text-h3` semibold → sub-section `text-body` semibold.
- Primitives (tooltip, badge, card, avatar, textarea) use the tokens, not Tailwind's `text-xs/sm/base`.

## Round: titles, autosave, quieter waking (2026-08-28)

- **Run titles**: the in-box side-chat helper names each run from its first message (3–6 words),
  stored on the VPS (`~/.agent-sandbox/titles/<box>`), carried by `/fleet.json` as `title`, used
  by the sidebar, Fleet, header, palette and notifications. Generated in the background after a
  delegate; a thread with a task and no title asks once via `POST /title.json`. Sleeping boxes are
  never woken for a name.
- **Workspace editing is direct**: a file opens in the editor; typing autosaves ~0.9s after the last
  keystroke (and when you leave the tab); ⌘S saves now. "Diff ⇄ File" toggle only for changed files.
  No Save button, no separate Edit mode — the status bar and a small "saving…/unsaved/saved" mark
  carry the state.
- **Waking line**: no card, no tint. A 4×4 monochrome pixel wave, "Waking the sandbox · 4s", and one
  crossfading status line (boot → restore → reconnect), in the transcript's own voice.

## Round: workspace like T3 Code, full view (2026-08-28)

- **Arrangement**: tab strip across the top with the window controls at its right (full view ·
  files panel · close); editor group on the left with breadcrumbs; the **files panel on the right**
  with a "Search files" field above the tree and a Files ⇄ Changes toggle (the change count as a
  badge). No activity bar. Typing in the search replaces the tree with ranked results; picking one
  opens it and clears the search.
- **Full view**: the ⤢ control collapses the conversation column so the workspace takes the whole
  width beside the sidebar; ⤡ brings the conversation back. Closing the pane resets it.

## Round: a real editor (2026-08-28)

- **CodeMirror 6** replaces the textarea-with-overlay editor (`components/CodeEditor.tsx`): one
  scroller (no more double scrollbars), native selection and undo, ⌘F search panel, bracket matching,
  fold gutter, indent-aware Enter, Tab indents. Themed from the console's tokens (Geist Mono at
  `--text-code`, muted gutters, live-blue selection) with GitHub-hued syntax colours matching the
  shiki blocks in the transcript. Languages: TS/JS/TSX, JSON, Markdown, Python, CSS, HTML, YAML, shell.
- **Diffs are a merge view** (`@codemirror/merge`): `/diff.json` now returns the HEAD text, so a
  changed file renders as a unified merge of HEAD vs working copy with changed-text highlights and
  collapsed unchanged regions. The line-based DiffView remains the fallback for untracked files.
- **Breadcrumb**: folders in muted, the file in foreground with its icon; folders truncate first and
  the middle collapses to "…" beyond four levels; the file name always survives.
- Editor code ships as its own chunk (`editor-*.js`, ~226 KB gzip), loaded only when the pane opens.

## Round: first paint and small frictions (2026-08-28)

- **The blank second**: the main bundle was 5.6 MB because `import * as si from "simple-icons"`
  shipped the entire icon library. Named imports cut it to ~580 KB. The workspace pane (CodeMirror,
  merge view) is lazy — loaded the first time it opens, never preloaded on the thread.
- **A shell before the bundle**: `index.html` carries an inline theme script (dark class before
  first paint, no light flash) and a static app-shell skeleton (sidebar, header, column placeholders)
  that the app replaces on mount. The first frame is the layout, never white.
- Workspace opens straight into the most useful file (first change → README → first root file);
  the scroll-to-latest button sits bottom-right of the column instead of over the text.

## Round: motion pass (2026-08-28)

- Interaction grammar in CSS: every control eases colour/border/shadow in 150 ms with a soft press
  (`scale(0.985)`); `.no-press` opts out where a transform would fight another one.
- Workspace pane glides open/closed (width animates 0 ↔ 58% ↔ 100%) instead of snapping; the active
  editor tab's background slides between tabs (`layoutId`).
- Tool rows enter with the same motion as prose; the send button dims when empty and lifts on hover.
- Minimap: 40 px hit area, a faint rail appears when the pointer is near, hidden below 1120 px.
- Sidebar rows: state and role words share a baseline. Breadcrumb folders appear only when the
  header is wide enough to show them whole (container queries), never as chopped fragments.

## Round: Refactoring UI systems pass (2026-08-28)

Applied the book's "design from a scale" rules mechanically across the console:
- **Elevation scale** `shadow-e1…e5` (raised control · dropdown · popover · floating panel · modal),
  alpha in `--shade-*` so dark mode deepens it. Replaced 38 hand-typed shadows.
- **Fixed opacity scale** 5 · 10 · 20 · 40 · 60 · 80 — 162 ad-hoc alphas (`/12`, `/15`, `/18`, `/25`,
  `/30`, `/35`, `/45`, `/70`, `/85`, `/90`, `/95`) snapped to it.
- **Three text colours** — `foreground`, `muted-foreground`, and a new `faint` (tertiary, still
  ≥4.5:1) — replacing pseudo-tiers like `text-muted-foreground/60` and `text-foreground/85`.
- **Three radii** — `md` for controls and chips, `xl` for containers, `full` for pills. `lg`, `2xl`
  and `3xl` are gone (60 replacements).
- **Fewer boxes**: link chips, the changes dock and the answered-question card lean on tint and
  elevation instead of a 1px outline (the book's "busy, boxed-in" fix).

## Refactoring UI, deeper pass (2026-08-28)

Hierarchy and depth rather than tokens this time. Each item is a rule from the book, applied once.

- **One deliberate accent.** The active thread in the sidebar and the active nav item carry a 2px live-blue edge (`before:` bar), not just a grey fill. Everything else stays grey, so the edge is the only coloured thing in the rail.
- **One primary per page.** Integrations: MCP "Add" is the primary; "Add account" is now outline. Fleet: "Destroy N sleeping" is a ghost/tertiary control until armed, then destructive — the big red button belongs to the confirmation step, not the page.
- **Labels are a last resort.** The "● Agent" label only appears where the speaker changes (after you, after a question, at the start) or while the agent is live. Consecutive agent blocks read as one voice.
- **Tertiary actions look like links.** Hub starter prompts lost their pill borders; five equal outlined chips read as five secondary actions competing with the composer.
- **Empty states are designed.** Hub with nothing running shows a small circled icon, a headline and one line of guidance instead of an absent section.
- **Depth from light.** `.raised` = lit top edge (`inset 0 1px 0 white/6%`, dark only) + `--shadow-e1`. Used on the composer and the changes dock — the two surfaces that sit above the thread.

## Features round (2026-08-28, with Refactoring UI)

New things a user can do, each placed where the need arises rather than added to the chrome.

- **Run summary.** A finished thread ends with one line that reads like a sentence — "Completed · 6 steps · 3 files · 2 commands" — followed by two tertiary actions: **Copy transcript** (Markdown, tool work folded into `<details>`) and **New task from this** (hands the task to the Hub; opens the repo picker if the run had repositories). Labels folded into values; no spec sheet.
- **Command palette actions.** ⌘K now also runs Fleet view, Integrations, theme switch and the shortcuts list, under a quiet "Actions" label below machine matches. Typing filters both.
- **Keyboard shortcuts overlay.** `?` anywhere. Three groups (Go, Thread, Anywhere); keys as small `kbd` chips on the right so the eye scans descriptions.
- **Grouped sidebar.** Machines carry faint group labels (Action needed · Working · Done · Sleeping · Warm) only when the list spans more than one group — more space around a group than within it.
- **Drafts survive.** Unsent Hub and follow-up text lives in sessionStorage per machine; a reload or a detour to another thread does not lose it.
- **Last activity.** Hub "Live now" rows show "active 2m ago" / "2m ago" in the tertiary colour before the machine name.
- **Header vitals demoted** to the tertiary text colour — uptime/cpu/memory were competing with the title.

## Thread masthead redesign (2026-08-28)

Was: a 56 px header (two state pills, title, machine, PR chip, orange "soon", cpu/mem telemetry, three icon buttons with Destroy beside Keep) plus a 36 px "Connected · repo · Add repo" bar — 92 px of chrome, the title third in reading order, "kept" shown twice.

Now: one block, two lines (~64 px), one border.

- **Line 1 — identity + controls.** The title is the only bold element (16 px semibold; click to rename, saved via `/rename.json`). Two controls: **Files** and a **⋯ menu** with Keep/Release (state shown as a hint), Rename, Attach a repository, Copy link, Copy transcript, New task from this, and — separated — *Destroy machine…* which opens a confirm dialog where the red button is the primary action.
- **Line 2 — context as a sentence** in the secondary colour: `✓ done · teal-otter · [queue-service @main] + · #142 ready to merge`, and on the right the lifecycle in words (`sleeps in 12m`, `destroyed in 20m`, `41m left of cap`) instead of an orange "soon". While running, a live-blue tail says what the agent is doing (`Edit retry.ts`, `Bash`, `writing`, `thinking`).
- **Kept** is shown once: a small pin glyph before the machine name, plus the menu hint.
- **Telemetry** (uptime · cpu · memory · role) moved into the machine name's tooltip; Fleet view keeps it first-class.
- The repo bar is gone; repos are chips in the context line with a quiet `+`.
- **Run again** (was "New task from this"): the brief *and* the repositories carry over — the Hub resolves each checkout name to `owner/name` across your accounts and pre-attaches it; anything ambiguous opens the picker instead. Menu hint says what it does: *new machine, same brief*.
- **When.** The context line's tail now answers it: `finished 14m ago`, `asked 3m ago`, `asleep 2h` — before the lifecycle phrase.

## Round: a calm composer (2026-09-30)

Was: the Hub action row carried eight controls (Attach repos · agent · model · budget · harness ·
attempts · verify · image · voice) and wrapped onto a second line at 1280px; the thread composer had a
two-way destination switch plus a model chip. Every option advertised itself whether or not it mattered.

Now, following the design-eng rules we borrow from (one primary, progressive disclosure, defaults are
invisible):

- **One text area, one Settings control** (`thread/RunSettings.tsx`). The action row is `Repos ·
  Settings … image · voice · send` on the Hub and `Side question · @ · image · voice · Settings … send`
  on a thread. Nothing wraps at 390px.
- **Settings is a popover** above/below the trigger on a desk (`side`), a **bottom sheet** on a phone
  (`ui/sheet.tsx` gained `side="bottom"`). Inside: rows and sections, no cards. **Harness first** — the
  one pick that sets everything else — with built-ins ahead of yours and unreviewed imports disabled;
  then **Model** as a row that unfolds a radio list (search appears past six); then **More** for Agent,
  Attempts (1/2/3) and Verify. "More" opens itself when something inside it is already set, and a
  **Reset to defaults** link appears only when something is.
- **Only non-defaults show**, as removable chips above the text (`RunOptionChips`): harness, model,
  agent, "2 attempts", "Verify · npm test". Click a chip to open the panel, × to reset that option. A
  quiet composer means defaults.
- **Budget is gone from the composer** (the controller side is removed separately).
- **Side question** is a single toggle (pressed = side helper), not a two-chip radio: the dashed border
  and the caption already say which lane is live, and the send button's clock says "queued".
- Keyboard: ⌘. opens Settings; ↑/↓/Home/End move through harness and model rows, Enter/Space picks,
  Esc closes and returns focus to the trigger. Reduced motion drops the scale/slide and keeps the fade.
- Amber check: Haiku's tier dot was amber — now grey. Fleet's "soon" time-left was amber — now the
  foreground colour, and it says what happens ("sleeps any moment", "destroyed any moment").

Audit fixes from the same pass (screenshots in `.shots/out/`): the thread header's repo chip clipped
mid-glyph ("orders-api @") behind a hidden horizontal scroller — chips now shrink and ellipsise the
branch; the MCP step header duplicated the folded footer's summary and overlapped the step's duration
column on phones — header shows the check only below `sm`; History showed a shimmering totals strip
forever next to a "Could not load" error — hidden on error; composer and question-card captions
truncated mid-sentence at 390px — shorter copy, two lines on a phone.

## Round: the composer, round two (2026-09-30)

What was wrong with the calm-composer round: it was calm by hiding things. Harness, model, agent,
attempts and verify all sat behind one "Settings" popover, so the model you were about to run was
invisible until you opened it, every change cost three or four clicks (Settings → Model row →
unfold → pick), and the panel nested collapsibles inside a popover. Worse, the Hub had no skill
picking at all: the `/` menu was wired only into the thread's `SendBar`.

Now, with Claude.ai, ChatGPT, Cursor, v0 and T3 Chat as the target shape:

- **One big rounded surface, text first; context inside the box.** Chips for the skill, repositories
  (with their branch input), harness, agent, "2 attempts" and "Verify · …" sit under the text and
  above the toolbar (Claude.ai / Cursor context pills). Image thumbnails stay above the text
  (ChatGPT). The model is never a chip: the Model button always names it.
- **A quiet bottom toolbar, shared** (`components/composer/Toolbar.tsx`, used by Hub and SendBar):
  `+` (repository or image on the Hub; image only in a thread, where it acts directly) · `/ Skills` ·
  `@` (thread only) · Side question (thread only) · **Harness ▾** (reads its name once picked) ·
  **Model ▾** with a short label ("Sonnet 4.5", tier dot) · `⋯` for agent, attempts and verify ·
  voice and a filled round send on the right. Every option is one click to open, one to pick.
- **Icon + label on a desk, icon only below `sm`**; the left cluster shrinks and the row never wraps
  (checked at 390px and 1280px, both themes — `.shots/composer-shots.mjs`). Buttons are 32px pills
  with a 0.97 press scale (dropped under reduced motion); a small **live-blue** dot marks a menu with
  something set inside. Amber stays reserved for action-needed.
- **Menus are popovers on a desk, bottom sheets on a phone** (the v0 / T3 Chat mobile pattern); rows,
  not cards; focus lands inside, ↑/↓/Home/End move, Enter/Space picks, Esc closes and returns focus.
  The Hub's menus grow downward (the composer is near the top), the thread's upward.
- **⌘. opens the Model menu** (it used to open Settings).
- **Skills on the Hub.** Typing `/` or pressing Skills lists enabled skills; a pick becomes the
  `SkillChip`, and the task is sent exactly as a thread follow-up is — the skill as the leading
  `/name` token of the text (`/${name} ${task}`), which the agent is instructed to invoke. A
  hand-typed `/name ` converts to the chip too. With no enabled skills, both the `/` menu and the
  Skills button show an empty state linking to the Skills page.
- `RunSettings.tsx` is now only primitives (harness/model lists, verify row, chips); the popover and
  its "More" collapsible are deleted.

Borrowed, and from where: the composer shape and in-box context chips from Claude.ai, ChatGPT and
Cursor; the short model name in a toolbar dropdown from T3 Chat and v0; `+` as the single attach entry
from ChatGPT; the motion rules (150–200 ms ease-out, origin-aware popovers that scale from the
trigger, 0.97 press, reduced motion keeps the fade) from Emil Kowalski's design-engineering notes as
already recorded above. The inspiration sites themselves could not be fetched this round (the fetch
tool errored or was rate-limited / forbidden on skiper-ui, cult-ui, rareui, 60fps and ui-skills), so
no new detail was taken from them beyond what this file already records.
## Round: motion pass 2 (2026-09-30)

- **New task to box.** On send, the Hub records the composer textarea's rect (`recordLaunchOrigin`, `lib/launchMorph.ts`); the booting thread's Task bubble FLIPs from that rect to its own (spring, transform + opacity, one-shot, dropped if older than 2 s). `layoutId` cannot bridge the pane swap because `AnimatePresence mode="wait"` unmounts the Hub first. The BootingThread pill, title and working steps stagger in 50 ms apart.
- **Pane switches** (`App.tsx`): 200 ms in / 160 ms out, 6px rise. On phones the direction follows depth (hub, page, box): going deeper enters from the right, going back from the left.
- **Sidebar rows** (`MachineList.tsx`): rows rise and scale in from 0.98; the state word crossfades with a 3px lift when the state changes. The waiting-queue banner springs in.
- **Thread**: turns rise in (`Rise`), tool groups animate their height when folding (`ToolGroup`), and the outcome card (`.card-spring`) and question card enter on a small spring.
- **Lists**: Fleet table rows stagger on first paint (30 ms apart, capped at 12). History rows stagger by page, and the totals (runs, verified %, tokens, cost) tick.
- **Overlays**: menus scale from the Radix trigger origin on a slight-overshoot curve (200 ms in, 120 ms out). Sheets slide in over 240 ms on a drawer curve.
- **Press**: primary/default buttons press to 0.97; everything else keeps the global 0.985.
- **Reduced motion**: `<MotionConfig reducedMotion="user">` in `main.tsx` turns off transform and layout animations app-wide, and the components that animate check `useReducedMotion` and fall back to opacity-only or instant changes.

## Run-end pill, not cards (2026-09-30)

- A finished run ends with ONE pill (`thread/RunPill.tsx`, `[data-run-pill="done|failed"]`), replacing the outcome card and the digest card in the thread: rounded-full, `text-micro`, muted, single line, left-aligned with agent prose. Example: `● Done · PR #142 · 3 files +40 −12 · tests 48/48 ✓ · 2m 14s · 121k tokens ▸`.
- Dot: green done, red failed. Amber never appears here (it means action-needed).
- Collapsed by default. Click/Enter opens, via `Collapse` (height + fade; plain fade under reduced motion), a borderless key-value list (`[data-run-pill-details]`): summary, started by, driver, model, PR links, diff, tests, verify, exit code, failed commands, questions, sandbox blocks, duration, tokens, cost, followed by, follow-ups.
- Only recorded facts. Unknown or empty rows are dropped: no "—", no "$ —", no "no questions asked", no "exit 0" when tests or verify already speak. A digest headline that just says "done" is dropped so the state is said once.
- The pill also absorbs `RunSummary`: its steps/commands go in a "work" row, its exit-code note in "note", and Copy transcript / Run again are the last row of the details (`[data-run-pill-actions]`). Nothing else renders at run end.
- History keeps `OutcomeCard`/`DigestCard`; the data (`/history/outcome.json`, `/digest.json`) is unchanged.

## Round: two-row chrome (2026-10-22)

Was: four rows above the conversation. A 44px top bar (sidebar toggle, breadcrumb trail, search,
working/need-you pill), a 36px tab strip, then a two-line masthead (state pill, title, Stop, Files,
Inspector, Side chat, Chat/Trace, ⋯ on line one; machine name, vitals, every repo chip, PR, Started,
elapsed, agent, lifecycle, size on line two). 160px at 1440x900, measured from the viewport top to the
masthead's bottom edge. The second masthead line repeated what the sidebar, the status bar and the
trace already say, every run, whether or not anyone was asking.

Now: two rows, 88px at 1440x900 (shell bar 40 + masthead 48; 92px on a 390 phone, where the phone
bar is 44).

- **One shell bar** (`ShellTabs.tsx` → `ShellBar`, `TopBar.tsx` folded in). h-10, `bg-sidebar`, md+.
  `[sidebar toggle] [Home] [open tabs, scroll sideways] … [⌘K search, w-56] [working · need-you]`. Tab
  routes (box, PR, automation runs) no longer draw a breadcrumb trail because the active tab is the
  breadcrumb. A route that is neither a tab nor the hub (History, Admin, a repo) renders its crumbs as
  one non-closable **page tab** after Home: parents muted and clickable, the last crumb in the
  foreground colour, chevrons between, the same `layoutId` underline. `crumbs` in `App.tsx` stays the
  single data source; the bar only decides whether to show it (`pageTab = !homeActive && !activeKey`).
  Alt+W / Alt+[ / Alt+], middle-click close, live and attention dots, `gone` dimming and the
  NumberTicker are unchanged.
- **One masthead line** (`thread/ThreadHeader.tsx`). h-12, px-5 on a desk:
  `[← phones] [state pill] [title, takes the slack, floor 12rem at lg] [PR · clock at xl, first repo
  +N from 2xl] [Details] [Stop · Files · Inspector · Side chat · Chat/Trace · ⋯]`. The title is the
  identity, so it is the only thing that shrinks. The cluster never shrinks; a chip that ellipsises to
  "ord" is worse than no chip, so each piece has a breakpoint where it fits whole. The arithmetic at
  1280 (1008px inside the padding): pill 121 + title floor 192 + controls 383 + gaps 32 leaves 280,
  enough for PR + clock but not the repo chip as well. At 1536 the branch chip joins. Below xl the
  cluster is gone and Details is the only place for meta.
- **"Working · Writing"**: the live activity moved into the state pill's label at xl+ (`Swap`,
  `max-w-[28ch] truncate`, full text in the pill's tooltip; `thread/live-activity.ts` reads the tail
  of the trace). Below xl the pill says "Working". The agent's current step was the one thing on the
  old second line worth keeping in view, and it belongs to the state, not to the metadata.
- **Details** is an `Info` icon button (tooltip "Details — machine, repositories, timing", Tab
  reachable, Esc closes). A popover on a desk (`ui/popover.tsx`, new, same elevation and motion as
  `ui/dropdown-menu.tsx`: `shadow-e3`, zoom-in-95 over 150ms), a bottom Sheet on a phone where the
  trigger lives in the ⋯ menu's first row. Inside, top to bottom: machine friendly name with the kept
  pin, the mono short id (click copies, IconSwap Copy→Check), the vitals line (up · cpu · memory ·
  disk · role), then a `dl` of Repos (every chip, "Attach another" opens the same RepoPicker as the ⋯
  menu), PR, Started HH:MM with the live elapsed, Agent with harness or playbook, Lifecycle (last
  action or finished, and the deadline), Size (memory and disk tiers, read-only, "resize from ⋯").
- **Inspector and Side chat are icon-only** at every width (tooltips and aria-labels carry the names).
  Stop, Files and Chat/Trace keep their labels from sm; Files folds into ⋯ below md. A deadline under
  five minutes stays inline next to the controls in the attention colour, because that one is urgent.
- Motion: nothing cuts. The pill's activity swaps through `Swap`, the id chip's icon through
  `IconSwap`, the popover zooms from its trigger, the title still crossfades into the rename input.

Rule: chrome shows identity and state; everything else waits in Details. A second line is not a place
to park facts.

## Round: tables you can shape (2026-10-22)

Scope: chat visualizer tables (viz/DataTable) and the page-level table (ui/data-table) now share one width model in `web/src/lib/column-widths.ts`.

### One width model
- `useColumnWidths(storeKey, ready, signature)` owns three layers per column: **floor** (header label + icon, measured once on first paint, never crossed), **fit** (widest cell, clamped 56..360, measured in one synchronous max-content relayout before paint) and **manual** (px the user set). `width(id)` = manual ?? fit, never under floor. `shaped` is true once any manual width exists.
- `columnGrip(id, label, cols)` returns the props for the grip span: `role=separator`, `aria-orientation=vertical`, `aria-label="Resize <label>"`, `aria-valuenow`/`aria-valuemin`, `tabIndex=0`, drag, ←/→ nudge 16px, double-click reset. Styling stays in `.dt-resize` (index.css): hairline on header-row hover, accent line while dragged or focused, `col-resize` cursor document-wide during a drag.
- Persistence: `localStorage["asb.cols.<key>"]`. Page tables use their own id. Viz tables use `viz:<shapeKey>` where `shapeKey` is an FNV-1a hash of the frame title plus the header texts, so the same table shape in a later turn keeps its widths and a different table does not inherit them.

### Two layout modes, no fighting
- **Unshaped** (default): `table-layout: auto`, `width: 100%`, cells `nowrap`. The browser fits to content; wide tables scroll inside the frame. Nothing is stored.
- **Shaped** (after the first drag or nudge): the hook snapshots every column's rendered width first, then the table switches to `table-layout: fixed` with px `<col>`s and a trailing flex `<col>` that absorbs the slack. Text cells wrap (`overflow-wrap: anywhere`). `min-width` = sum of column widths, so narrowing the frame scrolls instead of crushing columns. Double-click on every grip returns the table to unshaped.

### Overflow is a feeling, not a scrollbar
- First column is sticky (`bg-card`, hairline right edge plus a soft 12px shadow) only once the user has scrolled right (`data-scrolled-start` on the wrapper). A 24px fade on the right edge appears only while more content exists that way (`data-scrolled-end`). Both come from observing `scrollLeft` and `scrollWidth`, so a table that fits shows neither.
- Row tint is a CSS variable (`--row-bg`) shared by the row and its sticky cell, so hover, focus and pinned tints stay continuous across the sticky edge. Tints are opaque `color-mix` results so the sticky cell never shows rows sliding under it.

### Header and cells
- Header labels: `text-micro`, `tracking-[0.05em]`, uppercase, muted. Sort affordance (chevrons) at 60% only on hover; the sorted header goes `foreground` with a single arrow that rotates for direction. Numeric headers are right-aligned with the icon on the left so the label stays flush with the numbers.
- Cells: 12px horizontal, 8px vertical. No zebra. Hover `muted/50`, pinned `muted/40`, focus `muted/60`. Numeric cells are `tabular-nums`, right-aligned, and keep the magnitude bar under the value. Status cells keep their tone.
- Footer appears at more than 8 rows: filter input plus `"N rows"` and `"· M shown"` only while a filter narrows the set. `aria-live=polite` on the count.
- Keyboard: header sort buttons are real buttons; grips are focusable separators with ←/→ nudge; rows pin with Enter/Space as before.

### Left out on purpose
- The grip is a constant 8px hit area straddling the edge, not 4px widening to 8px on hover. `.dt-resize::after` in index.css already assumes 8px and that file is not owned by this round.
- Other viz blocks (ChartExtras heatmap matrix, AutoBlocks/ListBlocks/SmallBlocks key-value `<dl>` grids) are not row tables and were not converted.

## Round: find like VS Code, window shortcuts (2026-10-22)

**Find is a widget, not a panel.** The editor's find lives in a floating card at the top-right of the code, 320px wide (384px with the replace row), `rounded-md`, hairline border, `shadow-e2`, `bg-popover`, 120ms fade and 6px drop. It never pushes the code down. The search input takes focus on open and is seeded from a short single-line selection. The count reads "n of N" in tabular figures, "No results" in destructive, "Invalid" for a bad regex, "999+" past the cap. Match case, whole word and regex are `aria-pressed` toggles inside the input's frame, lit with `bg-live/15 text-live`. Replace is a chevron-expanded second row and only exists when the file is editable. Keys: Enter next, Shift+Enter previous, Escape closes and returns focus to the code, Enter in Replace replaces one, ⌘Enter replaces all. The last query follows the user from file to file.

**Highlighting rides the package's own panel.** @codemirror/search only paints matches while its panel is open, so the host keeps a hidden panel (`createPanel` returns a `hidden` div, `.cm-panels { display: none }`) open for exactly as long as the widget is mounted. The widget pushes its query with `setSearchQuery` and lets `findNext`, `findPrevious`, `replaceNext`, `replaceAll` do the moving. Typing jumps to the nearest match at or after the caret (wrapping) so the count reads "1 of N" and the editor scrolls there.

**Workspace chords are window chords.** While the files pane is mounted, every `SHORTCUTS` entry fires from a window-level capture listener, so ⌘P, ⌘F, ⌘S, ⌘B and the rest work from the composer and the side chat input, not just inside the code. The listener skips when `e.defaultPrevented` and when any Radix dialog, menu, popover or the command palette (a native `<dialog>`) is open (`OVERLAY_OPEN`). ⌘K stays the palette's. Quick open (role="dialog", no `data-state`) does not block the chords so ⌘P inside it is harmless. The ShortcutsDialog lists the whole table under "Workspace · while the files pane is open" and `SHORTCUTS` is the single source for that list, the empty editor's welcome list and every menu hint.

**Shortcut table.** ⌘P Go to file, ⌘G Go to line (quick open with ":"), ⌘F Find in file (no file open: Search in files), ⌘⇧F Search in files, ⌘S Save file, ⌘W Close tab, ⌘B Toggle the files panel, ⌘\ Split the editor, ⌥Z Toggle word wrap, ⌘1 / ⌘2 focus a group. Editor-local only: ⌘D add next occurrence, ⌘⇧L select all occurrences, Esc close find.

**Editor status strip.** 22px, `text-micro`, muted, hairline top border. Left: "Ln X, Col Y" live, "(N selected)" when a selection exists, "Diff" in diff mode. Right: save state (Saving…, Unsaved in attention, Saved, Autosave on; `aria-live`), language, Wrap toggle (`aria-pressed`), and an italic bordered "Preview" badge that pins the tab on click. The save stamp moved here from the breadcrumb bar and footer.

**Tabs are flush.** No gap or padding on the strip. The active tab is `bg-card` with a 2px top line in ink (`bg-foreground`, `/30` when the group is unfocused); the backdrop glides between tabs with the shared spring. Preview tabs are italic. A dirty tab shows a 8px dot that swaps to × under the pointer; clean inactive tabs reveal × on hover only.

**Breadcrumb bar 26px.** `ChevronRight size-3` between segments, clickable segments `hover:bg-muted`, `Segmented size="xs"` for Diff / File on the right, download as a size-5 icon button.

**Explorer header.** A 26px row: `.label` "Explorer" in sentence case (DESIGN.md: no uppercase eyebrows) plus the repo name as a `stamp` when there is one repo. New file, New folder, Collapse all, Refresh are size-6 icon buttons revealed on hover or focus-within. Tree rows are 22px; the glide highlight and indent guides stay. The tabs-row Refresh hides in the Explorer view since the header owns it.

**Empty editor.** A `<dl>` of the chords that get someone into a file, rendered with `<Kbd>`: ⌘P open, ⌘⇧F search, ⌘F find, ⌘B sidebar, ⌘\ split.

## Round: select, then ask (2026-10-22)

Select any text in the conversation and a small pill floats above it: **Ask in side chat**, **Quote in reply**, **Copy**. The selection is the question; the pill only decides where it goes.

**The pill.** `SelectionToolbar` reads the document selection on `selectionchange` (settled 80ms, never while the mouse button is still down) and shows only when the selection is non-collapsed, at least two trimmed characters, and both ends sit inside the conversation scroller. Position is fixed, centred on the first line's client rect, 8px above it, flipped below when the line sits within 48px of the top, and clamped 8px inside the viewport once its real width is measured. Scroll (captured) and resize recompute on the next frame; a selection scrolled out of the conversation's own box hides the pill. Pointer devices at md and up only; phones keep the native selection UI. `bg-popover`, `border`, `shadow-e3`, `rounded-lg`, h-8 with h-7 buttons, `text-micro` labels, 14px lucide icons, 120ms fade with a 4px rise (0px under reduced motion). The pill cancels pointerdown so a click never collapses the selection it acts on; Escape hides it; Copy swaps to a check plus "Copied" for 1.2s and keeps the selection.

**Ask in side chat.** The store gains `quote: string | null` (persisted, re-validated on load, capped at 1500 characters with an ellipsis). A `quote` event attaches the text and opens the side chat; `unquote` detaches it; `asked` clears both draft and quote. The composer shows the quote as a chip above the textarea (Quote icon, 60-character single-line preview, × to detach, 120ms collapse that keeps its last text so it never flashes empty). The placeholder becomes "Explain this." and an empty draft sends exactly that, so one click and Enter is a full question. On the wire the question stays one string: every quote line prefixed `> `, a blank line, then the typed text. The turn also keeps `quote` so the bubble renders it as a blockquote (`border-l-2 border-border`, muted, three-line clamp, click to expand) above the typed text instead of raw `>` lines. A quote attaches while an answer is pending; it rides the next question. Retry re-sends the failed question verbatim with its own quote.

**Quote in reply.** Inserts `> text` plus a blank line at the start of the main composer's draft, or appends after a non-empty draft, through SendBar's seed mechanism (`append: true`), then focuses the composer with the caret at the end. The "Discuss" path from proposals now uses the same `asQuote` helper.

**Deliberately not done.** No command palette entry and no ShortcutsDialog line: the pill is discovered by selecting, and keyboard users reach its buttons with Tab (DOM order places it right after the scroller). No pill on touch or below md.

## Round: the conversation column (2026-10-22)

The column where the run is read: the transcript, the plan, code in answers, the changed-files strip, the jump button, the map in the gutter. The brief was "premium", which here meant removing what did not earn its pixels before adding anything.

### What was subtracted

- **The minimap below three turns.** A one-reply thread drew two stray bars at x≈285–305 that read as a rendering defect. Two turns is the task and one reply; the thread is its own map. The rail now returns nothing under three turns. When it does render it is one shape: 2px bars, 16px wide, 12px apart, muted; the active turn's bar is `--live` (a question's is `--attention`). The old mix of heights and widths is gone.
- **Two shadows.** The plan dock and code blocks both carried `shadow-e1/e2` while sitting in the same plane as the prose. Shadows are for elevation; neither is above anything. Both are flat now, bordered only.
- **The code header band.** "ts · Copy" was a filled strip with a hairline under it. It is now the language and the copy button on the block's own surface, no band, no rule. The language is `.stamp`-quiet.
- **A second card above the composer.** "3 files changed · Review all" used to be its own `bg-card rounded-xl border shadow-e2` block floating 12px above the composer, so the bottom of the column stacked two cards with two shadows and two radii that did not agree. The dock now lives inside the composer's surface as its first row (SendBar's `top` slot): edge to edge, `rounded-t-[15px]` against the 16px outer corner (concentric: outer radius minus the 1px border), one hairline below it as the only structural border. One surface, one shadow.
- **The jump button that appeared too soon.** The scroll-to-bottom control showed as soon as the view left the end. It now shows when the reader is more than one viewport above the end (or new content landed below), the only distance at which a jump beats a scroll. It sits 16px above the composer's top edge, centred on the column (676 = column centre at 1440), and enters with the checklist's icon values (opacity 0→1, scale 0.25→1, spring 0.3s, bounce 0), exits at scale 0.9. Reduced motion: opacity only.

### The plan card

At 1440 the plan read as a floating card. Measuring it showed it was not positioned; it was a flex sibling aside, vertically centred (`items-center`) with `shadow-e2`, so it hung in the middle of an empty column with nothing to align to. The split itself was right: a docked aside at ≥80rem when no other aside is open, an inline section below. What was wrong was the alignment and the elevation.

Decision: keep the dock/inline split, top-align the dock so its panel's top edge is level with the Task label (both at y=116 at 1440 and 1280), and drop its shadow so it is a column beside the conversation rather than an object over it. Below 80rem it is the inline section above the task, as before.

Evidence (`.shots/r5-chat-plan-1440.png`, `-1280.png`, `-1100.png`; fixture `.shots/out/r5-chat-1440.png`, `-1280.png`, `-1100.png`): zero intersections between the plan's box and any answer paragraph at all three widths; the widest prose line is 681px at 1440 and 1100, 580px at 1280 beside the dock. The 1100 shot shows the inline section with the task bubble below it.

### Code in answers

Long lines used to clip at the block's right edge. The block now scrolls sideways (`whitespace-pre`) with soft edge fades on the side that has more (DataTable's `data-scrolled-start/end` pattern, 24px, 7% foreground mix) and a thin scrollbar that is transparent until the block is hovered or focused. On the fixture's wide `ts` line: scrollWidth 1008 against clientWidth 679; only the right fade at the start, only the left fade after scrolling to the end.

### Checklist sweep

`text-wrap: pretty` on answer paragraphs and list items; `tabular-nums` on the rolling file count; `initial={false}` on the inspector, workspace-pane, composer-menu and jump-button `AnimatePresence`s so nothing animates in on page load; no `transition-all` in the owned files.

### Left out

- The task bubble and tool-card radii live in TraceItems.tsx, which this round did not own.
- `useScrollEdges` is duplicated between `viz/DataTable.tsx` and `ui/code-block.tsx`; DataTable was not owned here, so the shared hook is a follow-up.
- A true overlay scrollbar is not available on Windows Chrome without `::-webkit-scrollbar` tricks that the standard `scrollbar-width` overrides; the thin transparent-until-hover bar is the honest version.

### Proof

`.shots/r5-chat.mjs` 18/18 light and 18/18 dark (minimap absent, plan placement at three widths, code fades and scroll, jump-button distance and position, dock inside the composer and not focusing the textarea). `.shots/r3-select.mjs` still 22/22. `npm run build` clean.

## Round: workspace chrome, by subtraction (2026-10-23)

The files pane had grown three header rows above the code and three bars below it. Each row was reasonable on its own; together they cost the code 118px at the top and 46px at the bottom, and the hunk header repeated the file name that the tab already carried. This round removes rows instead of restyling them.

### What was subtracted

- The file header. Its name repeated the tab. Its +34 −11 stamp, the Diff · File segmented control and the download button move into one 26px toolbar under the tab strip, with a folder trail (never the file name) on the left. The hunk header is no longer chrome; it is a quiet 11px line inside the diff body, sticky, in `text-faint`.
- The editor status strip. The 22px strip under the editor is gone. Ln/Col, the save state, the language, Wrap and Preview sit on the right of the pane's one 28px status bar (`footer[data-ws-status]`), which already carried branch, changed and file counts on the left. Nothing in the pane repeats the global bar; the "Go to file ⌘P" button left the footer because ⌘P is listed in the shortcuts dialog and the palette.
- The explorer's filter row. The sidebar now has an icon row (36px, the same height as the tab strip, so the border runs through both) and a 26px section header. A filter button in the icon row swaps the header into the filter field; Escape, Clear, or blurring an empty field swaps it back. The Filter and Reveal header actions are gone (Reveal stays in the tree's context menu), so the header keeps four hover actions, and those are overlaid rather than in flow so the repo stamp keeps the row's full width until the pointer arrives.
- The gutter. Line numbers were ~130px for two columns. The width now comes from the widest line number in the diff (`max(3, digits)` ch plus padding), the sign is 1ch, and long lines scroll under a soft right-edge fade (the viz/DataTable pattern, armed through `data-scrolled-end`) instead of a hard clip.

### Measurements (1440×900 fixture, `.shots/r5-workspace.mjs`)

- Top chrome: 118px (tab 36 + file header 26 + hunk bar 26 + status strip offset) to 62px (tab 36 + toolbar 26). Bottom chrome: 46px (22px strip + 24px footer) to 28px. The code area gains 74px, 698px of a 788px pane.
- Gutter: 78px of a 420px editor group; code column is 81% of the group (was ~65%).
- Explorer rows above the tree: three to two. Icon row and tab strip both end at y=124.
- Hit areas: toolbar buttons are 24px with a pseudo-element reaching 40px; header actions 24px inside a 26px row that is itself the hover target.
- Lucide strokes in pane chrome are 1.5px through a container class, so no icon needs its own prop.
- Fixtures: `r5-workspace.mjs` 20/20 at 1440 light and dark; `r2-find.mjs` 21/21 after its 22px strip check became a 28px footer check.

### What was left out

- No press scale on toolbar or header buttons. `index.css` already applies `:active { transform: scale(0.985) }` globally, and the shared Button has no scale prop, so adding one per button would be a second system.
- No width policy for the sidebar. At 1100×800 the fixture's pane is 348px with a 191px sidebar, which leaves the editor group 155px; the toolbar clips rather than spilling into the sidebar and hides the +/− stamp under 300px, but the proportion itself belongs to the pane layout, not to chrome. The 60% code-column target holds at 1440 and reads 50% at 1100 for that reason.
- The language label stays as `languageOf` returns it (`typescript`, not `TypeScript`). Capitalising it is a display map worth doing once for the whole app, not here.
- The review page, PR page and History still share `DiffView`, so they inherit the narrow gutter and in-body hunk header; their own headers were not touched.

## Round: go to symbol (2026-10-23)

**⌘⇧O is the third mode of quick open.** The same dialog, the same input, the same 26px rows: "@" lists the active file's outline, the way VS Code does it. `SHORTCUTS` gains `goToSymbol` (⌘⇧O, "Go to symbol", `quickOpen("@")`), so the ShortcutsDialog, the window-level chord listener and every menu hint picked it up without a second table. The placeholder now reads "Go to file, :line or @symbol". ⌘⇧O on a Diff tab switches it to File first, because only the editor holds a syntax tree.

**The outline is a pure function of the editor state.** `lib/symbols.ts` exports `CodeSymbol = { name, kind, line, from, to, depth }` and `symbolsIn(state)`. One table per CodeMirror language name maps lezer node names to `{ kind, names(node) }`: TS/JS declarations (function, class, method, property, interface, type, enum, `const`/`let` bindings through destructuring, arrow-function consts count as functions, members of interfaces and type literals), Python defs and classes (a def under a class is a method), markdown headings (ATX and Setext, nested by level), JSON keys, YAML keys, CSS rule selectors. `depth` is a stack counter that grows inside any node that emitted a symbol, so a method sits one level under its class and a local under its function. The tree is parsed to the end with `ensureSyntaxTree(…, 200)` and falls back to whatever is parsed. A grammar without a table (shell, html) yields nothing. Capped at 2000 symbols. `matchSymbols` ranks prefix over substring over subsequence, ties in document order, and an empty query is the whole outline in document order.

**Rows.** Indent is 12px plus 14px per depth. A 14px lucide icon by kind (SquareFunction for function and method, Box for class, Type for interface/type/enum, Variable, Key for property and key, Heading, Hash for a selector), the name, and the kind as a `stamp` on the right. One quiet row, "No symbols in this file", when there is no editor or no tree; "No symbol matches “x”." when the filter empties the list. The cursor row stays in view while arrowing (that scroll-into-view now serves the file list too).

**Preview, then commit.** The editor handle grows `symbols()`, `reveal(sym, { select })` and `snapshot()`. Opening "@" takes a snapshot (scroll and selection). Arrowing calls `reveal` without `select`: the editor scrolls the symbol to centre and tints its line (`.cm-preview-line`, `--live` at 12%, held, unlike the 2s reveal flash) while the caret stays put, so the status strip does not move. Enter calls `reveal` with `select`: the name is selected, the editor takes focus, and the tint goes. Escape, a click outside, or leaving "@" for another mode runs the snapshot's restore, which puts scroll and selection back and clears the tint. Quick open normally returns focus where it came from on close; a symbol pick hands it to the editor instead.

**Left out.** No command palette entry: the palette's "Go to" group is pages, there are no workspace commands in it, and a one-off entry there would be the only one of its kind. No symbols for shell, html or plain text (no tree or no table). Workspace-wide symbol search ("#") is not built. The outline is read once per "@" session; edits made while the dialog is open are not reflected until it is reopened.

## Round: the app shell (2026-10-22)

The frame around the work: the sidebar's machine list, the Hub's "Live now" and "Recent runs", the History page's activity card, filters and table, and the button primitive every one of them is built from. Subtraction first; the two things added (a press and a strip) are each one rule.

### What was subtracted

- **A header-measurement bug, not a column.** Both Hub and History tables ran past their cards (History 882px in an 834px card; the Hub's "Tokens" header read "T…"). The width model measured each header's *cell* at max-content as the column's floor, and at max-content a cell is as wide as the column's widest row, so the flexible "Run" column's floor was the length of its longest title. The floor is now the header's own footprint (label, sort icon, padding; `labelWidth` in `lib/column-widths.ts`). Hub 494/622, History 771/834, no declared width touched to get there. "Duration" became "Took" and "Archived" became "When": shorter words, same meaning, narrower floors.
- **Three ways to say a state.** The sidebar drew a coloured initial tile, a braille spinner for working rows, a pinging dot for waiting ones and a bare word for the rest; the Hub drew icon+word stamps in a fourth style. One vocabulary now (`stateWord` in MachineList: Working, Action needed, Done, Failed, Asleep, Idle, Stalled) rendered one way everywhere: `StatusDot`, a 6px dot and a word. The sidebar's tile, spinner and tone tables are gone (−60 lines). Rows are 36px with 8px hover surfaces.
- **The two-line warm callout.** "1 warm machine ready — a new task starts in seconds" under a flame icon, wrapping to two lines in a 13px face, is now one 28px line in `text-faint` with the `ok` dot: "1 warm machine ready · starts in seconds". It is a fact about capacity, and it reads like one.
- **Two shadows.** "Live now" and the activity card both carried `shadow-e1` while sitting in the page plane. Borders now; shadows stay on things that float.
- **A duplicated count.** The table toolbar showed the row count beside the search even with nothing typed, next to chips that already say "All 6". It appears only while a query narrows the rows ("3 of 6").
- **A second filter row.** History stacked "Started by / Agent / Verified / Clear" on one line and "All / Done / Failed" on another below the search. They are one row now: search left (160–256px, flexing), chips and selects right, every control 32px, native selects capped at 144px so a long automation name cannot push the row over. The Agent select only renders when there is more than one agent to choose between (the fixture's single "claude" hides it). At 1280 the row is one line: five controls, one top.

### The activity card

A 13-week grid with 7 of 91 days lit was a 200px card that read as broken. Measured: 10px cells, 3px gaps, 8% filled.

Decision: size the card to the data. Fewer than 14 active days (two weeks' worth) draws a single row of the last 42 days (21 on a phone), 12px cells and 3px gaps, months above, summary inline in the header; from 14 active days the week grid returns at the same 12px cells. The strip is the same component with `days` set, so keyboard walking, tooltips and the AT label ("Run activity, last 42 days: 40 runs") carry over. The first month label is skipped when the second column is already a new month, which was producing "JulAug" in the dense case.

Evidence (`.shots/r5-shell.mjs` and its shots): the sparse fixture (40 runs over 6 days) renders 42 rows of 1 at 12px inside a 121px card at both 1280 and 1440 (`.shots/out/r5-shell-history-strip.png`, `-dark.png`); the dense fixture (one run a day for 60 days) renders 13 × 7 (`.shots/out/r5-shell-history-grid.png`, `-dark.png`).

### The press

The button primitive owns its press now: surface variants (default, primary, outline, secondary, danger, destructive, attention) get `active:scale-[0.96]` with transform, translate and scale in their transition list; ghost and link are text and do not depress; a `static` prop opts a button out. The global base rule in `index.css` that pressed every `button` (0.985) and then every `[data-slot="button"]` primary again (0.97) no longer touches `data-slot="button"`, so the two scales cannot multiply. Measured with a held outline button: `scale: 0.96`, `transform: none`.

### Checklist sweep

`h1, h2, h3 { text-wrap: balance }` and `p { text-wrap: pretty }` in the base layer, so the serif greeting and every body paragraph get them without a class; `tabular-nums` was already on the sidebar counts, Capacity, the table's numeric cells and the Live now stamps, and is on the warm line now; no `transition-all` anywhere in `web/src`; the `sleep` tone (violet, DESIGN.md's moon hue) joins `StatusDot` so an asleep machine is not "faint" in one place and violet in another.

### Left out

- `ui/table.tsx`'s surface variant still carries `shadow-xs`; it is not this round's file. Flagged for the owner of the table primitive.
- The Hub's "Live now" keeps 44px rows: it is a list of running work with a question drawer under waiting rows, not the sidebar's 36px index.
- No breakpoint drops a History column; after the floor fix none was needed at 1280 or 1440, and the model already hides Machine below `md`.
- `.shots/r4-tables.mjs` asserted the Description column lands past 900px after a 360px drag; that number depended on the old floor (longest cell). It now asserts what the step proves, that the drag widened the column by 360 (20/20 again).

## Round: a framed sheet (2026-10-23)

The shell read flat. The sidebar was two points of lightness darker than the page in light mode
(0.972 against 0.992) and 3.5 points in dark (0.14 against 0.175), and the only thing separating
rail from content was a hairline. Screenshots in both themes showed three panes divided by lines,
not a surface holding a document.

Decision: one tinted chrome and one sheet. The rail, the shell bar and the status bar all sit on
`--sidebar`, now 0.962 in light and 0.125 in dark, a three-point step that reads at a glance. The
pane is wrapped in a `data-sheet` surface on `--background` with `md:rounded-tl-xl` (14px with the
10px radius token) and `md:border-t md:border-l`. The shell bar lost its bottom border and the rail
its right border; the sheet's own hairlines take over, so there is still exactly one line between
chrome and content. The collapsed rail keeps the frame; below `md` the sheet is flush, square and
unbordered, because a 390px screen has no desk to sit on.

Evidence: `.shots/r6-frame.mjs` (18 checks) measures the rail tone against the sheet tone in both
themes, the main pane behind the sheet on the rail tone, the corner radius and the hairline sides,
no bottom border on the shell bar, the status bar on the rail tone, the sheet's offset from the
rail, and the flush pane at 390. Shots in `.shots/r6/`.

## Round: one calm transcript column (2026-10-23)

The transcript nested bordered boxes three deep. A tool step was a bordered card inside the tinted,
bordered "Worked for Xs" surface, and a shell command was a dark bordered terminal panel with its own
header row inside that. The changes dock's marks were brand icons (TypeScript blue, vitest yellow)
that fought a muted palette. Measured on the Trace density fixture with every fold open: 42 elements
with a visible border in a done thread, 32 four-sided surfaces over 24px tall, a tool step with a
boxed ancestor and three boxed levels inside it.

Decision: hierarchy by spacing, tone and type, not by nested borders. The work group is a bare list
whose only structure is the glyph column and its hairline. Step glyphs are 20% tints, not rings. A
shell command is a flat row with the same anatomy as every other step (glyph, `$ cmd` in mono, tail
with exit chip, duration, chevron) and its output opens under it as the dark block. Every dark panel
dropped its white hairline, since the ground tone already separates it. State marks keep their
borders (a secret that needs action, a queued item, a chosen answer). The test results card stays as the
one bordered surface in the column, because that is the result the reader came for.

After: 23 bordered elements (21 running), 10 four-sided surfaces (8 running), no boxed ancestor
above a step, one boxed level inside. File marks went from chroma 0.184 to 0.016 light and 0.012
dark. Evidence: `.shots/r6-trace.mjs` (32 checks), shots in `.shots/r6/trace-*`.


## Round: no page glows (2026-10-23)

A radial brand bloom sat behind the conversation head (`.thread-glow`, an `absolute inset-0` layer
on the thread root) and another behind the Hub hero (`.hub-stage`). Because the thread layer covered
the whole root, it also bled under the workspace explorer when the pane was open, so the file tree
had a soft indigo halo at its head. The user read both as noise.

Decision: delete both. The sheet is one flat tone and hierarchy comes from the content (the framed
sheet, the type scale, the bordered test card). The top and bottom edge fades on the thread stay,
since they mask the scroll edges rather than decorate them. Evidence: `.shots/r7/noglow-file-dark-1440.png`
against `.shots/r7/base-file-dark-file-dark-1440.png`.

## Round: no glows in the column (2026-10-23)

After the page-level blooms went (the round above), the user still saw corner light in the thread's
dynamic parts. Found and removed, each replaced by its static cue:

| Was | Now |
|---|---|
| Composer focus: a 3px spread shadow in `--ring` (`.composer-glow`) | A flat 2px outline in `--ring` at 40% (`.composer-focus`), `outline-offset: 0`, no spread |
| Question and scheduled cards: a 4px attention ring plus a 32px offset bloom (`.attention-glow`), near-white on a dark page, and a one-shot swelling ring on landing (`.attention-pulse`) | The `border-attention/50` hairline alone; the card's rise-in marks its arrival |
| Dictation: live border at 55% plus a 3px ring and a 24px blurred bloom (`.mic-glow`) | Solid `--live` border plus a 1.5px inset outline (`.mic-live`), no shadow |
| Three lit spheres (run pill `.orb`, byline `.agent-mark`, reasoning trail `.think-orb`): radial gradient, conic sheen, inset rim, live drop shadow, pulsing bloom | One rule, a flat disc in `--live` at 12, 14 and 16px, `breathe` only while live |
| Timeline and step dots: an expanding live shadow ring (`viz-pulse`) | `breathe` |
| MCP panel while live (`ring-live/40`), the Starting pill (`ring-live/20 ring-inset`), a picked option (`ring-live/25 ring-2`) | `border-live/40`, `border-live/20`, `border-live/60` |

Kept: the composer's neutral e2 depth and 1px inset highlight, the you-bubble's inset highlight,
keyboard `focus-visible` rings, neutral elevation shadows, the `--background` edge fades. All are
achromatic, inset or keyboard-only.

Proof: `.shots/r8-glow.mjs` (64 checks). With the composer focused it scans every element and
pseudo-element under `[data-thread]` in the done, running and question scenarios, light and dark,
and fails on any painted non-inset box-shadow with chroma above 0.02 or lighter than the page, any
`radial-gradient` background and any `blur()` filter. It self-tests by injecting the old composer
halo, a lit sphere and a blur and requiring the detector to catch all three. The edits are a
rerunnable codemod, `.shots/r8-glow-edits.mjs`. Shots: `.shots/r8/before-*` and `after-*`.

Left alone: the Hub hero composer's focus halo (home, not the thread), the plan board's live
sweep and completion wash (linear, no shadow), the dictation pill's sheen, the secret field's
one-shot ring flash (outside the thread).

## Round: VS Code chevrons (2026-10-23)

The editor's fold markers were `▾`/`▸` text glyphs at 60% opacity, always on, 9px wide in a
20px cell. The explorer's twisties were 14px lucide chevrons at stroke 2 in muted ink. The folded
placeholder was CodeMirror's default (`#eee` box, `#888` text, `…`), the only unthemed piece of the
editor. The user said they looked small and nothing like VS Code.

Decision: VS Code's treatment in both places. The fold gutter is a 16px column; each marker is an
inline SVG of lucide's chevron (down for an open region, right for a folded one) at 1.5 stroke in
`currentColor`. Open markers are hidden until the pointer is over the gutter (`.cm-gutters:hover`,
100ms opacity, none under reduced motion); a folded region keeps its chevron-right visible so it stays
discoverable; the hovered marker brightens to `--foreground`. The placeholder is `⋯` in
`--muted-foreground` on a 14% muted tint, 3px radius, no border, brighter on hover. The explorer
twistie is one `Twistie` component (`workspace-chrome.tsx`): 16px, stroke 1.5, `text-foreground/80`,
`rotate-90` when open, 100ms ease-out. It overhangs its 14px slot by 1px each side so the guide lines
and name x positions did not move. The file icon was 15px beside a 16px folder icon, which put file
names 1px left of folder names at the same depth; it is 16px now and names align (1243/1243,
1255/1255 at 1440). Rows stay 22px. Evidence: `.shots/r7-chevrons.mjs` (30 checks, light and dark),
shots in `.shots/r7/chev-*`.

Left out: diff hunk expand controls (there are none); the explorer header's collapse-all icon stays
`size-3.5` with its neighbours; the Search pane's result chevrons (a different surface).

## Round: go to symbol, VS Code parity (2026-10-23)

The first cut of ⌘⇧O (above) opened on the first row, centred the editor on it, showed neutral
14px icons with the kind word on the right, had no match highlighting, read `@:` as a query for
":" and showed `⌘⇧O` glyphs on Windows. Measured against VS Code's Go to Symbol in Editor, eleven
behaviours differed or were unproven.

Decision: close every gap and prove each one. The palette opens on the symbol the caret is in
(`symbolAt` over the declaration ranges `CodeSymbol.range`; innermost wins) without scrolling the
editor. Rows are 26px with a 16px kind icon in VS Code's tones (purple method/function, orange class
and enum, blue variable/field/interface/property, teal type, neutral heading/key/selector), a 6px gap,
the name with the typed characters bolded (`matchSymbols` returns `positions`), and the containing
class or function as dim detail (`containerName`; headings have none). `@:` groups by kind in VS
Code's order (classes, interfaces, functions, methods, variables, properties, enums, types, then
headings, keys, selectors) with counted separators riding the first row of each group, and `@:q`
filters within the groups (`CATEGORY`, `groupSymbols`). Arrowing bands every line of the declaration
(`line..endLine`) and centres only when the symbol is off screen, as VS Code reveals; Escape, a click
outside, or backspacing past `@` restores scroll and selection exactly. Enter selects the name with
the caret at its start, centres, and focuses the editor. Empty states read "No editor symbols" and
"Open a file first." The dialog is 600px wide at 1440 with a 1px border. `SHORTCUTS` rows are built
by a `chord()` helper that derives `keys` and `label` per platform, so the shortcuts dialog and the
empty editor read `Ctrl Shift O` on Windows and `⌘ ⇧ O` on a Mac.

One root cause found on the way: after "centre only when off screen", Escape left the editor
scrolled. CodeMirror's focus observer repairs a `scrollTop` of 0 against its stale `lastScrollTop`
when focus returns, overwriting the restore. The snapshot now restores through
`view.scrollSnapshot()`, which lands inside CodeMirror's measure cycle after the focus return.
Evidence: `.shots/r7-symbols.mjs` (36 checks per theme, 72 total; 42 passed before), `symbols.test.ts`
10 tests, shots in `.shots/r7/sym-*`.

Left out: the list keeps its depth indent (VS Code's is flat; r5 asserts the indent); the band tone
stays `--live` at 12% rather than VS Code's yellow range highlight; pressing the chord while the
palette already holds `@` plus a query does not clear the query.

## Round: five themes (2026-10-23)

One light and one dark palette, flipped by a sun/moon button writing `asb-dark`. The dark was
charcoal (`oklch(.175)`, #101010), and there was no way to have a true black page or anything with
a hue.

Decision: a theme registry (`lib/theme.ts`) and a picker. Light and Graphite are the existing
palettes untouched. Black is the new default dark, `oklch(.1 0 0)` on the page; since nothing can sit
below that, the rail and the terminal tone step up to `.16` and the sheet reads as a dark well in a
lighter frame, the inverse of the light theme's lifted paper. Midnight puts the `--live` hue into the
neutrals (chroma .03 at 262, cards six degrees violet, tinted hairlines, navy shadows). Linen warms
the neutrals (hue 60–85) and keeps the indigo accent. Every override is a `:root[data-theme]` block
over `.dark`, so the syntax tokens, `.raised`, code blocks and Mermaid keep keying off the class.
The picker is a menu of `menuitemradio` rows with a rail/page/live swatch each; switching has no
transition. The palette keeps the scheme toggle, which now returns to the last theme used in each
scheme, and gains a command per theme. Two light values outside the new blocks moved, both because
they sat under the 4.5:1 the tokens promise: `--faint` `.58` → `.555` (4.21 → 4.65 on the Light
page) and `.tok-comment` `#6e7781` → `#59636e` (4.43 on Light, 4.22 on Linen; both now above 5).

Measured on the Hub at 1440 (`.shots/r7-themes.mjs`, 129 checks; contrast is WCAG, composited):

| Theme | Page | Rail | Body | Muted | Faint | Live | Composer hairline | Trace vs page |
|---|---|---|---|---|---|---|---|---|
| Light | `.992 .001 286` | `.962 .003 286` | 17.28 | 5.88 | 4.65 | 5.59 | 1.53 | 17.61 |
| Linen | `.975 .009 80` | `.945 .012 80` | 14.96 | 5.86 | 4.72 | 5.33 | 1.52 | 16.14 |
| Black | `.1 0 0` | `.16 0 0` | 17.78 | 7.98 | 5.90 | 8.72 | 1.81 | 1.06 |
| Graphite | `.175 .005 286` | `.125 .005 286` | 16.39 | 7.06 | 5.19 | 8.03 | 2.12 | 1.07 |
| Midnight | `.17 .03 262` | `.125 .028 262` | 16.60 | 8.01 | 5.94 | 8.60 | 1.90 | 1.06 |

The fixture also asserts, per theme on the Hub, History and a thread: `data-theme` and the `dark`
class match the registry, the page background equals the registry preview, the rail differs from
the sheet, no page errors; and that the picker lists five radios with the active one checked, a
keyboard choice switches and stores, the landing toggle returns to the last dark theme, and the
legacy key migrates (`asb-dark=1` → Black, `0` → Light). Shots in `.shots/r7/theme-*`.

Left out: per-theme syntax colours (one set per scheme; the fixture measures every `.tok-*` against
the page and the card, and the dark set's lowest is 5.70 on Graphite and Midnight, 6.40 on Black); a
theme transition (a hundred switches a day is not a moment for motion); a settings page
(Appearance gets a row that opens the same picker).

## Round: the theme panel (2026-10-23)

The theme menu was five `menuitemradio` rows, each a 36×16 three-tone swatch, a name, a
description and a check. The verdict was that it did not look good, and the swatch could not say
what a theme would feel like: three flat tones carry none of the frame, the card step or the live
accent that make one dark differ from another.

Decision: a panel, not a row list. `ThemePicker` is a 21rem popover (Radix Popover, the same
150ms origin-aware grow-in as every menu, capped at the available height so a mid-page trigger
scrolls the grid instead of clipping it) holding a two-column grid of theme cards grouped under
"Light" and "Dark". Each card is a miniature of the console drawn with real DOM in the registry's
`preview` tones: a rail strip with two working rows, the sheet with its hairline frame, a task
bubble, two text lines, a live row and the composer bar with its live caret. The active card has a
2px `--ring` and a check. Resting on a card for 150ms previews the theme on the whole app through
`applyTheme` without storing; leaving the panel or pressing Escape puts `readTheme()` back; a click
or Enter commits and closes. Arrow keys walk the grid and preview as they go, so the keyboard gets
the same try-before-you-keep. The theme switch itself still has no transition.

Four themes join the five, each a `:root[data-theme]` block overriding only what differs from its
scheme base: Mist (light, cool grey-blue paper, slate ink, a steel-blue accent), Nord (dark, polar
grey-blue a step lighter than Graphite, a frost-cyan accent), Forest (dark, deep green with moss
cards, a mint accent, `--ok` moved to yellow-green so working and done stay apart) and Dusk (dark,
warm aubergine, a rose-gold accent). Each carries its own `--ring`, `--live`, hairlines and
`--shade-*` on its hue. `preview` grew from three tones to seven so the miniatures draw from the
registry rather than a second copy. The pre-paint script in `index.html` gained the four ids and a
placeholder shell tint each. Black stays the default dark and Light the default light.

Measured on the Hub at 1440 (`.shots/r8-themes.mjs`, 287 checks; contrast is WCAG, composited;
`live/card` is `--live` on `--card`, `tok-min` the lowest `.tok-*` syntax colour on page or card):

| Theme | Page | Rail | Body | Muted | Faint | Live | Live/card | tok-min | Composer hairline |
|---|---|---|---|---|---|---|---|---|---|
| Light | `.992 .001 286` | `.962 .003 286` | 17.28 | 5.88 | 4.65 | 5.59 | 5.74 | 4.92 | 1.53 |
| Linen | `.975 .009 80` | `.945 .012 80` | 14.96 | 5.86 | 4.72 | 5.33 | 5.59 | 4.69 | 1.52 |
| Mist | `.962 .012 240` | `.925 .016 240` | 13.48 | 6.10 | 4.85 | 5.36 | 5.72 | 4.54 | 1.59 |
| Black | `.1 0 0` | `.16 0 0` | 17.78 | 7.98 | 5.90 | 8.72 | 8.32 | 6.40 | 1.81 |
| Graphite | `.175 .005 286` | `.125 .005 286` | 16.39 | 7.06 | 5.19 | 8.03 | 7.41 | 5.70 | 2.12 |
| Midnight | `.17 .03 262` | `.125 .028 262` | 16.60 | 8.01 | 5.94 | 8.60 | 7.87 | 5.70 | 1.90 |
| Nord | `.225 .02 245` | `.18 .018 245` | 14.33 | 7.42 | 5.71 | 9.39 | 8.46 | 4.99 | 1.92 |
| Forest | `.185 .025 155` | `.14 .022 155` | 16.03 | 7.85 | 6.08 | 11.18 | 10.10 | 5.44 | 1.86 |
| Dusk | `.185 .03 340` | `.14 .028 340` | 16.15 | 8.05 | 6.16 | 9.68 | 8.84 | 5.57 | 1.95 |

The fixture also asserts, per theme on the Hub, History and a thread: `data-theme` and the `dark`
class match the registry, the page background equals `preview.background`, the rail differs from
the sheet, no page errors; and for the panel, opened on Light and on Black: nine `radio` cards under
the two headers, exactly one ringed and checked, hovering another card changes the computed page
background within 300ms (measured 187–190ms: the 150ms rest plus a frame or two) without writing `asb-theme`, moving the pointer off
the panel reverts it and leaves the panel open, a click commits, stores and closes; from the
keyboard, the active card has focus on open, ArrowRight moves focus and previews without storing,
ArrowDown then Enter commits and stores, Escape after an arrow preview closes and reverts. The
landing toggle and the legacy-key migration checks carry over from round 7. Shots in
`.shots/r8/theme-<id>-hub.png` and `theme-panel-{light,dark}.png`.

Left out: per-theme syntax colours (the one dark set still clears 4.5 on every dark page and card,
lowest 4.99 on Nord's lighter card; the light set's lowest is 4.54 on Mist); a per-card scheme badge
(the two group headers already say it, and a third word under a 9rem card was noise); a fourth light
theme to square the grid (an empty slot is honest, a filler theme is not); the mobile registry
(`mobile/src/theme/themes.ts` mirrors the web one by hand and is another workstream's).
