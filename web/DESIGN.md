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

1. **`needs you` is the loudest thing on screen — and it is ink, not a hue.** Weight and motion
   carry it: a strong hairline on paper, a soft wide halo, a ping dot, and the one filled button
   (Answer / Approve). Never a tinted fill — a grey wash reads as *disabled*, the opposite of "your
   turn". The sidebar queue card, the state pill, the question and scheduled cards, the composer's
   halo and the approval chips all follow this (`--attention` tokens).
2. **Colour is for what the machine is doing.** working (live blue, breathing), done (green), failed
   (red), idle (grey), **sleeping** (violet — an idle-stopped microVM whose workspace survives; a reply
   wakes it), each with a drawn icon and a word so the meaning survives colour-blindness and sunlight.
   **Amber (`--warn`) is a fact, not a request:** a meter running high, a weak password, a PR with
   changes requested, a trial ending, an unsaved file. Used sparingly; never for "needs you".
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

Flat two-pane console — no floating cards, no gaps, one hairline between the panes.

- **Sidebar (17rem, collapsible to 3.5rem):** brand + live health line → **New task** (the primary
  fill) → search (⌘K) → *needs-you queue card (paper, ink hairline, only when non-empty)* → **Machines** list,
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

| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `oklch(.992 .001 286)` | `oklch(.17 .005 286)` | page |
| `--card` | white | `oklch(.205 .005 286)` | sidebar, composer, panels |
| `--foreground` | zinc-950 | `oklch(.95 .002 286)` | text |
| `--muted-foreground` | `oklch(.5 .016 286)` | `oklch(.7 .012 286)` | secondary text (≥4.5:1) |
| `--primary` | ink | near-white | the one filled action |
| `--live` | `oklch(.52 .2 262)` | `oklch(.74 .15 262)` | working, links, caret, selection, focus ring |
| `--attention` / `-text` / `-ink` | ink / ink / paper | near-white / near-white / charcoal | needs you — hairline, halo, the one filled button; never a tinted fill |
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
rows `layout`-animate to their new triage position when a state flips; the needs-you card grows in
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

`ThinkingItem` folds extended-thinking blocks (collapsed to "Thought — <teaser> · N words"); `PlanCard`
renders the agent's TodoWrite plan as a live checklist (done ✓ / in progress / todo, n/m), shown once
in its latest state. Both come from sentinel blocks the in-box formatter writes (`⟦think⟧`, `⟦plan⟧`).

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

`lib/fileIcon.tsx`: a two-letter monogram in the language's conventional colour (TS blue, JS yellow,
MD steel-blue, Py …) used in the `@` menu, composer chips and the changes list — the editor
convention, vector-crisp, no icon font.

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
click away; groups containing one open by default. A PR URL in the transcript becomes a
`PullRequestCard` that reads like GitHub: state glyph, `#142 Title`, `repo · head → base · +/- · files`
(metadata via `/pr.json` through a connected account; a plain link until it arrives). Answering a question hides the card at once and shows "Answer sent — resuming".

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
- **Grouped sidebar.** Machines carry faint group labels (Needs you · Working · Done · Sleeping · Warm) only when the list spans more than one group — more space around a group than within it.
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
  something set inside. Amber stays reserved for needs-you.
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
- Dot: green done, red failed. Amber never appears here (it means needs-you).
- Collapsed by default. Click/Enter opens, via `Collapse` (height + fade; plain fade under reduced motion), a borderless key-value list (`[data-run-pill-details]`): summary, started by, driver, model, PR links, diff, tests, verify, exit code, failed commands, questions, sandbox blocks, duration, tokens, cost, followed by, follow-ups.
- Only recorded facts. Unknown or empty rows are dropped: no "—", no "$ —", no "no questions asked", no "exit 0" when tests or verify already speak. A digest headline that just says "done" is dropped so the state is said once.
- The pill also absorbs `RunSummary`: its steps/commands go in a "work" row, its exit-code note in "note", and Copy transcript / Run again are the last row of the details (`[data-run-pill-actions]`). Nothing else renders at run end.
- History keeps `OutcomeCard`/`DigestCard`; the data (`/history/outcome.json`, `/digest.json`) is unchanged.
