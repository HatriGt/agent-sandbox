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
- **Composer (`SendBar`)** — one input, the agent is the primary destination and is *always*
  sendable: mid-turn messages queue ("Queue for agent", clock icon) instead of being refused. The
  secondary chip is **Side question**. `@` (or the @ button) opens `MentionMenu` — the workspace file
  list from `/files.json`, narrowed as you type, ↑/↓/Enter/Tab/Esc; mentions expand to
  `/workspace/<path>` references in the message. Dashed border in side-question mode.

## Sending

The composer echoes a message the instant Enter is pressed (withdrawn only if delivery fails); the
controller kicks the run detached instead of waiting for the agent's next boundary. Every new turn
enters with the same short rise; the state pill crossfades on change.

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
