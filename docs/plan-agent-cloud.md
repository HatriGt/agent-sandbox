# Plan — Agent Sandbox as your own agent cloud

**Written 2026-09-30.** Supersedes the framing in `docs/roadmap-saas.md` (2026-09-06). That roadmap's
funnel work (notifications, digest, archive, usage meter) stays valid; what changes is *what the
product is* and therefore what the surfaces are called, what the landing page shows, and which
missing capabilities come first.

**Name decision (2026-09-30):** the product keeps the name **Agent Sandbox**. Alternatives were
explored and rejected (most evocative names in this space are already taken, and the existing name
is known and liked). The sandbox remains the honest reason the rest is safe; the tagline carries the
new meaning.

## 1. What the product becomes

> **Agent Sandbox — your own agent cloud.** Any coding agent, any model, any account. Every run in
> its own microVM. Always on: manual, scheduled, event-triggered, long-running. When it needs a
> decision, it asks instead of guessing.

Why this shape (see the 2026-09-30 discussion): the projects that broke out this year — OpenClaw,
OpenCode, DeepSeek's `dsh` — are self-hosted, model-agnostic and account-agnostic; the vendor cloud
agents (Claude Code web, Codex cloud, Cursor cloud) are each locked to one model, one account, one
cloud; phone remote-control has become a vendor feature; and *harness engineering* is the discipline
of the year. None of those trending projects gives a hard isolation boundary or a supervision layer.
We have both. The microVM is why "always on, unattended" is a safe sentence; supervision is what
makes it worth leaving on.

Self-host is the identity. Hosted is "we run your agent cloud for you" and stays feature-identical
(open-core stance unchanged).

### The one primitive

Every feature must be expressible as a field of this object or it is out of scope:

```
Run = Trigger × Harness × Box → Artifact, under Supervision
```

| Part | Meaning | Today |
|---|---|---|
| **Trigger** | manual (dashboard / MCP / curl), schedule (cron), event (GitHub, generic webhook, chat message, another run finishing) | manual only; `after:` handoff is the one dependent trigger |
| **Harness** | driver + model/endpoint + account + skills + hooks + rules + verify + egress + budget | driver ∈ {claude, omp} (`src/agent-kind.ts`), Claude-only model catalog via ccproxy (`src/models.ts`), skills, MCP servers, ask-hook, verify, egress allowlist |
| **Box** | microVM with repos; tiers, warm pool, sleep/wake, checkpoints, keep | built |
| **Artifact** | PR, files, digest, receipt (what ran, asked, verified, cost) | PR + files + digest; no cost, no receipt on the PR |
| **Supervision** | stops-and-asks, side questions, plan-vs-did, notifications, budgets, audit | built except budgets; push is not built |

Scope rule: a request that cannot be named as one of those five words is declined.

## 2. Workstreams

Six workstreams. Each lists the code it touches, what "done" means, and the tests that lock it in.
Order is by dependency; A and B are the ones everything else needs.

### A. Driver interface — "any agent"

**Goal.** A driver is a module that satisfies one contract; Claude Code is the reference
implementation; adding a driver never touches the delegate flow, the thread, the digest or mobile.

**Today.** `agentSh()` in `src/msb.ts` branches on `AgentKind` (claude vs omp) inside one shell
string; the ask hook (`askHookScript()`), the plan tool pin (`agentEnvFlags()`), the stream-json
formatter (`~/.claude/stream-fmt.js`) and resume (`claude -c`) are Claude-shaped. The omp branch
proves a second driver can ride the same ccproxy env, but it inherits Claude-specific pieces
unevenly.

**Contract** (`src/drivers/types.ts`):

```ts
interface Driver {
  kind: DriverKind;                       // "claude" | "codex" | "opencode" | "omp" | "gemini"
  label: string;
  capabilities: {
    gate: "hook" | "wrapper" | "none";    // can we deny a tool call while a question is pending?
    sideQuestion: boolean;                // read-only lane possible?
    planEvents: boolean;                  // structured plan snapshots?
    resume: boolean;                      // continue a session with an answer?
    modelSources: ("anthropic" | "openai" | "openai-compatible" | "local")[];
  };
  install(): string;                      // shell: ensure binary + login files in the box
  launch(input: LaunchInput): string;     // shell: start the run, write .agent.log/.agent.status
  resume(input: ResumeInput): string;     // shell: continue with an answer / follow-up
  gateScript(): string | null;            // the pre-action gate, or null → wrapper gate
  formatter(): string;                    // event stream → the ⟦…⟧ sentinel log the UI parses
  ask(input: AskInput): string | null;    // read-only side question, or null
  envFlags(model: ModelRef, account: AccountRef): Record<string,string>;
}
```

Supervision floor: a driver ships only if `gate !== "none"` and `resume` is true. When a driver has
no native pre-tool hook, `gate: "wrapper"` means the box-side supervisor (a small process that owns
the PTY) pauses the agent's process on a question sentinel and denies its next tool call by
interposing on the tool transport. That wrapper is the single hardest piece of this workstream and
is why Codex must be prototyped before it is promised.

**Steps.**

1. Extract the Claude branch into `src/drivers/claude.ts` with zero behaviour change; `agentSh`
   becomes `drivers[kind].launch(...)`. Snapshot tests on the emitted shell (`test/drivers-claude.test.ts`)
   so the refactor is provably a no-op.
2. Move omp into `src/drivers/omp.ts` on the same contract.
3. Generalise the formatter: keep the sentinel log format (`⟦plan⟧`, tool rows, usage line in
   `src/trace.ts`) as the *driver-independent* contract; each driver owns only its "native events →
   sentinels" adapter.
4. **Codex** (`src/drivers/codex.ts`): `codex exec --json` for the event stream; confirm whether its
   hook/approval surface allows a pre-action deny; if not, wrapper gate. Model via OpenAI key or
   the user's ChatGPT login inside the box (see B on account policy).
5. **OpenCode** (`src/drivers/opencode.ts`): unlocks 75+ providers at once through its provider
   config; plugin hook for the gate.
6. Driver picker on the composer and in Settings → Agents (`web/src/components/AgentSettings.tsx`
   already holds the per-user default); capability badges (gate / side question / plan) shown
   per driver so a degraded driver is never a surprise.

**Done when.** A task delegated with `driver: codex` shows the same thread, plan card, question card
and digest as Claude Code; `test/drivers-contract.test.ts` runs the same fixture events through every
driver adapter and asserts identical sentinel output.

### B. Providers & accounts — "any model, any account"

**Goal.** Model is a field on the run chosen from the user's registry, not a global ccproxy alias.

**Today.** `src/models.ts` fetches ccproxy `/v1/models` and *filters to Claude aliases*;
`ANTHROPIC_*` env is injected into the box; GitHub accounts live in `src/accounts.ts` /
`gh-token-store.ts`; secrets are per-owner AES-GCM blobs (`src/user-store.ts`).

**Design.**

- `src/providers.ts` — provider registry, per user, encrypted:
  `{ id, kind: "anthropic" | "openai" | "openai-compatible" | "ollama" | "ccproxy", baseUrl,
  apiKey?, models: ModelRef[], label }`. Model list fetched and cached per provider (same
  ssh+curl hop as today when the endpoint is only reachable from the host).
- `ModelRef = { provider, id, label, tier, pricing? }`. Pricing optional, user-entered or from a
  small built-in table, used only for the receipt (workstream E).
- **Account kinds**: API key (guaranteed path), OpenAI-compatible endpoint (guaranteed), local
  model on the host (Ollama, guaranteed), **CLI login** (Claude / ChatGPT subscription): the user
  logs the CLI in *inside their own box image* once; we persist only the login files into the
  per-user snapshot (`src/bake-snapshot.ts` already exists for images). Policy, written in the UI:
  subscription logins are supported on self-host with the user's own login; the hosted tier never
  proxies or pools them. Re-check vendor terms before each release; keep the API-key path first in
  every picker.
- Egress: adding a provider adds its host to that user's allowlist automatically (the allowlist is
  already the mechanism in `src/config.ts` / `src/net-guard.ts`).
- Secrets stay out of the box where possible: for hosted providers, route through the existing
  proxy hop with the key injected controller-side (the "keys it uses but never sees" pattern);
  where a driver insists on the key in env, mark the provider "in-box key" in the UI.

**Done when.** Settings → Providers lists ≥3 provider kinds, the composer's model picker is grouped
by provider, a run's receipt names provider + model, and `test/providers.test.ts` covers validation,
masking and allowlist derivation.

### C. Triggers — "always on"

**Goal.** Runs start without a human at the keyboard, through the *same* delegate path.

**Design.** One table, one dispatcher, three sources.

- `triggers` table (SQLite, `src/db.ts`): `{ id, owner, kind: "schedule" | "webhook" | "github" |
  "chain", spec, harness_id, repo, task_template, enabled, last_fired, next_fire }`.
- `src/triggers.ts` — pure: cron parsing/next-fire, webhook payload → task template rendering
  (`{{issue.title}}`, `{{pr.number}}`, `{{payload.x}}`), GitHub event filters (label added, comment
  matching `/agent …`, PR opened), dedupe (delivery id), and per-trigger concurrency cap.
- Dispatcher: a controller loop (like the pool maintainer) that fires due schedules and drains a
  queue; every fire calls `delegateFlow()` with a `trigger` provenance field that ends up on the
  run and the receipt.
- `POST /hooks/:triggerId/:secret` — generic webhook receiver; GitHub uses the same route with
  signature verification (`X-Hub-Signature-256`).
- `chain` = the existing `after:` handoff (`src/handoff.ts`) exposed as a trigger so pipelines are
  data, not caller-side code.
- Chat sources (Telegram/Slack) are *later* and are just webhook triggers with a reply channel.

**Done when.** A labelled GitHub issue starts a run within 30 s; a nightly cron starts one at the
right local time; each shows "Started by: schedule ‹name›" in the thread; disabling a trigger
stops it; `test/triggers.test.ts` covers cron, templating, signature check, dedupe, concurrency.

### D. Long-running runs & budgets

**Goal.** A run can last a day without becoming spooky or expensive.

**Today.** `MSB_MAX_DURATION` = 1 h; idle 15 m; checkpoints exist (`src/checkpoint.ts`); no cost.

**Design.**

- Per-run `budget: { maxMinutes, maxUsd?, maxTokens? }` on delegate; the usage line the formatter
  already stamps (`src/trace.ts`) feeds a running total; the gate denies the next tool call when a
  cap is hit and writes a question ("Budget reached: continue with +$2?"), i.e. budgets reuse
  ask-and-stop rather than killing the box.
- **Continue across box lifetimes**: on `maxDuration` the controller checkpoints, archives a partial
  digest, and (if the run is `keep`) re-launches with `resume` in a fresh box carrying the workspace
  and the session; the thread shows a "continued in box 2 of N" divider.
- Heartbeat: the thread and the fleet show "last tool call 40 s ago"; a run silent for
  `HEARTBEAT_STALL_MS` becomes `stalled` (new state, uses the *failed* hue with a distinct glyph)
  and fires a notification.
- Runs in the fleet carry `startedBy` and `budget used / cap` so unattended runs are legible.

**Done when.** A 3-hour scheduled run completes across two boxes with one plan card and one digest;
a run with `maxUsd: 1` stops and asks at $1; stall detection fires within the window.

### E. Receipt, ledger, notifications

**Goal.** Nothing runs unattended without a record of what it did and what it cost.

**Design.**

- **Receipt** = digest (`src/digest.ts`) + provenance (trigger, driver, provider/model, account) +
  cost/tokens/duration + supervision facts (questions asked and answers given, verify result,
  egress hosts contacted, secrets kept out of the box). Rendered as the thread's closing card, as a
  PR comment (opt-in per trigger), and stored in the archive (`src/run-archive.ts` grows the
  columns).
- **Ledger** = the History page over the archive with totals per week, per trigger, per provider:
  the only place aggregates are allowed (PRODUCT.md principle 4 — it is a record).
- **Notifications**: web settings UI for `/notify.json` (roadmap P1 #1), then mobile push +
  `asb://box/<name>` deep links (`docs/mobile-app-spec.md` M2). Events: waiting, done, failed,
  stalled, budget.

**Done when.** Every finished run has a receipt; the History page answers "what ran last night and
what did it cost"; a `waiting` run reaches the phone lock screen.

### F. Harness bundles & gallery (later; the workbench feature)

A harness is a versioned folder `{ harness.json, skills/, hooks/, RULES.md, verify.sh }` importable
from a public GitHub repo exactly like skills are today (`src/github-skills.ts`). Two harnesses can
be run on one task side by side and compared on the receipt fields. Public gallery with receipts on
public tasks. Do this after A–E have shipped; it is the growth mechanism, not the core.

## 3. Product surface & information architecture

The console's spine changes from *Machines* to *Runs*. Machines remain as a drill-down.

| Nav item | Purpose | Built on |
|---|---|---|
| **Runs** (home) | Needs-you queue → live runs → recently finished (receipts). Composer at top. | `Hub.tsx`, `Sessions.tsx`, `thread/` |
| **Automations** | Triggers: schedules, webhooks, GitHub rules, chains. Each row: name, when, harness, last result, next fire, on/off. | new; `handoff.ts` for chains |
| **Harnesses** | Drivers, skills, hooks, rules, verify, egress, budgets. Skills page becomes one tab here. | `SkillsPage.tsx`, `AgentSettings.tsx`, `McpServers.tsx` |
| **Providers & Accounts** | Model providers, GitHub accounts, CLI logins, API keys. | `Integrations.tsx`, `Accounts.tsx`, `ApiKeys.tsx` |
| **Machines** | The fleet table + capacity strip, unchanged in spirit. | `MachineList.tsx`, `Capacity.tsx`, `Sandboxes.tsx` |
| **History** | Ledger over the archive. | `History.tsx`, `run-archive.ts` |
| **Settings** | Notifications, security, audit, admin. | `NotifySettings.tsx`, `AuditLog.tsx`, `Admin.tsx` |

### Screen specs

**Runs (home).** Keep the serif greeting and the one honest fleet sentence. Composer gains three
compact selectors inside the input frame: *driver* (icon + name), *model* (grouped by provider),
*budget* (chip: "1 h · $2"). Below the composer: the amber needs-you queue (unchanged rule: amber is
only for this), then *Live now* cards with heartbeat ("last action 12 s ago") and a thin budget
bar, then *Finished* as receipt rows (headline, PR link, cost, verified tick). Empty state for a new
account is the activation flow: "Connect a provider → pick a driver → run the demo task".

**Thread.** Unchanged two-voice layout. Additions: a provenance line under the title ("Started by
schedule *nightly-chores* · Codex · gpt-6 via OpenAI · $0.31 so far"), a "continued in box 2"
divider for long runs, and the receipt as the closing card (digest + cost + supervision facts) with
a "Post to PR" action.

**Automations.** A list, not a canvas. Row = name · trigger glyph (clock / webhook / GitHub / chain)
· "when" in words ("Weekdays 02:00", "issue labelled `agent`") · harness · last run receipt chip ·
next fire · switch. Create/edit in a right-hand sheet: source, filter, task template with a
live-rendered preview against the last real payload, harness pick, budget, PR-comment toggle. A
"Run now" button is the test path. Chains are drawn as a two-node row, never a graph.

**Harnesses.** Tabs: Drivers (cards with capability badges: gate / side question / plan / resume,
and a "supported model sources" list), Skills (existing page), Hooks & rules (editor for the
system-prompt rules and hook toggles: ask-before-guess, plan-first, verify-on-done), Egress &
budgets (defaults). A harness is the saved combination; "Duplicate" and "Export" here are the seeds
of workstream F.

**Providers & Accounts.** One list of connections with kind badges and masked secrets; "Add" opens
a sheet with the four kinds; CLI-login kind shows the one-time in-box login instructions and the
policy sentence. Each provider row can "Fetch models" and shows the resolved list.

**History.** Table of receipts with filters (trigger, driver, provider, state, verified) and the
period totals at the top (runs, verified %, cost, tokens). Row opens the archived receipt and diff.
Read-only, dated, visibly past.

**Mobile.** Same product, single pane: Runs (needs-you first), Thread with question cards and the
side-question lane, Automations read + toggle + "Run now", History. Push notifications with deep
links are the reason the app exists.

**Landing page.** Hero: the matrix. Rows = drivers (Claude Code, Codex, OpenCode, oh-my-pi, Gemini
CLI), columns = model sources (Anthropic, OpenAI, OpenAI-compatible, local), cells = "isolated ·
scheduled · event-triggered · asks instead of guessing". Below: the 30-second demo (issue labelled →
scheduled box on a cheap model → stops and asks → answered from the phone → verified PR with a
$0.31 receipt). Then the security section (microVM, egress allowlist, secrets out of the box, audit)
and a one-command install. Hosted signup is the secondary CTA.

### Design guidelines (extends `web/DESIGN.md`; that file stays the source of truth for UI decisions)

- **Keep the principles**: amber only for needs-you; six functional state hues; two voices; live
  never implies history; the phone is the same product. New states: **stalled** (failed hue,
  pulse-stopped glyph) and **scheduled/queued** (idle grey with a clock glyph). Cost is machine
  data → Geist Mono, never coloured.
- **Component patterns and where to look** (borrow patterns, never code):
  - Settings sheets, segmented controls, list states, capability badges — [skiper ui](https://skiper-ui.com),
    [cult ui](https://cult-ui.com), [bundui](https://bundui.io), [rareui components](https://www.rareui.com/components).
  - Automations rows and the trigger editor sheet — list + side-sheet patterns from the same kits;
    the live template preview follows the "preview beside the form" pattern rather than a modal.
  - Motion: the Emil Kowalski rules already adopted (150–250 ms ease-out, few animations, real touch
    targets, `prefers-reduced-motion`); heartbeat and budget-bar motion details from
    [60fps.design](https://60fps.design); no decorative effects on data surfaces.
  - Landing hero and matrix — [supahero.io](https://supahero.io) for hero structure,
    [cta.gallery](https://cta.gallery) for the install/signup pair, [codedvisuals](https://codedvisuals.com/visuals)
    only for the hero's single visual moment.
  - Navigation with seven items — [navbar.gallery](https://navbar.gallery) for collapsed-rail
    treatments; the sidebar stays 17 rem / 3.5 rem.
  - Mobile layout — [loadmo.re](https://loadmo.re) for bold single-pane screens; question cards
    remain the loudest element.
  - Recent visual language checks — [recent.design](https://recent.design), [inspora.design](https://inspora.design).
- **Copy voice**: direct and technical; the matrix uses product names, not adjectives; no fabricated
  numbers anywhere (the demo receipt must be a real run).
- **Accessibility**: every state has icon + word; mono cost figures meet contrast in both themes;
  sheets trap focus; the mobile app closes its Dynamic Type / screen-reader gaps in the same pass
  as push.

## 4. Sequence

Two-week increments, each ending in a deploy and a live check. Effort is one person plus agents.

| Increment | Ships | Cuts if late |
|---|---|---|
| 0 (now) | `PRODUCT.md` rewrite, landing page matrix + demo recording (with today's two drivers and Claude models — honest, then widened), notifications web UI, receipt card on finished threads (digest + provenance + duration) | demo video |
| 1 | Workstream A steps 1–3 (driver extraction, no behaviour change), driver picker with capability badges | — |
| 2 | Workstream B: provider registry, grouped model picker, OpenAI-compatible + Ollama; egress derivation | pricing table |
| 3 | Codex driver (gate prototype first; go/no-go), OpenCode driver | OpenCode |
| 4 | Workstream C: schedules + generic webhook + Automations page; run provenance | chains as triggers |
| 5 | GitHub event triggers + PR receipt comment; History ledger with totals | totals |
| 6 | Workstream D: budgets via ask-and-stop, heartbeat/stalled, continue-across-boxes | continue-across-boxes |
| 7 | Mobile push + deep links; Automations on mobile | Automations on mobile |
| 8 | Harness bundles (export/import), side-by-side compare | gallery |

Metrics from increment 0 onward, all from the archive: runs per user per week, share started by a
trigger, verified share, cost per run, questions per run, time-to-first-receipt for new accounts.

### Status (2026-09-30)

From the git history and the code; "not verified" means no commit clearly delivers it.

- **0** — shipped: `PRODUCT.md` rewrite, landing matrix, receipt provenance on the digest card.
  Not verified: notifications web UI as a separate deliverable. Cut: demo video.
- **1** — shipped: driver extraction behind a contract (snapshot-locked), driver picker with
  capability badges.
- **2** — shipped: encrypted per-user provider registry, grouped model picker, OpenAI-compatible +
  Ollama, derived egress. Pricing is partial: cost shown only for models with a known price.
- **3** — shipped: Codex and OpenCode drivers, contract test, supervision floor (both meet it).
- **4** — shipped: schedules, generic webhook, Automations page, run provenance; chains as triggers.
- **5** — shipped: GitHub event triggers, PR receipt comment, History ledger with totals.
- **6** — shipped: heartbeat/stalled. Budgets via ask-and-stop shipped and were later REMOVED
  from the product (only plain cost reporting remains: duration, tokens, $ for priced models).
  Cut: continue-across-boxes.
- **7** — shipped: Expo push, `asb://` deep links, Automations on mobile.
- **8** — shipped: saved harnesses, versioned bundles (export/import), two-harness compare. Cut: gallery.
- Not started: Gemini CLI driver.

## 5. Risks and the decision each needs

- **Codex gate.** If neither hooks nor a wrapper can reliably deny a tool call, Codex ships as
  "supervised: partial" with the badge, never silently. Decide at increment 3.
- **Subscription logins.** Vendor terms can change; API keys remain the first option in every
  picker and the hosted tier never touches subscription tokens. Re-verify terms at each release.
- **Trigger safety.** An event-triggered run with push rights is the highest-blast-radius feature
  we will have: default budgets, per-trigger concurrency of 1, PR-only (never push to default
  branch), and the receipt comment on by default for GitHub triggers.
- **Scope.** The one-primitive rule is the guard; the Automations page is a list, not a canvas
  (`docs/status.md` already rejected the canvas).
- **Cost of measurement.** Receipts need prices; unknown prices render as tokens only, never as a
  guessed dollar figure.
