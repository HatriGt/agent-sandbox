# Design notes, round 6

## Workspace chrome, by subtraction

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
