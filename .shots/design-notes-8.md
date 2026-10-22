## Round: the app shell (2026-10-22)

The frame around the work: the sidebar's machine list, the Hub's "Live now" and "Recent runs", the History page's activity card, filters and table, and the button primitive every one of them is built from. Subtraction first; the two things added (a press and a strip) are each one rule.

### What was subtracted

- **A header-measurement bug, not a column.** Both Hub and History tables ran past their cards (History 882px in an 834px card; the Hub's "Tokens" header read "T…"). The width model measured each header's *cell* at max-content as the column's floor, and at max-content a cell is as wide as the column's widest row, so the flexible "Run" column's floor was the length of its longest title. The floor is now the header's own footprint (label, sort icon, padding; `labelWidth` in `lib/column-widths.ts`). Hub 494/622, History 771/834, no declared width touched to get there. "Duration" became "Took" and "Archived" became "When": shorter words, same meaning, narrower floors.
- **Three ways to say a state.** The sidebar drew a coloured initial tile, a braille spinner for working rows, a pinging dot for waiting ones and a bare word for the rest; the Hub drew icon+word stamps in a fourth style. One vocabulary now (`stateWord` in MachineList: Working, Needs you, Done, Failed, Asleep, Idle, Stalled) rendered one way everywhere: `StatusDot`, a 6px dot and a word. The sidebar's tile, spinner and tone tables are gone (−60 lines). Rows are 36px with 8px hover surfaces.
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
