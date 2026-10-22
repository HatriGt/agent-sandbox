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
