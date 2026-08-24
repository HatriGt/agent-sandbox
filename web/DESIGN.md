# agent-sandbox — Style Reference

> **Cloned inch-by-inch from the [CRM AI Agent reference](https://crm-ai-agent-tau.vercel.app/)**
> (assistant "Rune"), studied *live in a browser* at 1440×900 and measured via `getComputedStyle`. We
> mirror its exact chrome, layout, typography, colours, radii and component shapes, mapped onto our
> domain: a console for delegating coding tasks to ephemeral microVM sandboxes running the Claude Code
> agent. We clone the reference's *look and feel* but NOT its concepts: there are no CRM nav items
> (Balances/Customers/Contracts), no fake multi-workspace switcher, and no fabricated agent roster.
> Every region shows real product data.
>
> Built on **shadcn (neutral base) + prompt-kit + Inter/Hedvig/Geist Mono**. The chat surface — the
> product's core — is composed from prompt-kit's purpose-built AI-chat components (ChatContainer,
> PromptInput, Steps, Tool, Markdown, ScrollButton) rather than hand-rolled bubbles. The shell of the
> console (sidebar, Sandboxes table, command palette) shares the same token base. Run STATE is the
> loudest signal; geometry is the reference's; nothing is bespoke where a proven part exists.

**Theme:** dual — **zinc-on-white light is the default and primary target** (the reference is light);
dark is a coherent zinc charcoal version of the same feel. Toggled by a `dark` class on `<html>`.

## Extracted reference spec (measured live via getComputedStyle @ 1440×900)

The reference renders **light** when the OS prefers light (it follows `prefers-color-scheme`; we
forced light via CDP `Emulation.setEmulatedMedia` to measure the intended primary theme).

| Property | Measured value |
|---|---|
| Body / UI font | **Inter** (`font-family: Inter, …`), 14px body |
| Greeting font | **Hedvig Letters Serif** (serif display), ~30px, weight 400 |
| Mono | none distinct in reference (we keep Geist Mono for machine text) |
| Canvas / page bg | pure white `rgb(255 255 255)` |
| Sidebar bg | white, separated by a single hairline `border-r` (no float, no gap) |
| Card / panel bg | white |
| Border / hairline | zinc `~rgb(228 228 231)` (very low chroma, cool) |
| Primary text | near-black zinc `~rgb(24 24 27)` |
| Muted / nav-inactive text | zinc `~rgb(113 113 122)` |
| Accent (active nav fill) | subtle zinc surface fill, not a saturated hue |
| Sidebar width | ~208–224px (we use 208px / `13rem`) |
| Radii | tight **6–8px** on cards, nav rows, chips, search pill (`rounded-md`) |
| Layout | **flat two-column**: `border-r` sidebar + white content, no floating cards |
| Hero | **left-aligned** serif greeting → subtitle → composer → skill-chip row |
| Composer | single rounded surface, controls on bottom row |

## Mapping the reference onto our domain

| Reference region | Our surface |
|---|---|
| Workspace switcher | Brand/identity header for **agent-sandbox** (icon + name + live status). No fake workspaces. |
| Search ⌘K pill | Search pill wired to the **CommandPalette** (⌘K), which searches machines by task. |
| Left nav (Home/Inbox/…) | **Chat** and **Sandboxes** — the two real destinations. No invented CRM items. |
| Sidebar chat/agent list | **MachineList** — live sandbox machines: state + task + short-name + uptime. |
| Center hero empty state | **Hub** — time-aware greeting, assistant-voice subtitle, delegate composer, starter chips, previous runs. |
| Center chat state | **Thread** — breadcrumb (Agent / machine / task), agent prose, "N tools used" pills, clarifying-question-with-buttons, artifacts, vitals in the header. |
| Right agent-roster panel | **Omitted** — our data has no roster; forcing a third column would mean fake content. Two-column shell keeps the faithful feel. |

## Foundation

The colour system is a **cool zinc-on-white light theme** (near-zero chroma, cool hue ~275) matching
the reference's near-monochrome palette: white sidebar and content separated by a hairline, colour
reserved for the single accent and functional state hues. Defined once in `index.css` under `:root`
(light) and `.dark`. There is no runtime theme provider — the `useTheme` hook in `App.tsx` toggles the
`dark` class on `document.documentElement` and persists to `localStorage`. Tailwind v4 reads the
tokens through `@theme inline`.

### Key patterns cloned from the reference

- **Flat shell** — the sidebar is a flat white column separated from the content by a single
  `border-r` hairline (no float, no gap, no elevation), exactly like the reference.
- **"N tools used" pill** (`ToolGroup`) — consecutive tool calls fold into one summary pill that
  expands to the individual terminal panels / tool rows.
- **Clarifying-question-with-buttons** (`AskingItem`) — when the agent halts with a question that
  contains inline options (`[Acme Corp] [New Acme Corp]` or a `1) … 2) …` list), those render as
  one-click answer buttons that release the run; otherwise the free-text reply below is used.
- **Breadcrumb** — the thread header carries an `Agent / <machine> / <task>` trail.

Two layers sit on top:

- **prompt-kit components** (`src/components/ui/{chat-container,prompt-input,steps,tool,message,`
  `reasoning,scroll-button,markdown,code-block}.tsx`) install as standard shadcn and read the same
  `--background / --foreground / --primary / --muted …` contract, so the chat surface and the rest of
  the app are one system. Installed via `npx shadcn add https://prompt-kit.com/c/<name>.json`.
- **an app vocabulary** (`--azure` → primary, `--ink` → foreground, `--ash` → muted-foreground,
  `--trace` for the terminal ground, plus functional status hues `--attention` / `--ok`) *derived*
  from the shadcn tokens in `@theme inline`, so existing components inherit the base with no per-line
  edits. A handful of legacy raw-var aliases (`--surface`, `--canvas`, `--line`, `--accent-text`) map
  onto the shadcn tokens for the same reason.

### Chat surface (prompt-kit)

- **Conversation column** — `ChatContainerRoot / ChatContainerContent / ChatContainerScrollAnchor`
  (built on `use-stick-to-bottom`) owns anchoring: it sticks to the newest turn, yields when the reader
  scrolls up, and a `ScrollButton` floats in to jump back down.
- **Composer** — both the Hub "new machine" box and the Thread `SendBar` are prompt-kit `PromptInput`
  (autosizing textarea, Enter-to-send, `PromptInputActions`). SendBar keeps the reply/ask segmented
  control on top so the two destinations stay unambiguous.
- **Agent prose** renders through prompt-kit `Markdown` (+ `CodeBlock`) at 16px full-measure, no bubble.
- **Tool output** — shell commands render as a terminal panel on the `--trace` ground (`$ cmd` + folded
  output); other tools are compact rows with the argument in a code chip. prompt-kit's `Tool` and
  `Steps` primitives are available for richer structured-tool rendering.

## Tokens — Colors (oklch, defined in `index.css`)

The base is the shadcn semantic contract (`--background/--foreground/--primary/--muted/--border/…`);
the app vocabulary below is *derived* from it in `@theme inline` so existing components inherit the
base with no per-line edits. Light values shown; `.dark` swaps the same names.

| Semantic var | Light value / maps to | Role |
|---|---|---|
| `--background` / `--canvas` | `oklch(0.975 0.003 95)` | Warm-neutral page field the cards float on. |
| `--card` / `--raised` | `oklch(1 0 0)` | White floating panels, cards, popovers. |
| `--surface` | `oklch(0.968 0.003 95)` | Hover / active rows, inset pills. |
| `--foreground` / `--ink` | `oklch(0.24 0.008 275)` | Primary text. |
| `--muted-foreground` / `--ash` | `oklch(0.52 0.008 275)` | Secondary text (AA on card/canvas). |
| `--border` / `--line` | `oklch(0.915 0.004 95)` | Hairlines. `--line-strong` for hover borders. |
| `--primary` / `--azure` | `oklch(0.46 0.11 272)` | THE action fill (buttons, primary CTA). |
| `--accent-fg` | `--primary-foreground` | Text on the accent fill. |
| `--accent` / `--accent-foreground` | soft neutral / slate-indigo | Active nav, selected rows, agent avatar. |
| `--azure-text` | `--primary` | Accent as text/icon/state (working), focus ring. |
| `--danger` | `oklch(0.577 0.222 27.3)` | Destroy + non-zero exit. |
| `--attention` / `--attention-text` | amber | Needs-you (the one state with a deadline). |
| `--ok` | green | Completed / healthy; the `$` shell prompt glyph. |
| `--trace` / `--trace-fg` | dark ground / light text | Terminal panels — **verified legible in BOTH themes** (light text on dark ground in both). |

State is the one exception to "one accent": working (accent), needs-you (amber), done (slate), error
(red) each carry a functional hue, but **always** with a glyph + word (see `stamp.tsx`) so colour is
never the sole carrier.

## Typography — Inter + Hedvig Letters Serif (the reference's exact faces)

Both are freely available and self-hosted via fontsource (no Google Fonts request, no FOUT,
offline-correct):

- **Inter Variable** (sans) — the single UI/body face, matching the reference's measured
  `font-family: Inter`. Via `@fontsource-variable/inter`.
- **Hedvig Letters Serif** — the greeting/display serif, matching the reference's hero. Via
  `@fontsource/hedvig-letters-serif`. Used through `font-serif` on the Hub greeting.
- **Geist Mono Variable** — machine text only (identifiers, vitals, tool calls, log output, stamps).
  The reference has no distinct mono face; we keep Geist Mono because the product needs one.

Wired in `main.tsx` (self-hosted) and set as `--font-sans` / `--font-serif` / `--font-mono` in the
`@theme inline` block.

### Type Scale (matched to the reference)

| Role | Size | Line height |
|---|---|---|
| stamp | 10.5px | 1.2 (0.06em, uppercase, mono) |
| micro | 11px | 1.4 |
| meta | 13px | 1.5 |
| body | 14px | 1.5 |
| prose (agent output, read) | 15px | 1.65 |
| h3 | 16px | 1.4 |
| h2 | 20px | 1.4 |
| h1 (greeting) | 30px | 1.2 (**serif**, weight 400) |
| display | 30px | 1.2 |

The greeting is the one place type steps up into the serif face at 30px/400, exactly as the reference.

## Shapes — tight radii (reference feel)

The reference uses **6–8px** corners throughout. Cards, nav items, chips, the Search pill and "New
task" button all use `rounded-md`; the composer uses `rounded-xl`. Only genuinely round things (live
dot, avatars, send button) use `--radius-pill`. No `rounded-2xl` floating-card treatment — the shell
is flat with a hairline `border-r`.

## Motion

One authored animation: the live indicator `breathe`. Everything else is CSS hover/transition. All
motion collapses under `prefers-reduced-motion: reduce`.

## Accessibility

- Contrast: text tiers (`--foreground`, `--muted-foreground`) and the accent-as-text (`--azure-text`
  → `--primary`) are tuned to read AA against card/canvas in both light and dark.
- Touch targets: a global `@media (pointer: coarse)` rule floors interactive elements at 44px without
  inflating desktop density.
- Focus: a visible 2px `--accent-text` ring on `:focus-visible`.

---

## Chat experience pass — "feel like Claude Code on web"

A quality pass on the conversation EXPERIENCE (not a layout change). Audited live against the
Claude-Code-web bar while streaming real tasks (research prose, shell-heavy, table+code, multi-turn).

### Audit findings (gaps vs the bar)

| # | Gap | Evidence (live) |
|---|---|---|
| 1 | **No progressive reveal.** Source is a 3s-polled `.agent.log`, so a completed block pops in whole. There is no smooth typewriter/fade cadence on the newest text. | A ~600-word report appeared in one paint on poll tick. |
| 2 | **No "working…" indicator** between outputs or while a tool runs. Only signal is a `breathe` dot on the last say's avatar + the header stamp. | Between the last prose line and the next tool there is dead air. |
| 3 | **Tools have no running-vs-finished state.** A running tool row looks identical to a finished one. | `ToolItem`/`ShellItem` render the same regardless of run state. |
| 4 | **No message-enter motion.** New turns/blocks appear with no easing — feels like a log repaint. | Blocks snap in. |
| 5 | **Perf: index keys + whole-list rebuild.** `groups.map((g,i) => key={i})` risks remounts; every poll rebuilds the array. Markdown is memoized by content (good), say/tool rows are not. | Re-render per 3s poll of the entire trace. |

### Plan (highest-leverage first)

1. **Streaming reveal on the newest tail only** — a `StreamingText` built on prompt-kit `ResponseStream`
   reveals the last in-progress `say` block with a typewriter cadence, then renders finished text as
   static Markdown. Keyed by content so a re-poll of already-shown text does NOT re-animate; only the
   genuinely-new tail streams. Completed history stays static (no per-poll animation → no jank).
2. **Working indicator** — a `WorkingIndicator` (pulsing dots + "working…") shown while `runState`
   is `running` and the trailing event is a tool / there is no fresh prose, so there is always a clear
   "the agent is doing something" beat that resolves on completion.
3. **Running-vs-finished tools** — a tool with no result while the run is live renders with a spinner +
   "running" tint; a finished tool keeps the calm style.
4. **Tasteful motion** — a single reusable `.enter` keyframe (fade+rise) on new turns and smooth tool
   expand. All gated by `prefers-reduced-motion`.
5. **Perf** — stable content-derived keys, memoized `SayItem`/tool group, reveal state keyed by content.

Library note: prefer prompt-kit's vendored `ResponseStream` over adding framer-motion — the motion is
small and CSS keyframes cover it, so **no new dependency**.

## Real streaming — SSE replaces the 3s client poll

The client-simulated reveal (above) made *completed* text arrive smoothly, but the DATA still landed
on a 3s poll. This pass makes the data itself live: agent output now reaches the browser sub-second.

### Why SSE + server-side fast-tail (not `tail -f` over SSH, not WebSocket)

The box never pushes to the controller — the in-box agent writes NDJSON that a formatter turns into
`/workspace/.agent.log`, which the controller reads over a multiplexed SSH channel (`gatherWatch`).
So "live" = the CONTROLLER tails fast and pushes deltas to browsers. SSE fits perfectly: one-way,
text, auto-reconnecting, works through Traefik, no extra protocol. A streamed `tail -f` over SSH
would spawn one long-lived remote process per viewer (leak risk on disconnect); instead each viewer
runs one bounded `setTimeout` loop calling the existing `gatherWatch` every **800ms**, reusing the
SSH mux — no new processes, and it stops the instant the client disconnects.

### Endpoint — `GET /watch.sse?session=<id>&token=<t>&from=<offset>`

- **Auth**: token via `?token=` (EventSource can't set headers), checked by the same `dashAuthed`
  as every other data route. 401 without it — fail-closed. Tokens are never logged.
- **Frames** (`src/watch-sse.ts`, pure/unit-tested delta math):
  - `snapshot` — meta (state/vitals) + full log from the requested offset (first frame).
  - `append` — only the new tail bytes since the client's offset (the common, cheap case).
  - `reset` — full log when it shrank/diverged (rare dedupe re-emit); client replaces its buffer.
  - `state` — meta changed (runState/exitCode/question) with no new log bytes.
  - `done` — terminal (`done`/`idle`); server then ends the stream so it stops hitting SSH.
  - `:` heartbeat every 15s so proxies keep the idle pipe open.
- **Offset/reconnect**: each frame's SSE `id:` is the byte offset. EventSource replays it as
  `Last-Event-ID` on auto-reconnect (also accepted as `?from=`), so a blip resumes with only the
  missed tail — never a full re-send.
- **Cleanup**: `req.on("close")` stops the loop; the terminal `done` also stops it. Bounded to one
  timer per viewer → host load is O(viewers), same SSH mux as the old poll but only while watched.

### Frontend

- `api.watchStreamUrl(session)` builds the tokened URL; `useWatchStream` (new hook) opens the
  EventSource, rebuilds the full log from `snapshot`+`append`/`reset`, and yields a normal
  `WatchSnapshot` — so trace parsing + the StreamingMarkdown reveal are unchanged, just fed fresher.
- `Thread.tsx` prefers the stream; `usePoll` is the **fallback**, disabled (interval 0) whenever the
  stream is healthy so there is **no double-fetch**. If SSE never connects, `ok` stays false and the
  3s poll takes over transparently. `/watch.json` is untouched and kept as that fallback.
- Bundle impact: **none** (EventSource is native; hook is ~1kB). No new dependency.

## Responsiveness across viewports

Measured live via CDP device-metrics + DOM geometry (not screenshots) at 390 / 768 / 1024 / 1440.

### Bug found (390px mobile): the Hub was unreachable

The shell is a two-column grid on `md+` (rail + workspace). On mobile it collapses to one column and
shows a single pane at a time. The old logic keyed pane visibility on `threadOpen` — so the workspace
`<main>` (which contains the **Hub**, the primary "start a task" surface) was `display:none` whenever
no thread was open. Result: on a phone you saw the machines rail but **could not reach the Hub or its
composer at all** (measured: `h1 "Good morning"` and the `<textarea>` both computed to `display:none`,
0×0). Tapping "New task" set `selected=null` which left `threadOpen` false → nothing appeared.

768 / 1024 / 1440 were all clean (no horizontal overflow; rail 208px + workspace fills the rest; Hub
composer shown and comfortably sized).

### Fix — an explicit mobile single-pane model

`App.tsx` now tracks `mobileRail` (starts true = the rail/list is the mobile home). Navigating INTO
the workspace (New task, open a box, switch to Sandboxes) sets it false → the workspace pane shows;
the in-workspace **"← Machines"** back control (added to Hub and Sandboxes headers, `md:hidden`;
Thread/BootingThread already had one) sets it true → back to the rail. On `md+` the grid shows both
panes so `mobileRail` only toggles the mobile `hidden`/`flex` classes and is visually inert. No new
breakpoints; the existing coarse-pointer 44px rule and the table/`<pre>` `overflow-x:auto` already
handle tap targets and wide-output containment.

## SSE `state`-frame debounce

`/watch.sse` previously compared the whole meta blob each tick, so because uptime ticks every second
it emitted a `state` frame every 800ms even when nothing meaningful changed. `meaningfulStateKey`
(pure, unit-tested) now keys only on runState / boxStatus / exitCode / question / task — the fields
that actually flip the UI — so a `state` frame fires only on a real transition. Vitals still ride
along in whatever frame the meaningful fields trigger, and the thread header's uptime/cpu/mem come
from the App-level monitor poll anyway, so nothing goes stale. Kills the per-tick chatter without
touching latency or reconnection.

## Known gap — produced-file artifacts (NOT built; documented deliberately)

The reference surfaced a produced file (e.g. a downloadable PDF card). Today a file the agent writes
(e.g. the "Research, no repo" starter's `/workspace/report.md`) is surfaced only as a compact `Write`
tool row (path in a code chip); the file itself lives in the ephemeral box and dies with it — there
is **no view/download affordance and no endpoint that serves box files**.

Deliberately left as a gap rather than built now, because a real artifact download is not a small,
safe change: it needs a new token-guarded route that reads an arbitrary path out of a box over SSH,
and that token can spawn VMs — so it demands careful path-traversal/allowlist confinement (restrict to
`/workspace`, canonicalize, reject `..`/symlinks), a size cap, and a content-type/inline-vs-attachment
decision. The right shape is roughly `GET /artifact?session=&path=` → `dashAuthed` → validate the path
is under `/workspace` → stream `cat` over the existing SSH mux → a distinct "produced file" card in the
trace (icon + name + size + Download). That is a focused follow-up feature, not a quick polish item, so
it is captured here for continued goal work instead of half-built.
