# Output visualizers — how agent output gets beautiful

The chat transcript upgrades structured agent output into rich, interactive components
automatically. This file is the contract: what the console renders, what an agent (the sandboxed
Claude, or Claude working on this repo) should emit to get the rich rendering, and the design
rules any new visualizer must follow. **Read this before adding a visualizer or changing how the
agent formats results.**

## Where it plugs in

One integration point: `web/src/components/ui/markdown.tsx` routes fenced blocks through
`web/src/components/viz/SmartBlock.tsx` (which asks `web/src/lib/viz-auto.ts` what a bare or
unrendered fence really is) and upgrades GFM tables, task lists, definition lists, status lists
and link lists. Every surface
that renders agent markdown (thread, PR page, file pane, trace, skills) gets the same treatment,
including the streaming reveal — a half-streamed fence renders as plain code and flips to the
visualization when it completes.

**The fallback contract:** every parser (`web/src/lib/viz.ts`) returns `null` for anything it
does not confidently understand → plain highlighted code block. A `VizBoundary` catches renderer
bugs and shows the raw source. A visualizer must never lose content or crash the transcript.
Every rendered card carries a raw toggle (`</>`), so the agent's literal text is always one click
away — the beautifier is presentation, never authority.

## What renders rich

### Automatic (no cooperation needed from the agent)

| Output | Rendering |
|---|---|
| GFM table | Sortable data table: numeric columns detected, right-aligned tabular figures, magnitude bars, copy-as-CSV; lone ✓/✗/yes/no/n-a cells toned (support matrices) |
| Task list `- [x]` | Checklist card with "3 of 5 done" progress line |
| `> [!NOTE]` / TIP / IMPORTANT / WARNING / CAUTION blockquote | Callout aside: tinted ground in the kind's hue, a round glyph, the kind word leading the first sentence |
| ```json fence (object/array; multi-line or a long one-liner) | Collapsible JSON explorer, typed value colors, raw toggle |
| ```diff / ```patch | Syntax-highlighted diff (shiki) |
| Bare fence that looks like `tree` output (`├──`/`└──`) | Collapsible tree with file icons |
| Bare fence that looks like `git diff --stat` | Diffstat card (+/− bars per file) |
| Bare fence that looks like `git log --oneline` | Commit list (hash chips, conventional-commit prefix toned) |
| Bare fence of `KEY=value` lines (`.env`, `export`) | Env panel — secrets masked by key name/shape, per-row reveal, copy |
| Bare fence that is a stack trace (Node, Python, Java, Go, Rust) | Stack card — error headline, app frames in ink, framework frames folded |
| Bare fence of fixed-width columns (`docker ps`, `kubectl get`, `ps`, `df -h`) | Sortable data table |
| Bare fence that is a psql / mysql / boxed grid | Sortable data table |
| Bare fence of comma- or tab-separated rows | Sortable data table |
| Bare fence of `ls -l` / `du -sh` output | File list — kind icons, size bars, total |
| Bare fence of `$ command` lines (comments above) or plain commands | Command card — one copy per command, "Copy all" |
| Bare fence of `label: before → after` lines | Before → after card — delta chip toned by direction, paired bars |
| Bare fence of cron expressions (5 fields or `@daily`) | Schedule card — human description + per-field chips |
| Bare fence that is exactly one URL | URL anatomy — host, path chips, decoded query table |
| Bare fence that is exactly one JWT | Decoded header/payload (never verified), expiry chip |
| Bare fence of `name 1.2.3 → 2.0.0` rows or an `npm outdated` table | Upgrade table, semver jump toned |
| Bare fence of two or more links (bare, `[label](url)`, `label: url`) — or a markdown list of links | Link cards — PR / issue / commit / repo / docs icons, `owner/repo#n` refs |
| Bare fence of `A -> B` edges | Layered graph |
| Bare fence of `key: value` lines (≥3) | Definition panel |
| Bare fence of `label: 72%` / `34/50` lines | Progress bars |
| Bare fence of `label: healthy` status lines | Status chips |
| Bare fence of `GET /path → 200` lines / test summaries / `time \| event` rows / numbered ✓ steps | The matching opt-in block, confirmed by its parser |
| Bare fence of timestamped / levelled log lines | Log viewer with level filters |
| Bare fence of `[section]` + `key = value` | INI panel |
| Indented YAML-looking bare fence, or ```yaml | JSON explorer (YAML subset; anchors/tags stay code) |
| ```toml / ```ini / ```properties | INI panel |
| ```env / ```dotenv | Env panel |
| ```mermaid `graph LR` / `flowchart TD` | Layered graph (node labels replace ids; `-->|label|` edges, `{}` decisions, `(( ))` terminals kept) |
| ```mermaid `sequenceDiagram` | Sequence diagram (same renderer as ```sequence) |
| ```mermaid `stateDiagram` / `classDiagram` / `erDiagram` / `gantt` / `journey` / `pie` / `mindmap` / `timeline` (and flowcharts our parser can't read) | Drawn by mermaid itself, themed from tokens; a render error shows the source as code |
| ```bash / ```sh / ```console with `$` prompts | Command card (scripts without prompts stay code) |
| Markdown list where every item is `Term — detail` / `**Term** detail` (≥3) | Definition grid |
| Markdown list where every item opens with ✅ ❌ ⚠️ ⏳ / PASS / FAIL … | Status list with a tally |
| GFM table with one label column and 1–3 numeric columns (2–12 rows) | Data table with a Table ⇄ Chart switch (bar chart) |
| GFM table with a Severity / Level / Risk / Priority column whose every cell is a severity word | Findings card (ranked, tallied) instead of the data table |
| Ordered list (≥ 4 items, ≤ 220 chars each, no nesting) where at least half the items start with a verb (exits, selects, reads, calls, returns, if, then…) | Procedure — the ```steps walkthrough, inline code chips kept. A list of nouns stays a list |

### Opt-in fences (agents: prefer these when they fit)

- **````chart```** — JSON: `{"type":"bar"|"line"|"area"|"donut"|"sparkline"|"scatter", "title"?,
  "unit"?, "stacked"? (bar only), "labels":[...], "values":[...]}` or
  `"series":[{"name","data":[...]}]` (≤ 8 series — scatter ≤ 3, the palette's all-pairs cap;
  ≤ 60 labels; donut/sparkline single-series). Renders an inline SVG chart with hover tooltips,
  legend, direct value labels.
- **````stats```** — one metric per line: `Label: value | +12% | note`. Delta sign picks the
  good/bad color; suffix `!` flips it for down-is-good metrics (`p95: 210ms | -40ms!`).
  Renders a KPI tile row. Max 8.
- **````tree```** — `tree`-style glyphs, 2-space indentation, or one `a/b/c` path per line;
  annotate after two spaces or ` — `. Renders a collapsible tree.
- **````flow```** — one chain per line: `checkout -> build ✓ -> test ✗`, `deploy …` marks in
  progress. Renders a step pipeline with state chips.
- **````csv``` / ````tsv```** — header + rows. Renders the same sortable data table.
- **````timeline```** — `time | event | note?` per line; event may end ✓ ✗ …. Vertical event rail.
- **````steps``` / ````algorithm``` / ````procedure```** — numbered lines (`1. Install ✓`); ✓ done,
  ✗ failed, … active. When NO step carries a mark it is a **walkthrough** (what a method does, in
  order): every step full-contrast, numbered, no to-do greying. Indented `-` / `•` / `a)` lines
  under a step become nested sub-steps. Vertical wizard.
- **````progress```** — `label: 72%` or `label: 34/50` per line. Labeled progress bars.
- **````kv```** — `key: value` per line. Two-column definition panel (configs, env summaries).
- **````badges```** — `label: state` per line; tone inferred from the state word
  (healthy/degraded/down/running/…). Status chip row.
- **````score```** — `label: 8/10 | note?`. Dot scale (max ≤ 10) or bar.
- **````keys```** — `Ctrl+K: action` per line. Keyboard-shortcut list with real kbd caps.
- **````palette```** — `#hex label?` or `label: #hex` per line. Color swatches.
- **````http```** — `GET /path → 200 OK · 48ms` per line. Request list, status toned by class.
- **````tests```** — `633 passed, 2 failed, 1 skipped in 65s` (or `passed: n` lines), plus
  `✗ failing test name` lines. Verdict strip with proportion bar.
- **````log```** — raw log lines; levels colored, one-click level filters. ≤ 2000 lines.
- **````diffstat```** — git `--stat` rows, numstat, or `path +12 -3`. Changeset card.
- **````commits```** — `git log --oneline` rows. Commit list.
- **````deps```** — `name 1.2.3 → 2.0.0` per line. Upgrade table, semver jump toned.
- **````graph``` / ````dag```** — `A -> B` edges (chains allowed), ≤ 24 nodes, acyclic. Layered
  left→right graph (xyflow canvas, dagre layout; top→bottom when deep and narrow); hover/pin a node to light its upstream and downstream. Code and business
  flow extras: `A -> B: label` or `A -|label|-> B` labels an edge; `{Is open?}` is a decision
  (diamond), `(Start)` / `((End))` a terminal (pill), `[Step]` a plain step. E.g.
  `(Start) -> {Has BPs?} -|yes|-> Select docs -> Read open items -> ((End))` then
  `{Has BPs?} -|no|-> ((End))`.
- **````sequence```** — `Caller -> Callee: message` per line (`->>` same; `-->` / `-->>` = reply,
  drawn dashed; `A -> A: …` = self call). Optional `participant X`, `note over X: text`,
  `loop label` / `alt label` / `else` / `opt label` … `end` brackets. ≤ 8 participants, ≤ 40
  messages. Drawn by mermaid (our parse is re-serialized to `sequenceDiagram`); the hand SVG is the fallback if mermaid fails.
- **````findings``` / ````issues``` / ````risks```** — one per line: `high | where | what`,
  `[medium] where — what`, or `low: what`. Severity words: critical/high/blocker → high,
  medium/moderate/warn → medium, low/minor/nit → low, info/note → info. Sorted by severity,
  glyph + word pill, mono `where` chip, tally footer. A line without a severity → the whole fence
  stays code.
- **````funnel```** — `stage: value` per line, ordered. Funnel bars with conversion %.
- **````gantt``` / ````spans```** — `label | start | end` per line (shared unit). Span chart
  (schedules, request waterfalls).
- **````heatmap```** — JSON `{rows, cols, values[[…]], unit?}`. Sequential single-hue grid.
- **````note``` / ````tip``` / ````important``` / ````warn``` / ````caution``` /
  ````success``` / ````error```** — markdown body. Callout aside (same as `> [!NOTE]` quotes).
- **````compare```** — options for a decision, side by side. `## Name` starts an option;
  `(recommended)` or `★` marks the single pick (accent ring + "Recommended" badge). `+` pro, `-` con,
  `~` or a plain line is a muted note. 2–6 options; text before the first `##`, 1 or 7+ options, or
  two picks → plain code.
- **````annotate```** — code walkthrough. Optional first line `file: path:N` sets the path and start
  line; then the code; then a `---` line (the last one splits); then notes `L42: …` / `42-45: …` in
  file numbering (1-based without a start line). Numbered gutter markers; notes beside the code when
  wide, below when narrow; hovering a note highlights its lines and vice versa. On the box page the
  file header is a code reference (opens the file at the start line). Missing `---`, no code, a
  non-note line after `---`, or no valid notes → plain code.
- **````layers```** — architecture stack: `Layer: item, item` per line, top to bottom, as bands with
  item chips and connectors. 2–10 layers, ≤ 16 items each; a line without `name:` → plain code.

#### Activity cards (something happening right now)

The phone's live-activity grammar (a countdown, a place in line, a trip with an arrival time, a
flight arc, a scoreboard, a reps ring, a wash cycle) for the things an agent reports the same way.
One body shape for all seven: `key: value` lines (≤ 24; a first line with no colon is the
headline; bullets / `**bold**` / `=` are tidied like every colon fence). `title:` is the eyebrow
AND the live-slot name — an agent that re-emits the card with the same title updates it in place
(values roll, tracks tween, the re-emit collapses to an "updated" row). `status:` is the headline;
`note:` a quiet line; every key the kind does not claim becomes a footer fact, in order. The hue is
the machine's state only: live blue while it runs, green once done, red when it expired or failed.
Nothing ticks on its own — a card shows what the agent last said. Parsers:
`web/src/lib/viz-activity.ts`; renderers: `web/src/components/viz/ActivityBlocks.tsx`.

- **````timer``` / ````countdown```** — `left:` or `elapsed:` (the hero), `total:` (gives the bar),
  `started:`, `ends:`. Durations: `2:48`, `1:02:05`, `6h 14m`, `4 min`, `90s`. `left: 0:00` is
  expired: red, "Time's up". Needs one of left / elapsed / total.
- **````queue```** — `position: #12` (or `next`), `of: 40`, `ahead:`, `wait:` (est.), `end: Merge`
  (what the line leads to). Marker on a track that ends in the head-of-line dot; a status that says
  merged / ready / seated rests the marker on the head. Needs a position.
- **````journey``` / ````trip``` / ````delivery```** — `stops: Build, Test, Canary, Production`
  (also `|` or `->`), `progress: Canary` (a stop) or `62%` / `3/5`, `from:` / `to:` without stops,
  `remaining:` (the hero: `2 min`, `1.35 km`), `departed:`, `arrives:`, `by:` (the carrier:
  `freestyle-a · 2 vCPU`). Stops become station dots with labels when ≤ 6. Needs stops, ends or a
  fraction; a `progress` that names no stop → code.
- **````transfer``` / ````flight``` / ````migration```** — `from: VPS`, `to: FS-A` (both required,
  short), `progress: 62%`, `tag:` / `gate:` (a chip in the header), `departed:`, `arrives:`,
  `remaining:`. An arc from foot to foot, drawn solid as far as the fraction, dotted beyond, the
  plane riding it facing the direction of travel.
- **````versus``` / ````match``` / ````scoreboard```** — `score: main 182 - 176 feature`, or `home:
  Harbor 3` + `away: Ridge 2`, or `before: 410ms` + `after: 182ms` (the key names the side when
  the value is bare). `status: live` (the breathing Live pill) or `final` / `done`; `event: GOAL`
  (a chip that fades in when it changes); `clock: 72:35`. Both figures in ink: which side is ahead
  depends on the metric, so the status or event says so.
- **````ring``` / ````counter```** — `value: 3` (inside the ring), `max: 5` (fills the ring; reaching
  it turns green), `time: 0:36` (the hero, labelled elapsed). Needs a value.
- **````stages``` / ````phases``` / ````cycle```** — `stages: Install ✓, Build ✓, Test (40%),
  Package, Publish` (`✓` done, `…` or `(40%)` active) or an unmarked list plus `current: Test` and
  `progress: 3/4`; `remaining: 16 min`. Segmented bars with the active one part-filled (a soft
  full fill when its share is unknown). 2–12 stages; a `current` that names no stage → code.

The card is a 26rem single-hue chart sheet after amicro's Mono Charts (the rules are in
`web/DESIGN.md`, "Round: activity cards"): one flat surface with the title as a mono eyebrow, a
24px bold figure with its unit in mono, a tiny state chip whose dot is the only colour on the
head, and, when the fence gave more than one reading of the same thing, a segmented toggle that
switches the figure between them (timer `left | done`, queue `place | ahead | wait`, journey `to
go | %`, transfer `% | left`, versus `gap | home | away`, ring `count | % | time`, stages `left |
done`); then the chart on a recessed stage, in the state's hue with second series as the same ink
at a lower tier: a bullet row with the label above a 12px track (timer, journey with its stops as
markers, transfer, each pipeline stage), tall pills one per place with the reader's own in ink
(queue), a pyramid of two labelled pills (versus), a wide beaded donut with a two-line centre
(ring), and mono labels on the axis. Hovering a point opens a tooltip card (title, then label /
value rows) for it: the scale or marker under a bullet, a pill's place, a bead's attempt, a side or
a stage; hovering a pyramid pill, a stage row or a bead also swaps the head's figure for that point
until the pointer leaves. Every reading is computed from the fence, nothing is added. The figure's
digits roll on a re-emit, a toggle or a hover, bars and beads tween, pills rise once; nothing
ticks, counts up or glows.

Fixture: `node .shots/viz-activity.mjs [--dark] [--live [--video] [--frames [--slow]]]` renders every
card in a real thread over Vite (`.shots/out/viz-activity*.png`); `--live` streams a second version
of each and asserts the cards updated in place rather than stacking. `node
.shots/viz-activity-interact.mjs [--dark]` drives the tooltips, the timer's toggle and the row and
bead hovers that take the head over, printing the head and tooltip text at each step, at 2x
(`.shots/out/viz-activity-ix-*.png`).

### Prose upgrades (no fence)

- A list whose every item (≥ 2) is `label: NN%` or `label: a/b` → the progress block.
- A GFM table → the sortable DataTable when it has ≥ 3 body rows, or 2 rows with a numeric
  column; a two-row table of words stays a plain table. Gates: `web/src/lib/viz-tool-output.ts`.

### Code references (box page)

Inline code that is a path, optionally with a line, becomes a link that opens the file in the
workspace pane, scrolled to the line with a brief highlight: `web/src/lib/viz.ts`, `viz.ts:42`,
`src/x.ts:10-20`, `src/x.ts#L42`. Markdown links with a relative-path href
(`[parseDag](web/src/lib/viz-extra.ts:515)`) do the same instead of opening a new tab. Once a
message ties a name to a location (`[name](path:line)`, `` `name` (`path:line`) `` or
`` `name` in `path:line` ``), later `` `name` `` mentions in that message link too. A ref links only
when it matches a real file in the box tree (`/tree.json`, fetched once per box); a short path
links only on a unique suffix match. URLs, text with spaces, bare words and versions (`1.2.3`) are
never refs. Off the box page everything renders as before. Parsing: `web/src/lib/code-refs.ts`;
UI: `web/src/components/ui/code-ref.tsx`; editor reveal: `CodeEditor` `reveal` prop.

### Live (streaming)

Fences draw while they stream instead of swapping in when the closing ``` arrives:

- `web/src/lib/markdown-stream.ts` (`splitOpenFence`) tags a still-open fence `<lang>__open`, so
  the router (`smartBlock(lang, code, { open: true })`) knows the block is incomplete.
- Partial parsing lives in `web/src/lib/viz-stream.ts`: line-oriented fences parse only
  `completeLines` (the half-written last line is held back); JSON fences (`chart`, `json`) go
  through `repairPartialJson`, which closes the prefix after its last finished value. A chart in
  partial mode trims every series to the shortest array, so a bar never pairs with a label that
  has not arrived.
- Until anything parses, `VizSkeleton` (viz/VizFrame.tsx) holds the space. A value is never shown
  before it is complete — a number still being typed is not drawn as a smaller number.
- Callouts render their markdown live; other open fences stay code.

### Live updates (re-emitted blocks)

An agent looping "tail → summarise" re-emits the same block. Within one run (until the next
operator message) a visual fence with the same identity is ONE block (`web/src/lib/viz-identity.ts`,
`web/src/components/viz/live-blocks.tsx`):

- Identity = language + name: ```` ```stats id=traffic ```` (or `title="…"`), a chart's JSON
  `title`, or a heading / bold-only line directly above the fence. Untitled fences never merge.
- The latest COMPLETE version renders at the first occurrence (the live slot), so the mounted
  visual gets new props and values roll instead of remounting. A version still streaming never
  replaces a complete one.
- Later occurrences collapse to a one-line row ("Backend traffic · updated 2× · last 10:02:13",
  `↑ view` jumps to the slot); expanding it shows that version's raw text. The naming heading
  folds into the row.
- The slot's header shows a `--live` dot while the run works, then "updated Ns ago".
- Why the first position: the block never moves (no remount, no portal), and each new version
  adds one short row at the bottom instead of a full block, so the scroll-hold behaviour is kept.

### Tool output

A finished tool's printed output (shell commands and file-reading steps in the trace,
`thread/TraceItems.tsx`) goes through the same router: whole-output JSON → `smartBlock("json")`,
anything else → `smartBlock("", output)` (the `sniffBare` path above — CSV/TSV/fixed-width and
boxed tables, `git log` commits, `ls -l` file lists, diffstat, http, stack traces, env, …). When a
shape is recognised it shows drawn with a small **Visual / Raw** switch (Visual by default; Raw is
the colored terminal panel), like test runs and `TestResultsCard`. Never while the tool is still
running, and only for output ≤ 200 lines / 20 KB (`toolOutputLanguage` in
`web/src/lib/viz-tool-output.ts`) — bigger dumps stay raw.

### Guidance for the agent (also injected via the system prompts in `src/drivers/prompts.ts`)

When presenting results (not code): tabular facts → a GFM table; progress → a task list or
`label: NN%` items; a distribution/comparison/trend worth seeing → a ```chart fence; headline
metrics → ```stats; file layout → ```tree; a pipeline outcome → ```flow. To update a block,
re-emit it with the new values. Never force one — plain prose beats a mis-shaped visualization,
and malformed fences just render as code.

**Explaining code or a process — unprompted.** The 2026-10-05 review of a box thread (an agent
walking through an ABAP method: a numbered "what it does", a severity-ranked bug table, a call
chain in prose) rendered nothing rich even though every part had a shape. The prompt now tells the
agent to draw these without being asked, and the console upgrades the prose forms too:

| The agent is explaining… | Emit | Falls back to |
|---|---|---|
| Call chain, control flow, data flow, a business process | ```graph with `{decision}` nodes and `-|label|->` edges (or a mermaid flowchart) | — |
| Who calls whom, in what order, with what reply | ```sequence (or mermaid `sequenceDiagram`) | — |
| What a method / algorithm / job does, step by step | ```steps with no marks (a walkthrough) | A plain ordered list of verb-first items is auto-upgraded |
| Bugs, risks, review results, ranked | ```findings `high \| where \| what` | A GFM table with a Severity column is auto-upgraded |
| Which paths are dead / wasteful | ```findings with `low` / `info` rows, or a status list (❌/⚠️ items) | — |
| Choosing between options, a design decision | ```compare `## Option (recommended)` + `+ pro` / `- con` | — |
| A specific piece of code, line by line | ```annotate `file: path:N`, code, `---`, `L42: why` | — |
| Architecture, tiers, what lives where | ```layers `Tier: a, b` | — |
| Any file, line or symbol | Inline code `path:line`; link the first symbol mention `[name](path:line)` | Plain inline code when unresolved |

### Watch mode (a monitoring loop the operator stops)

When asked to keep watching/listening/monitoring something, the agent (prompted in
`src/drivers/prompts.ts`) puts an invisible marker in its first reply and loops until stopped:

```
<!-- watch: backend logs | every 30s -->   start, or resume after a message (re-emit it)
<!-- watch: end -->                        the operator's stated duration ran out
Watch paused — say continue to keep watching.   (line) the ~1h run cap is near
```

An HTML comment because react-markdown drops raw HTML: nothing extra shows in the transcript, other
renderers (mobile, Markdown export) ignore it, and it cannot be confused with a real fence or prose.
Each loop step is ONE bounded poll (`timeout 30 tail -n 200 -f app.log`, `sleep 30; curl …`, never
an unbounded `tail -f`), then the SAME titled block re-emitted (stable title or ```stats id=<name>),
with a one-line narration only when something notable changes.

`web/src/lib/watch.ts` (`deriveWatch`, tested in `test/watch.test.ts`) reads the parsed trace: the
latest marker not followed by an operator message is the current watch; every later agent reply
carrying a fence counts as an update. `WatchPill` (in `RunPill.tsx`) shows "Watching <target> ·
N updates · 3m" with a live-blue breathing dot (not amber — nothing needs action) and a Stop button that
POSTs `/interrupt.json` (kills the turn, keeps the session; exit 253). After that the run pill reads
"Stopped watching <target> · N updates · 12m" and the last block stays where it was.
**Partial output while a call runs.** Claude background shells stream through their output file. omp streams through `tool_execution_update`: the formatter in `src/drivers/omp.ts` sends complete new lines at most once a second, as `  ⟦#id⟧ ⟦…⟧ lines` (or `⟦…!⟧` to replace the whole partial text when it did not just grow). `src/trace.ts` marks the call `streaming` until the final id-stamped result replaces the chunks. omp's `eval`/`python`/`js` render as shell items, so they get the live view too. The prompt still asks for ONE poll cycle per tool call, because a loop inside one call delays the summary block until the call returns.

**Smoothness.** The live log follows its tail with a short eased glide, not a jump, and skips the glide under reduced motion or when far behind. Rows fade out under the counter strip, and a status-mix bar (2xx/3xx/4xx/5xx) resizes smoothly as calls arrive. A 5xx or error row that arrives while you watch gets one red wash that fades. Earlier runs of a command that runs again later (each poll of a watch) fold to one line (`PollRow`), so only the newest run keeps the full view. HTML comments such as the watch marker never render as prose. The Watching pill and the Working line share one row.

**Reference pass (2026-10-01).** Patterns borrowed from Rare UI (animated counter), Cult UI (rolling number, dynamic island), Emil Kowalski's rules and Vercel/Linear log feeds: counters are per-digit odometers (`Odometer` in `viz/motion.tsx`, CSS-content digits so the DOM text stays the real value); live-log tail rows fade in (opacity only since 2026-11-15: a feed that keeps appending should not make the eye chase sliding rows); status badges only transition colour; the "N new" chip jumps instantly (a deliberate action) while auto-follow glides; the Watching pill morphs its width with a layout spring, rolls its update count, blur-crossfades the elapsed time, says "fetching…" with a slow shimmer while a poll is in flight, and carries a hairline sweep that fills linearly over the poll interval as the next-poll clock; Stop presses to 0.97.


## Design rules (for anyone adding or touching a visualizer)

Grounded in the dataviz skill's method, Refactoring UI, better-ui/emil-design-eng craft notes,
and the console's own `web/DESIGN.md` — which always wins on tokens and voice.

1. **Series colors are `--viz-1…8` (`web/src/index.css`), assigned in fixed slot order, never
   cycled.** The palette is CVD-validated per mode (light and dark are separately stepped, not
   flipped). Three light slots sit under 3:1 contrast → charts must carry direct value labels or
   a table/raw view. More than 8 series: fold to "Other", never invent a hue.
2. **State never rides on color alone.** ✓/✗/pulse glyphs accompany ok/fail/active; deltas get
   trend arrows; text wears text tokens (`--foreground`/`--muted-foreground`), never series color.
3. **One axis, thin marks, recessive grid** (`--viz-grid` hairlines), 4px-capped rounded
   data-ends anchored to the baseline, 2px gaps between adjacent fills, selective direct labels
   (never a number on every mark of a dense chart), a legend whenever ≥ 2 series.
4. **Motion is one-shot and precise**: draw-in ≤ 600ms on `cubic-bezier(0.2, 0, 0, 1)`
   (`--viz-ease`), never looped, never re-triggered by streaming re-renders; `prefers-reduced-motion`
   renders static (the global rule zeroes durations — keep animations in CSS classes so it applies).
   One vocabulary (index.css, "viz motion vocabulary"): rows rise 4px + fade (`viz-in` on first
   paint, `viz-row-new` for streamed rows; 32ms stagger capped at 10 / 8); marks draw their stroke
   once (`viz-check`) or sharpen from 0.25 + 4px blur (`viz-mark`); bars grow once on first paint
   (`viz-grow-x`, `viz-rail` for timeline rails) and afterwards only tween width; folds open
   0fr → 1fr + fade (`viz-fold`) and close instantly (unmount); chevrons rotate; icon state changes
   cross-fade with both icons mounted (`IconSwap`); raw ⇄ visual cross-fades through 2px blur
   (`viz-swap`); tooltips appear once from 0.96 at the side nearest the point (`viz-tip`, 125ms) and
   then track; hover bands and crosshairs follow at 60ms linear. Hover/sort/filter feedback is
   ≤ 150ms colour/opacity; keyboard actions never animate; nothing animates `transition: all`;
   keyframes animate `translate`/`scale` (not `transform`) with `backwards` fill so motion's FLIP
   (DataTable reorders, ≤ 60 rows) and Tailwind translates are never overridden.
5. **Cards are quiet**: `bg-card` + hairline border (one elevation cue — border or shadow, never
   both), `rounded-xl`, an 8-height header strip with title, copy, the raw toggle, and a maximize
   button (`VizFrame`) that opens the block in a ~96vw×92vh dialog with zoom (buttons, `+`/`-`/`0`,
   Ctrl/⌘+wheel, drag to pan; graphs use their own interactive canvas). Concentric radii: inner = outer − padding
   (inset surfaces — stat tiles, link cards, compare columns, layer bands — sit 6px in with 6px corners).
   Header controls are 28px (`VIZ_ICON_BUTTON`), quiet until the card is hovered/focused on a fine
   pointer, press to 0.96. Chips share one recipe (`viz/tone.tsx` `Pill`, `.viz-tone`): a few percent
   of the hue as ground, a same-hue hairline, the hue's text token as ink — the callout at chip size,
   never a saturated fill or a side bar. List rows divide with `border-border/60` hairlines; definition
   panels (kv, env, jwt, ini) do not. One empty state (`VizEmpty`), one filter row (`VizSearch`), one
   header counter style (`count()` → "5 requests").
6. **Hover layer by default**: per-mark tooltips with hit targets bigger than the mark
   (transparent ≥ 8px circles over 2px lines).
7. **Numbers**: `tabular-nums` on every number that sits in a column or changes in place —
   tables, deltas, counters, and stat-tile values (they roll on live updates; proportional figures
   made the tile row jitter mid-roll).
8. **Charts are pure SVG + tokens; diagrams use libraries.** Charts, bars and tiles stay hand-drawn
   SVG (zero bundle cost, live theme following). Diagrams use `@xyflow/react` + `@dagrejs/dagre`
   (graphs) and `mermaid` (sequence and every other mermaid kind) — always lazy-loaded into their
   own chunks, themed from the CSS tokens (`--xy-*` overrides; mermaid `themeVariables` read from
   computed tokens, re-rendered on theme change).
9. **Degrade, never break**: bound input sizes in the parser, return `null` on anything odd,
   keep the raw source reachable.

## References

- Bundled **dataviz skill** — the chart method: form first, color by job, validate the palette
  (`scripts/validate_palette.js`), mark specs, interaction, anti-patterns. Re-run the validator
  if `--viz-*` values ever change.
- [better-ui](https://www.skills.sh/jakubkrehel/skills/better-ui) — concentric radii, optical
  alignment, exact easing values.
- [emil-design-eng](https://www.skills.sh/emilkowalski/skills/emil-design-eng) — craft/details
  compound; reverse-engineer interfaces that feel right.
- [refactoring-ui-plugin](https://github.com/gnurio/refactoring-ui-plugin) — hierarchy,
  systematic spacing/type/color scales, de-noising.
- [Opus 5.5 motion graphics](https://charliehills.substack.com/p/opus-55-motion-graphics) —
  morph/reveal/loop techniques; specify exact states + iterate.
- User's UX inspiration list: 60fps.design, loadmo.re, rareui.com (see memory
  `ux-reference-sites`).
