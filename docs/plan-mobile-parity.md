# Mobile ↔ web parity plan

Status as of 2026-10-03. The mobile app (Expo, `mobile/`) is ~13.6k lines against the web
console's ~44k, and its last feature commit predates memory v3, thread schedules, harnesses,
workflows, providers and the viz blocks. This document is the gap list and the order we close it.

The mobile app is the **"needs you" surface**: answer questions, approve things, watch runs,
unblock them, start new work from anywhere. It is not an IDE. So parity is judged per feature:
*full* where the web feature is about steering or trusting a run, *read + the one action that
matters* for configuration pages, and *deliberately absent* for desktop-only editing surfaces.

## Gap list (web has it, mobile does not)

### Thread (highest leverage — this is where the phone earns its place)

| Web feature | Mobile today | Target |
|---|---|---|
| Stop a running turn (`/interrupt.json`) | missing | **full** — Stop in the working indicator |
| Queued follow-ups: list, Send now, remove (`/inbox.json`, `/send-now.json`) | only a count chip; api functions unused | **full** |
| Scheduled card: schedules proposed/created from this chat; approve / dismiss / pause / run (`/triggers/for-box.json`) | missing | **full** — the "needs your approval" halo is a push-notification-grade event |
| Memory saves: Keep / Forget pending notes (`memoryNew` on the watch snapshot, `/memory-notes.json`) | notes shown as a faint line, no actions | **full** (keep/forget; edit on web) |
| Test results card (runner, pass/fail/skip, per-file cases) | counts only in the outcome card | **full** |
| Produced files / artifacts: view + share (`/artifact`) | `producedFiles()` + `api.fileText` exist, unused | **full** (view text/markdown; share sheet instead of download) |
| Review-all diff (`/rundiff.json`) | per-file diff only | **full** (read-only) |
| MCP call items in tool groups | rendered as generic tools | **full** (icon + server name) |
| Usage / context-health line from `usage` trace events | parsed, never rendered | small: one line under the header when > 60 % |
| Streaming markdown reveal | whole block re-renders | later (polish) |
| Workspace file browser / editor, commit from editor | missing | **done** (browse + edit; commit via Changes sheet) |
| Records table | missing | not planned |

### Composer / new task

| Web feature | Mobile today | Target |
|---|---|---|
| Agent/driver picker (claude / omp / codex / opencode, supervised badge) | missing | **full** (from `/agent-prefs.json`) |
| Harness picker | missing | **full** (pick a saved harness; editing on web) |
| Playbook/workflow picker | missing | **full** (pick; editing on web) |
| Attempts 1–3 | typed in api, no control | **full** |
| Image attachments on follow-ups | new-task only | **full** |
| Link unfurl (GitHub issue/PR, Sentry URL → task) | missing | **full** (`/intake/unfurl.json`) |
| Draft persistence across app restarts | failure-stash only | small: AsyncStorage draft per box + new |

### Pages

| Web page | Mobile today | Target |
|---|---|---|
| Memory (You + per-repo knowledge base, pin/delete/promote, enable toggle) | missing | **read + pin/delete/keep/enable**; graph stays on web |
| Automations create / edit / delete (+ plain-words schedule picker) | read-only + toggle/run/test | **full** for schedule & chain kinds; webhook/github create too (secrets shown once) |
| Scheduled (one-off chat schedules) page | missing | fold into Automations as a filter |
| History ledger totals + run-again | list + outcome | add ledger totals header |
| Admin: create user, role, issue key | plan + delete only | **full** |
| MCP servers add / edit / remove | list + toggle + test (test reads a stale field) | **full** add/edit/remove for http/sse/stdio; fix probe shape |
| Skills: view playbook, import from GitHub | list + toggle | view content + import by repo URL; authoring on web |
| Providers | missing | read + add key (later) |
| Harnesses / Playbooks editors | missing | **not planned** (pick-only from the composer) |
| Audit log | missing | read-only list (later) |
| Inbox intake allowlists | read-only | editable allowlists (later) |

### Markdown / viz

`MarkdownLite` has no tables, task lists, callouts, nested lists, rules or images, and every
viz fence (`chart`, `stats`, `csv`, `json`, `timeline`, `steps`, `kv`, …) renders as a code block.
Target: GFM tables, task lists, callouts, rules, nested lists, strikethrough; native renderers for
`stats`, `kv`, `badges`, `progress`, `steps`, `csv/tsv`, `json`, `tests`, `timeline`, callout
fences, and a simple bar/line `chart`. Everything else keeps the code block.

### Stale wire shapes to fix

- `api.mcpTest` returns `{ok, detail, status?, tools?}` (server `McpProbeResult`); mobile reads `r.error`.
- `api.delegate` lacks `agent`, `provider`, `harness`, `workflow`, `attemptSpecs`, `allowPartialSupervision`; response lacks `harness` / `attemptGroup`.
- `BoxView` lacks `agent`, `stalled`, `harness`, `workflow`, `skills`; `WatchSnapshot` lacks `memoryNew`.

## Order of work

1. **Wave 1 — thread parity** (this pass): API client extended with every missing endpoint and
   type; Stop; queued list; scheduled card; memory keep/forget; test results; produced files;
   review-all; MCP items; usage line; stale shapes fixed.
2. **Wave 2 — composer + pages** (this pass): agent/harness/workflow/attempts pickers; follow-up
   attachments; unfurl; Memory page; Automations editor; MCP add/edit/remove; Admin full;
   Skills view/import; markdown + viz upgrade.
3. **Wave 3** — done: providers page, audit log, intake allowlists, history ledger totals. 
4. **Wave 4** — done: streaming markdown reveal, harness + playbook editors, workspace file browser/editor
   (commit stays in the Changes sheet), SVG line/area/donut/scatter charts, provider + model in run settings.
   Still later: drafts polish.

Conventions: mirror web's `lib/*.ts` pure helpers byte-for-byte where they are platform-neutral
(`trace.ts` already is; `testReport.ts`, `question.ts`, `planTasks.ts` next), keep every new
screen inside the existing theme tokens, and keep the "needs you" visual language (ink hairline,
halo, one filled button) from the recent web theme commits.
