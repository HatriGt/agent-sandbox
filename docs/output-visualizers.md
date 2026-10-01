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
| `> [!NOTE]` / TIP / IMPORTANT / WARNING / CAUTION blockquote | Callout card with icon + named kind |
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
| ```mermaid `graph LR` / `flowchart TD` | Layered graph (node labels replace ids) |
| ```bash / ```sh / ```console with `$` prompts | Command card (scripts without prompts stay code) |
| Markdown list where every item is `Term — detail` / `**Term** detail` (≥3) | Definition grid |
| Markdown list where every item opens with ✅ ❌ ⚠️ ⏳ / PASS / FAIL … | Status list with a tally |
| GFM table with one label column and 1–3 numeric columns (2–12 rows) | Data table with a Table ⇄ Chart switch (bar chart) |

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
- **````steps```** — numbered lines (`1. Install ✓`), indented detail lines under a step;
  ✓ done, ✗ failed, … active. Vertical wizard.
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
- **````graph``` / ````dag```** — `A -> B` edges (chains allowed), ≤ 24 nodes, acyclic.
  Layered left→right SVG graph.
- **````funnel```** — `stage: value` per line, ordered. Funnel bars with conversion %.
- **````gantt``` / ````spans```** — `label | start | end` per line (shared unit). Span chart
  (schedules, request waterfalls).
- **````heatmap```** — JSON `{rows, cols, values[[…]], unit?}`. Sequential single-hue grid.
- **````note``` / ````tip``` / ````important``` / ````warn``` / ````caution``` /
  ````success``` / ````error```** — markdown body. Callout card (same as `> [!NOTE]` quotes).

### Prose upgrades (no fence)

- A list whose every item (≥ 2) is `label: NN%` or `label: a/b` → the progress block.
- A GFM table → the sortable DataTable when it has ≥ 3 body rows, or 2 rows with a numeric
  column; a two-row table of words stays a plain table. Gates: `web/src/lib/viz-tool-output.ts`.

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

### Tool output

A finished tool's printed output (shell commands and file-reading steps in the trace,
`thread/TraceItems.tsx`) goes through the same router: whole-output JSON → `smartBlock("json")`,
anything else → `smartBlock("", output)` (the `sniffBare` path above — CSV/TSV/fixed-width and
boxed tables, `git log` commits, `ls -l` file lists, diffstat, http, stack traces, env, …). When a
shape is recognised it shows drawn with a small **Visual / Raw** switch (Visual by default; Raw is
the colored terminal panel), like test runs and `TestResultsCard`. Never while the tool is still
running, and only for output ≤ 200 lines / 20 KB (`toolOutputLanguage` in
`web/src/lib/viz-tool-output.ts`) — bigger dumps stay raw.

### Guidance for the agent (also injected via `AGENT_SYS_PROMPT` in `src/msb.ts`)

When presenting results (not code): tabular facts → a GFM table; progress → a task list or
`label: NN%` items; a distribution/comparison/trend worth seeing → a ```chart fence; headline
metrics → ```stats; file layout → ```tree; a pipeline outcome → ```flow. To update a block,
re-emit it with the new values. Never force one — plain prose beats a mis-shaped visualization,
and malformed fences just render as code.

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
N updates · 3m" with a live-blue breathing dot (not amber — nothing needs you) and a Stop button that
POSTs `/interrupt.json` (kills the turn, keeps the session; exit 253). After that the run pill reads
"Stopped watching <target> · N updates · 12m" and the last block stays where it was.

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
4. **Motion is one-shot and precise**: draw-in ≤ 600ms on `cubic-bezier(0.2, 0, 0, 1)`, never
   looped, never re-triggered by streaming re-renders; `prefers-reduced-motion` renders static
   (the global rule zeroes durations — keep animations in CSS classes so it applies).
5. **Cards are quiet**: `bg-card` + hairline border (one elevation cue — border or shadow, never
   both), `rounded-xl`, an 8-height header strip with title, copy, and the raw toggle
   (`VizFrame`). Concentric radii: inner = outer − padding.
6. **Hover layer by default**: per-mark tooltips with hit targets bigger than the mark
   (transparent ≥ 8px circles over 2px lines).
7. **Numbers**: `tabular-nums` only where columns must align (tables, deltas); hero values in
   stat tiles stay proportional.
8. **Pure SVG + tokens, no chart library.** Zero bundle cost, live theme following.
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
