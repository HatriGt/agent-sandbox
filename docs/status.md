# Status

**Last updated: 2026-09-01.** Living document: what is shipped, what is in flight, what is next, and
what is known-broken. Everything under *Shipped* is deployed at
`https://agent-sandbox.ajeethkumar.dev` and covered by tests unless the row says otherwise.

Suite: **362 tests across 54 files, 348 passing.** The 14 failures are all one local environment
fault (`better-sqlite3` compiled against a different Node than the one running the suite) — not
product defects. The Docker image compiles the addon in-image, so CI and the deploy are unaffected.
Reproduce the real signal with `npx tsx --test test/<file>.ts`.

---

## Shipped

### The core loop
| Thing | Where | Notes |
|---|---|---|
| Delegate a task to a microVM running Claude Code | `src/msb.ts`, `src/delegate-flow.ts` | microsandbox/KVM on the VPS host; the container SSHes out to drive `msb` |
| Ask-and-stop interactivity | `askHookScript()` in `src/msb.ts` | a `PreToolUse` hook denies every further call while `.agent.question` exists, so the agent genuinely halts |
| Read-only co-pilot lane | `src/ask.ts` | second agent in the same box; cannot write, cannot steer, capped by `ASK_TIMEOUT_MS` |
| Resume / steer / answer | `POST /resume.json` | the only way to answer a pending question; queues to an `Inbox` while a run is mid-turn |
| Warm pool | `src/pool*.ts` | pre-booted boxes so a claim skips the boot |
| Sleep / wake / keep | `POST /sleep.json`, `/wake.json`, `/keep.json` | a stopped box keeps its rootfs and Claude session; **kept** boxes are never reaped |
| Live log streaming | `GET /watch.sse`, `src/watch-hub.ts` | one shared tail loop per box, cached and resumable via `?from=` |
| Self-healing stale runs | `RUN_STATE_SH` in `src/msb.ts` | PID liveness + boot-time comparison; a run orphaned by a restart resolves to `exit 254` "interrupted" instead of hanging in `working` forever |

### Entry points (peers, by design)
- **MCP** at `POST /mcp` (Streamable HTTP) and stdio (`dist/index.js`). Tools: `delegate`, `status`,
  `resume`, `teardown`, `pool_status`, `monitor`, `watch`, `ask`, `gh_token_add`.
- **Dashboard SPA** — React 19 + Vite + Tailwind v4, served by the same container under `/dashboard`.
- **Plain HTTP** — every dashboard route is a documented bearer-guarded JSON endpoint.

### Multi-user
Built, and **this supersedes the "Direction — multi-user (not built)" section of `PRODUCT.md`,
which is stale.**

| Thing | Where |
|---|---|
| `AUTH_MODE=token` (single operator) vs `AUTH_MODE=saas` | `src/config.ts:236` |
| Identity: GitHub OAuth, password sign-up, admin-created local users | `src/identity.ts` |
| Opaque expiring sessions, revocable API keys (stored hashed, shown once) | `src/identity.ts` |
| Per-request principal + `guardDeps()` so a caller reaches only their own boxes | `src/tenancy.ts` |
| Per-owner encrypted blobs (AES-256-GCM) for GitHub tokens, MCP servers, skills | `src/user-store.ts`, `src/secretbox.ts` |
| Plans: trial clock, upgrade, admin bypass, per-user box quota | `src/identity.ts` |
| Audit log | `src/audit.ts` |

Not built: **billing**. No Stripe wiring; the product is free during beta. `plan` is set by an admin.

### Working with repositories
Repo attach from the composer, auto-attach when the task names a known repo, multi-repo in one box
(`/workspace/<name>` each), per-repo git identity resolved by *access* rather than a default account,
`GET /changes.json` + `/diff.json`, in-browser editing (`PUT /file.json`), commit/push and PR merge
(`src/git-ops.ts`, `POST /git.json`, `/pr/merge.json`).

### Skills
Per-user playbooks (`src/skill-store.ts`), synced into every box at `~/.claude/skills/<name>/SKILL.md`
before each run and each turn, invoked with `/name` from chat or picked up by the agent when the
description matches. Managed on a dedicated page; importable from a file or a public GitHub repo.

### The console
Two-pane operator console with a live thread, fleet view, workspace/editor pane (CodeMirror 6, merge
view for diffs), command palette, keyboard shortcuts, both themes first-class. The full round-by-round
design record lives in **`web/DESIGN.md`** — that file, not this one, is the source of truth for UI
decisions.

**Newest (2026-09-01) — the plan is now a task board.** `PlanCard` joins what the agent *said* it
would do to what it actually did: a progress rail, and per-step evidence (files written, commands run,
elapsed time, other tool calls named, failures flagged). The attribution rule is that work between two
consecutive plan snapshots belongs to the step that was in progress in the first one, which needs no
new instrumentation in the box. See `web/src/lib/planTasks.ts` and `test/plan-tasks.test.ts`.

---

## Recently fixed, worth knowing

**The plan tool moved and we did not notice.** Current Claude Code exposes *either* `TodoWrite` *or* a
task list (`TaskCreate`/`TaskUpdate`/`TaskList`), and for a headless `claude -p` run the task list was
winning. `TodoWrite` was never called, so the plan card silently rendered nothing on every recent run
and `→ TaskUpdate` rows appeared as noise.

Measured on the installed **2.1.234**, the selector is an env var, not a version:

| `CLAUDE_CODE_ENABLE_TASKS` | TodoWrite | TaskCreate |
|---|---|---|
| unset | ✗ | ✓ |
| `0` / `false` | ✓ | ✗ |
| `1` | ✗ | ✓ |

Both tools ship in every recent version, so **pinning an old Claude Code would not have fixed this**
and would have cost us security and model updates. Instead:

1. `agentEnvFlags()` sets `CLAUDE_CODE_ENABLE_TASKS=0`, pinning the plan tool to `TodoWrite`. One
   `TodoWrite` call re-emits the whole list, so one call is one snapshot — the task tools emit one call
   per task, which inflated a 4-step plan to 12 snapshots and made "how often did it rewrite the plan"
   meaningless. After the pin: 3 steps → 4 snapshots.
2. The formatter still understands `TaskCreate`/`TaskUpdate` and folds them into the same `⟦plan⟧`
   snapshots, so a box that ignores the flag degrades instead of losing its plan.

**A deploy could not reach a long-running thread.** The in-box log formatter was installed at bootstrap
only, so a box bootstrapped by an older controller kept that build's log format for its whole life.
`resumeAgentTask` now refreshes it too.

---

## Known issues

| Issue | Impact | Status |
|---|---|---|
| `better-sqlite3` NODE_MODULE_VERSION mismatch locally | 14 tests fail on this machine only | not a product bug; `npm rebuild better-sqlite3` fixes it per-machine |
| Bundle chunks over 500 kB (`editor` ~228 kB gz, `index` ~234 kB gz) | build warning; the editor chunk is already lazy | accepted for now |
| `PRODUCT.md` "Direction — multi-user (not built)" | stale — multi-user is built | rewrite pending |
| `docs/plan.md` is the original phased build plan | historical, not current status | kept as a record; this file supersedes it |
| GitHub OAuth client secret was pasted into a chat | credential hygiene | **user action: regenerate it** |

---

## Next up (not started)

Ordered by value, from the agenttrail review (2026-09-01):

1. **`PLAN.md` as a durable component map.** The `TodoWrite` plan is per-run and dies with the box.
   A committed markdown map — stable `{#id}`s, `files:` globs, `needs:`/`links:` edges, `[x]/[~]/[!]`
   states — survives box reaping because it is in git, which matters here more than for a local tool.
   Cheap to adopt: a `plan-map` skill teaching the convention (skills already sync into every box)
   plus a `/plan.json` parser. No new infrastructure.
2. **Declared-vs-observed drift.** The plan says the agent is in component A; the files it is writing
   match component B's glob. A cheap, high-signal "this run is off the rails" indicator, and worth
   more here than in a local tool because the whole premise is that you walk away from the box. The
   observed half already exists in `/changes.json`, and the per-step attribution from the task board
   is the other half.
3. **`/` skill autocomplete in the Hub composer.** Works functionally; the menu only exists in the
   thread composer.
4. **A curated skill library** to seed new accounts.
5. **Billing.** Deferred deliberately — free during beta.

Explicitly **not** doing: an infinite zoomable canvas over the fleet. For a handful of boxes it is
strictly worse than the grouped, filterable table, and it would be copying a competitor's marketing
rather than its engineering.

---

## Where to look next

- `docs/README.md` — index of this folder
- `docs/architecture.md` — how a request flows
- `docs/runbook.md` — operating it
- `docs/security.md` — the security model
- `web/DESIGN.md` — every UI decision, round by round
- `PRODUCT.md` — product truth and principles (see the stale note above)
