# Output visualizers — how agent output gets beautiful

The chat transcript upgrades structured agent output into rich, interactive components
automatically. This file is the contract: what the console renders, what an agent (the sandboxed
Claude, or Claude working on this repo) should emit to get the rich rendering, and the design
rules any new visualizer must follow. **Read this before adding a visualizer or changing how the
agent formats results.**

## Where it plugs in

One integration point: `web/src/components/ui/markdown.tsx` routes fenced blocks through
`web/src/components/viz/SmartBlock.tsx` and upgrades GFM tables and task lists. Every surface
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

### Guidance for the agent (also injected via `AGENT_SYS_PROMPT` in `src/msb.ts`)

When presenting results (not code): tabular facts → a GFM table; progress → a task list; a
distribution/comparison/trend worth seeing → a ```chart fence; headline metrics → ```stats;
file layout → ```tree; a pipeline outcome → ```flow. Never force one — plain prose beats a
mis-shaped visualization, and malformed fences just render as code.

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
