# Runbook

Live, verified commands. Phase 1 proven on vps 2026-08-16.

## Host facts (vps)
- microsandbox: `msb` v0.6.9 at `/root/.local/bin/msb`, MSB_HOME `/root/.microsandbox`.
- `msb doctor`: KVM ready (svm, /dev/kvm r/w, libkrunfw loaded). Reflink unavailable on
  ext4 → clones fall back to sparse copies (slower create, more storage). Non-blocking.
- Cached images: `node` (v26.7.0), `python`.
- ccproxy: `https://your-ccproxy.example.com` — exposes BOTH an OpenAI route (`/v1/...`,
  key `dummy`) AND a native **Anthropic route `/v1/messages` (→ 200)**. Claude Code uses the
  Anthropic route. Models incl. `ak-claude-opus-4.8`, `ak-claude-sonnet-4.6` (alias labels
  may warn "retired" but the calls return real completions).

## Phase 1 — VERIFIED end-to-end

### 1a. Boot a microVM + egress
```bash
msb run -d --name p1test --net public --idle-timeout 15m --pull never node -- sleep infinity
# boot: ~0.5s
msb exec p1test -- sh -lc 'node -v; curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/'
# -> 200 (internet egress works)
```

### 1b. Ship repo INCLUDING local uncommitted changes
```bash
# --copy-dir is a BOOT-TIME flag: use it on `msb run`, not on a running box.
msb run -d --name p1repo --net public --idle-timeout 15m \
  --copy-dir /path/to/repo:/workspace -w /workspace --pull never node -- sleep infinity
msb exec p1repo -- sh -lc 'cd /workspace && ls -la && git log --oneline | head'
# -> repo files + .git history + uncommitted changes all present
```

### 1c. Claude Code via ccproxy
```bash
msb exec p1repo -- sh -lc 'npm i -g @anthropic-ai/claude-code'   # ~10s -> claude 2.1.233
msb exec p1repo \
  -e ANTHROPIC_BASE_URL=https://your-ccproxy.example.com \
  -e ANTHROPIC_API_KEY=dummy \
  -e ANTHROPIC_MODEL=ak-claude-opus-4.8 \
  -- sh -lc 'cd /workspace && claude -p "…task…" --permission-mode acceptEdits'
# -> agent reads repo, edits files, reaches model through ccproxy. Verified.
```

### 1d. MCP server in-box
```bash
msb exec p1repo -- sh -lc 'cd /workspace && \
  claude mcp add fs -- npx -y @modelcontextprotocol/server-filesystem /workspace'
msb exec p1repo -- sh -lc 'cd /workspace && claude mcp list'   # -> fs: … √ Connected
# Force MCP tool use:
msb exec p1repo -e ANTHROPIC_BASE_URL=… -e ANTHROPIC_API_KEY=dummy -e ANTHROPIC_MODEL=… \
  -- sh -lc 'cd /workspace && claude -p "use mcp__fs__* to list and write a file" \
     --permission-mode acceptEdits \
     --allowedTools mcp__fs__list_directory mcp__fs__write_file'
# -> Claude invoked the MCP tools. Verified (wrote MCP_PROOF.txt).
```

### 1e. Copy results out
```bash
msb cp p1repo:/workspace/AGENT_RAN.txt ./out/AGENT_RAN.txt
```

## Measured footprint (running box w/ Claude Code + MCP)
`msb metrics p1repo`:
```
CPU 0.01/1c   MEM 86.6 MiB / 512 MiB   UPTIME 2m33s
```
→ ~87 MB RAM per active box. On ~5 GB free host headroom: dozens of concurrent boxes.

## Teardown
```bash
msb stop p1test p1repo && msb rm p1test p1repo
```

## Notes for the orchestrator (Phase 2)
- `--copy-dir` is boot-time → the box is created per-delegation with the repo baked in.
- Resume/continue = `msb exec <box> -- claude -c -p "<follow-up>"` (`-c` continues session).
- Auto-teardown via `--idle-timeout` / `--max-duration` on the initial `msb run`.
- Model default: pick a current alias from ccproxy `/v1/models` (avoid retired-labeled ones).

## Phase 2 — MCP orchestrator (built, not yet live-tested)
The MCP server is the single entry point (no bash wrapper). It syncs the local working tree
to the VPS, then drives msb over SSH.

Flow per `delegate({repo, task})`:
1. `rsync -az --delete --filter=':- .gitignore' --filter='+ /.git/**' <repo>/ VPS:<staging>/<session>/`
   (working tree incl. uncommitted changes; .git kept; ignored files skipped)
2. `msb run -d --name <session> --net public --idle-timeout … --max-duration … \
     --copy-dir <staging>/<session>:/workspace -w /workspace --pull never node -- sleep infinity`
3. install claude if missing, then `msb exec <session> -e ANTHROPIC_* -e AGENT_TASK=<task> \
     -- sh -lc 'cd /workspace && claude -p "$AGENT_TASK" --permission-mode acceptEdits | tee -a .agent.log'`

All msb calls go over SSH; every arg is single-quoted for the remote shell (task/env can't
inject). Task text travels as `$AGENT_TASK` env, never interpolated into the command string.

### Local test (before deploying on VPS)
```bash
cp .env.example .env      # set VPS_SSH, VPS_STAGING_DIR, ccproxy + creds
npm run build
# Point Cursor at dist/index.js as an MCP server, or smoke-test the modules directly.
# Requires: passwordless SSH to VPS_SSH, msb present on VPS, node image cached.
```

### Config (see .env.example)
- `VPS_SSH` / `VPS_STAGING_DIR` — client→VPS rsync target + staging base.
- `MSB` / `MSB_IMAGE` / `MSB_IDLE_TIMEOUT` / `MSB_MAX_DURATION` — box runtime.
- `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` — ccproxy for in-box agent.
- `GH_TOKEN` / `NPM_TOKEN` — creds injected per-exec (see Phase 4+5 below).

## Phase 2 — VERIFIED live on vps 2026-08-16
Ran `dist/smoke.js` (loads .env, exercises the real modules) against a throwaway repo with an
uncommitted file. Full loop in ~43s:
- sync: local tree incl. **uncommitted** `LOCAL_UNCOMMITTED.txt` landed in box
  (`git status` in-box showed `?? LOCAL_UNCOMMITTED.txt`).
- boot: box up, repo baked into /workspace.
- agent: Claude Code via ccproxy created the requested proof file.
- status: `msb ls` shows the running box (512 MiB cap).
- teardown: box removed **and** its staging dir cleaned.

Findings applied:
- Model default → `ak-claude-opus-5` (was `ak-claude-opus-4.8` which mapped to a retired Opus
  and printed a retirement warning). Pick current aliases from `/v1/models`.
- Teardown now also `rm -rf`s the session's staging dir (was leaking one dir per delegation).

`src/smoke.ts` is a live-test harness, not part of the MCP server.

## Phase 4 + 5 — VERIFIED live on vps 2026-08-16
Hardened credentials/egress and added polish. Verified the full dev workflow end-to-end.

### What was added
- **Egress allowlist**: `--net-default-egress deny` + `allow@dns` + `allow@<domain>:tcp:443`
  for ccproxy, npm, GitHub (and per-call extras via the `allowDomains` delegate param). A
  leaked token in the box is useless off-list.
- **Memory cap** `-m` (default 1G) and **concurrency cap** `MSB_MAX_BOXES` (delegate refuses
  past the limit, counted via `msb ls`).
- **Credentials so the agent works like local Claude Code**: bootstrap installs `gh` + npm auth but
  sets **no** default identity/token. The access-resolved account(s) are applied afterwards —
  per-owner `~/.git-credentials`, per-repo `user.name/email`, and `GH_TOKEN` (first repo's owner).
  Result: the in-box agent can fix → commit → push → open a PR as the account that actually has access.
- **Warm-start snapshot**: `npm run bake` boots a bare box, installs claude+gh, and
  `msb snapshot create`s `agent-base`. Set `MSB_SNAPSHOT=agent-base` to skip the ~10s install.
- **No AI attribution**: a standing `--append-system-prompt` policy forbids "Generated with
  Claude Code" / "Co-Authored-By: Claude" / 🤖 in commits and PRs. Verified: a delegated
  commit produced a clean message with no attribution.

### msb 0.6.9 gotchas found (and handled)
- `--copy-dir` CANNOT be combined with `--from-snapshot` ("patches cannot be combined with
  from_snapshot"). Snapshot path boots warm, then `msb copy` the tree in post-boot.
- `-w /workspace` fails on snapshot boot (dir doesn't exist yet) → only set for image boot.
- `msb copy <dir> box:/dest` copies the dir *into* /dest (trailing `/.` ignored) → copy to a
  temp path, then `cp -a /.wt/. /workspace/`.
- `--dangerously-skip-permissions` is refused as root (boxes run as root) → use
  `--allowedTools Bash Edit Write Read Glob Grep` instead.

### Verified
- Delegated "fix bug → branch → commit → push → open PR" against a throwaway private repo:
  agent opened a real PR with the fix pushed. ✅
- Delegated a commit-only task: message clean, no AI attribution. ✅

### New config (see .env.example)
- `MSB_SNAPSHOT` warm-start snapshot name (empty = boot from image).
- `MSB_MEMORY` / `MSB_MAX_BOXES` host protection.
- `EGRESS_DOMAINS` extra allowed domains (comma-separated).
- `EGRESS_ALLOW_ALL` set truthy for open egress (any domain; overrides allowlist).
- `NPM_TOKEN` optional in-box npm (public registry) cred. (No `GH_TOKEN`/`GIT_AUTHOR_*` — GitHub
  access is reactive, resolved per repo from the login-keyed store.)

## E2E benchmark — vps 2026-08-16 (all features on)
Host baseline: 15 GB RAM (5.1 GB free), 154 GB disk (92 GB free), 4 vCPU, shared with
Dokploy/ccproxy/ak-rdp. Warm snapshot `agent-base` (claude+gh baked), mem cap 1G, egress
allowlist (8 domains), creds injected, no-attribution policy on. Via `npm run bench`.

Task: fix 2 bugs in a Node repo, run `npm test` (passed), commit — verified end to end.

### Phase timings (single delegation)
| phase | run 1 | run 2 |
|-------|-------|-------|
| sync tree (rsync Mac→VPS) | 5.4s | 5.1s |
| boot + copy (from snapshot) | 8.2s | 8.3s |
| bootstrap (creds/tools, warm) | 2.5s | 2.4s |
| agent task (Claude via ccproxy) | 37.0s | 57.3s |
| teardown (stop+rm+staging clean) | 13.1s | 13.8s |
| **boot-to-ready** (sync+boot+bootstrap) | **16.0s** | **15.7s** |
| **TOTAL** | **66.1s** | **86.8s** |

Infra overhead is steady ~16s to a ready box; agent time dominates and varies with task.

### Optimization: SSH connection multiplexing (boot-to-ready 16s → ~8-10s)
Root cause of the 16s: each `msb`/rsync call opened a FRESH ssh connection (~2.1s handshake),
and a delegation makes ~6 of them → ~12s of pure handshake. Enabling ssh ControlMaster
(one persistent master connection, `src/ssh.ts`) drops each subsequent call to ~0.4s.

Measured after (same task/host):
| phase | before | after |
|-------|--------|-------|
| sync tree | 5.4s | 1.4–3.6s |
| boot + copy | 8.2s | 4.2–7.7s |
| bootstrap | 2.5s | **0.7s** |
| teardown | 13.1s | **4.5–5.2s** |
| **boot-to-ready** | **16.0s** | **~8–10s** |

Remaining fixed cost is the msb microVM boot (~4s) itself. Socket path is kept short
(`~/.ssh/asb/<hash>.sock`) to stay under the ~104-char Unix-socket limit. Tunable via
`SSH_PERSIST` (default 120s keeps the master warm between back-to-back delegations).

### Optimization: warm pool (boot-to-ready ~8-10s → ~4s)
Keep `MSB_POOL_SIZE` boxes pre-booted from the snapshot AND pre-bootstrapped (claude+gh +
git/gh auth) idle. A delegation claims one and only copies the repo in — skipping the ~4s
microVM boot and the bootstrap step. The pool refills on claim (fire-and-forget) so the next
delegation is also instant. Pool state = the running `pool-*` boxes on the VPS (survives MCP
respawns). The MCP server **auto-seeds the pool on start** (fire-and-forget), so you normally
never touch it. Check state with `npm run pool:status` or the `pool_status` MCP tool; seed/top
up manually with `npm run pool:warm`.

Egress tradeoff (decided): pooled boxes boot with OPEN egress so any task can reuse them, so
the pool is only used when the delegation wants open egress (`EGRESS_ALLOW_ALL=1` and no
per-call `allowDomains`). A restricted-egress delegation always cold-boots with its exact
allowlist — never a pooled open box. Claimed vs free is tracked by a `/.claimed` sentinel in
the box; `countBoxes` ignores unclaimed pool boxes for the concurrency cap.

**Self-heal against msb state desync.** msb can end up with a pool box that `ls` reports as
`Stopped`/`exited` while its daemon still holds a "running" record — so a refill's `msb run`/exec on
it fails with `error: sandbox still running: cannot start … already running`, and worse, a claim of
such a box records the task but never actually runs (the box shows `run:running` while Stopped → the
UI flickers as each poll reads contradictory state). Guards:
- `allPoolBoxes` now reads `msb ls --format json` and keeps only **Running** boxes; `listPoolBoxes`
  reaps the rest first (`reapDeadPoolBoxes` = `stop` + `rm --force`), and also reaps any box that is
  Running-but-not-execable. So it only ever hands back a live, free box.
- `refillPool` reaps before counting the deficit, so a fresh boot can't collide with a stale record.
- `acquireBox` treats a failed claim as a desync: it reaps and falls through to a clean cold boot
  instead of returning a dead box.
- `countBoxes` likewise only counts Running boxes and won't throw on an unexecable one.

If the pool ever wedges anyway, the manual reset is `msb stop <box> && msb rm --force <box>` for each
`pool-*`, then `node dist/pool-warm.js` (in the container) to reseed.

Measured (warm claim):
| phase | cold (mux) | warm claim |
|-------|-----------|------------|
| sync tree | 1.4–3.6s | 1.4s |
| acquire (boot vs claim+copy) | 4.2–7.7s | **2.3s** |
| bootstrap | 0.7s | **0.5s** (already done) |
| **boot-to-ready** | ~8–10s | **~4.3–4.4s** |

Cumulative: **16s → ~4s** boot-to-ready (mux + pool). Idle pool cost ~60 MiB per box.

### More config (see .env.example)
- `SSH_PERSIST` ssh master keep-alive seconds (default 120).
- `MSB_POOL_SIZE` warm boxes to keep idle (default 1; 0 disables). Auto-seeded on MCP start;
  inspect with `npm run pool:status` / `pool_status` tool, top up with `npm run pool:warm`.

### Footprint (per box)
- Idle from snapshot: **~60–63 MiB** RAM (measured across 5 boxes).
- With Claude Code + agent work: **~98–114 MiB** RAM, <0.02 CPU of 1 core.
- Disk: workspace 232K (test repo); overlay root ~465M used of 3.9G per box.

### Density / concurrency
- **5 boxes booted concurrently in ~5.1s.**
- 5 idle boxes together: host free RAM 5.1G → 4.8G (≈300 MiB for all five).
- After teardown: RAM fully reclaimed (5.2G free), no boxes, staging empty — **zero leak**.
- With ~5 GB headroom and ~62 MiB/idle box (~110 MiB active), the host can hold **dozens**
  of boxes; `MSB_MAX_BOXES` (default 5) is the safety cap, not a hard limit.

## Post-Phase-1 features — VERIFIED live on vps 2026-08-18

### Remote deploy (standalone compose, NOT Dokploy)
The HTTP controller runs as a plain `docker compose` stack from a git clone at
`/root/agent-sandbox-deploy`. `.env` + `deploy/id_ed25519` are gitignored (survive pulls).
```bash
ssh hostbrr 'cd /root/agent-sandbox-deploy \
  && git fetch origin main && git reset --hard origin/main \
  && docker compose up -d --build'
# server logs: "HTTP MCP on 0.0.0.0:8787 (bearer-guarded)"
curl -s -o /dev/null -w '%{http_code}\n' https://agent-sandbox.example.com/mcp   # 401 (no token)
```
Live smoke through the remote MCP: `delegate(source:git, repo:owner/name, task:"analyze …")`
returned findings (read-only, no PR — task defines the goal); `resume`/`status` worked;
teardown removed the box + staging. ✅

### Multi-repo delegation
`delegate({repos:[{repo,ref?},…], task})` stages each repo into `<sessionRoot>/<name>` and copies
the session root into the box, so each lands at `/workspace/<name>` in ONE box. Single `repo` still
works; a multi-root IDE window passes its folders as `repos`. The repo-layout hint states only
*where* the repos are — the task defines the outcome (analysis/fix/PR/tests/anything).

### On-demand secrets (ask-then-resume, ephemeral)
GitHub access is resolved per repo from the store (no default token). For anything else the agent
needs (a DB URL, an API key, or a GitHub token for a repo no stored account can reach), the standing
system prompt tells it to STOP and name the exact env var — never fail silently, fabricate, or print
secret values. You then:
```jsonc
resume({ session, message: "use it", secrets: { "GITHUB_TOKEN": "…", "DB_URL": "…" } })
```
Secrets inject as `-e KEY=VALUE` on that exec only (same path as `GH_TOKEN`), shell-quoted over
SSH, never stored — gone on the next exec / teardown. Pure `secretEnvFlags()` is unit-tested.

### Interactive Q&A (sandbox agent ↔ calling agent) — A2A
Development is a conversation. `/workspace/.agent.question` is the in-box agent's **only** channel to
the caller; it PAUSES and asks instead of guessing or silently working around a problem. The system
prompt makes it STOP and write the question in three cases:
1. **Decision / missing fact** it can't safely infer (ambiguous requirement, which approach,
   confirmation before something destructive).
2. **Missing credential / connection detail** (token for a private repo, DB URL, API key) — it names
   the exact env var(s) it needs so the caller can re-run with them via `resume`'s `secrets`.
3. **Environment blocker** — a failed `npm install` / build / test / auth, a 401/403 from a package
   registry or API, a missing tool or scope. It reports the exact failure (command + key error line)
   and what would unblock it, and does **not** declare the task done or skip a required step.

Loop:
1. Agent writes the question to `/workspace/.agent.question` and ends its turn.
2. The `delegate`/`resume` call — which is **blocking** — was waiting server-side for exactly this;
   it returns now with **`run:waiting`** and the question text (a pending question overrides
   `run:done`, so a finished-but-unanswered run still shows as waiting).
3. The **calling agent answers**: from repo/context if it can, otherwise it asks the user; then calls
   `resume(session, "<answer>")` (secrets, if needed, ride along as ephemeral env for that step only).
4. `resume` clears the question file, continues the SAME Claude session (`claude -c`), and BLOCKS
   again until the next boundary — returning the next question or the final result.

This gives the Claude-web feel (ask → answer → continue) with no new infra — the interactive
turn-taking rides on the blocking `delegate`/`resume` calls. `formatProgress` and the pure
`waitForBoundary`/`isBoundary` loop are unit-tested.

### Blocking (interactive) delegate/resume
`delegate` and `resume` launch the agent detached, then **block server-side until the agent reaches a
boundary** — a question (`run:waiting`) or completion (`run:done`) — via `waitForBoundary` (polls the
sentinels every `WAIT_INTERVAL_MS`, default 3s). The open MCP call is the "listener" that keeps the
calling agent from ending its turn early. The run writes `/workspace/.agent.running` while in flight
and `/workspace/.agent.done` (holding the exit code) when finished; output streams to
`/workspace/.agent.log`.

- **Timeout fallback:** if no boundary is hit within `WAIT_TIMEOUT_MS` (default 75s — kept under the
  MCP client's HTTP timeout so the IDE never hangs), the call returns "run:running — still working …
  reconnect with status". `status` is the pull-based reconnect and returns the question/result as
  soon as there is one.
- **Idle-stop while waiting:** a box paused on a question can outlive `--idle-timeout` and be Stopped
  by msb (its rootfs + Claude session persist). `resume` calls `startBoxIfStopped` first, so the
  answer reaches the same session instead of failing the exec.
- **Repo-shipped Claude hooks are bypassed.** A cloned repo can carry its own `.claude/settings.json`
  with hooks meant for a trusted human setup — e.g. a `UserPromptSubmit` "plugin gate" that hard-
  blocks every prompt when marketplace plugins aren't installed. In a headless box those plugins
  aren't present, so the agent would exit 0 having done nothing. Two guards run before every launch:
  the `claude` invocation passes `--setting-sources user` (project `.claude/settings.json` and its
  hooks are never loaded; tools come from our `--allowedTools`), and `trustWorkspace` sets
  `hasTrustDialogAccepted` for `/workspace` and each `/workspace/<repo>` in `~/.claude.json`. This is
  a per-run fix (flag + bootstrap), independent of the warm snapshot.
```jsonc
status({ session })   // -> "run:running" | "run:done exit=0" | "run:idle" | "run:waiting" + last ~60 log lines
```
`run:waiting` = the agent asked a question (see Interactive Q&A above); answer via `resume`.

### Fleet monitor — what's up and what each box is doing
`status` is one session; `monitor` is the whole fleet. It answers "how many sandboxes are up right
now and what is each doing" in one call:
```jsonc
monitor({})   // or: npm run monitor  (on the VPS / from dist)
```
It runs `msb ls --format json`, then per box reads one combined sentinel (claim marker + run state +
task + question) and one `msb metrics`, and renders:
- a **summary line** — total up, sessions vs warm-pool-free, how many running / waiting;
- **one block per box** — role (`session` / `session(pool)` for a claimed pool box / `pool(free)`),
  run state (`running` / `WAITING(needs answer)` / `done exit=N` / `idle`), uptime, cpu·mem, the
  `task:` it's working on, and the pending `question:` when it's waiting.

Sessions are listed before free pool boxes. The task text comes from a new `/workspace/.agent.task`
sentinel the run writes (first run overwrites, a resume appends the follow-up). Per-box reads are
best-effort — a box that vanishes mid-scan just degrades its own row. Shaping/formatting (`parseLsJson`,
`classifyBox`, `parseRunState`, `parseMetrics`, `formatMonitor`) is pure and unit-tested; the IO
(`gatherMonitor`) lives in `msb.ts`.

**Running-only "up".** Only boxes whose lifecycle is *running* count as up; an auto-torn-down pool box
(msb `exited` / ls `Stopped`) is shown on a trailing `stopped (N): …` line, not in the count — it's
consuming nothing and can't be doing anything. `msb metrics` STATE is preferred over the `ls` status
for currency (ls can briefly lag a just-stopped box).

**`parseMetrics` parses by header column positions**, not naive whitespace splitting — real rows break
that: a stopped box shows an em-dash CPU (→ `undefined`, not a literal dash), the DISK/NET cells contain
the word "total", and uptime reads "ran 59m59s" (the `ran ` prefix is stripped). Each cell is sliced at
its header label's offset.

### Watch one box live — over-the-shoulder view
`monitor` is the fleet; `watch` is one box in detail, for visually following what an agent is doing:
```jsonc
watch({ session, lines?: 40 })   // MCP: rich one-shot snapshot (state + task + log tail)
npm run watch -- <session> [--lines N] [--interval MS]   // CLI: redraws every ~2s until done/gone
```
The MCP tool returns a header (box name + lifecycle, run state, task, pending question, uptime/cpu/mem)
followed by the last N lines of `/workspace/.agent.log` — richer than `status`. The CLI clears the
screen and redraws each frame so you watch the log grow in real time; it stops on its own when the run
finishes (and is not waiting on a question) or the box is gone. `gatherWatch` never throws — a missing
box yields a `missing` snapshot so the poll loop exits cleanly. `formatWatch` is pure/unit-tested.

### Web dashboard (browser, token-protected)
The HTTP entry (`http.ts`) also serves a visual dashboard for people who'd rather not use a terminal:
```
https://<ASB_DOMAIN>/dashboard?token=<MCP_HTTP_TOKEN>
```
- **`/dashboard`** — a self-contained HTML page (no build step, no external deps; `dashboardHtml()`
  returns the whole string). It reads `token` from its own URL and **polls `/monitor.json` every 3s**,
  rendering a KPI stat-card row (up / running / waiting / pool-free) above a "Sandboxes" grid of
  cards (role, run-state badge, per-metric tiles, task, question). A sticky top bar shows a live
  connection dot and a **light/dark theme toggle** (persisted to `localStorage`; both palettes are
  hand-authored shadcn-style `data-theme` token sets on `<html>`). Click a card to open its log
  panel, which polls **`/watch.json?session=…`** for that box's live log tail.
- **`/fleet.json`** and **`/watch.json?box=&lines=`** — JSON forms of `gatherMonitor` /
  `gatherWatch`, same data the `monitor` / `watch` tools render as text.
- **Auth (fails closed):** `checkDashboardAuth` accepts the token via `Authorization: Bearer` (the
  page's fetch calls) **or** the `?token=` query param (so a browser navigation works — it can't set
  headers). All four routes 401 without a valid token; the whole thing is behind the same
  `MCP_HTTP_TOKEN` as `/mcp`, and Traefik already forwards every path on `ASB_DOMAIN` to the container
  (no compose change needed).
- **Polling, not SSE — deliberate:** a 3s snapshot dashboard is the textbook polling case; polling is
  robust behind Traefik (no persistent-connection buffering/timeout tuning) with negligible overhead.
  Reserve SSE/WebSockets for sub-second event push (chat, live trading), which this isn't.
- The container image has no `curl`; to smoke-test on the VPS use `node -e` with `http.get` (see the
  live-verification pattern used during rollout), or just open the URL in a browser.

### Login-keyed, access-based GitHub token store (reactive)
Keyed by **account login**, stored on the VPS at `~/.agent-sandbox/gh-tokens.json` (chmod 600):
`{login, token, type, orgs[], verifiedRepos[]}`.

**User flow (no upfront setup):**
1. `delegate({source:"git", repo:"atom-insurance/elseco-deal-service", task:"…"})`.
2. If no stored account can access it, delegate replies: *"No stored GitHub account can access … —
   re-call with githubToken:'…'"*.
3. `delegate({… , githubToken:"ghp_…"})` → token is probed (login + orgs + repo access), stored by
   login, clone proceeds, and it's reused automatically next time.
4. If **several** stored accounts can access a repo, delegate asks you to pick:
   `delegate({… , githubAccount:"<login>"})`.

- Matching is by **access** (live `GET /repos/{owner}/{name}` per candidate), not owner-name.
- **No default account anywhere.** The box has no fallback identity or token. `bootstrap` does NOT run
  `gh auth setup-git` or set any `user.name/email`. Everything below is the access-resolved account(s)
  for THIS task's repo(s); if a repo resolves to nothing, it gets no identity/token (the agent asks).
- **Resolution runs for BOTH sources.** For `git` the arg is `owner/name`. For `local` the owner is
  read from each working tree's `origin` remote, so a locally-shipped repo picks the same
  access-correct account. Local is best-effort: an unresolved repo doesn't block a read-only task.
- Multi-owner tasks: per-owner `~/.git-credentials` entries (`credential.useHttpPath true`) so each
  repo pushes with the token that has access; the first repo's token drives the `gh` CLI
  (`GH_TOKEN`), so `gh pr create` uses an account that can actually see the repo.
- **Commit identity is PER REPO.** Each `/workspace/<name>` gets `git -C … config user.name/email`
  from the login of the account with access to THAT repo (`<login>` + `<login>@users.noreply.github.com`).
  A commit is therefore authored by the same account that can push it — fixing the bug where a commit
  was authored by an account with no access while the PR used another. Mixed-owner multi-repo tasks
  get the right author in each repo.
- **`resume` re-resolves identity too.** A follow-up only has a box id, so `resume` reads each in-box
  repo's `origin` (`boxRepoRefs`), re-resolves the access account per repo (`resolveCredsForBox`), and
  re-applies the per-repo identity/token BEFORE continuing the Claude session. This was the actual
  cause of the earlier `atom-bot` commit: the old `resume` passed no creds, so the box kept whatever
  identity a stale warm-start snapshot had baked in.
- **No baked identity survives.** `bootstrap` actively unsets any GLOBAL `user.name/email` (belt-and-
  suspenders against an old snapshot), and the per-repo LOCAL identity always wins over a global. If
  you ever see a wrong author, the snapshot is stale — **rebake it**: `node dist/bake-snapshot.js
  agent-base` (a fresh box must show `user.name = NONE`, no `~/.gitconfig`). The current
  `installTools`/bake sets no identity; an old snapshot baked one from a manual `gh auth login`.
- **GitHub Packages:** the box writes `//npm.pkg.github.com/:_authToken=<token>` to `~/.npmrc` so
  scoped `@owner/pkg` installs resolve. The token must have **`read:packages`** — otherwise `npm
  install` returns **E401** (seen with `@atom-insurance/deal-mgmt-core`). Grant `read:packages` when
  a repo pulls private GitHub Packages.
- `gh_token_add({token, repo?})` pre-registers a token; a token via `resume(secrets)` is also stored.
  Pure store/probe helpers are unit-tested.

## omp boxes boot from a shared image, not a copied snapshot

A `--from-snapshot` boot copies the snapshot's whole `upper.ext4` into the new box, and the host's
ext4 cannot reflink. For `agent-omp` that meant 3.4 GB of real host disk per omp box, before the
user did anything. An OCI image is different: msb stores its layers once, read-only and
content-addressed, and every box booted from it starts with an empty sparse upper. Measured: about
1.5 MB per box, a 0.9 s boot, and 3.9 GB free in the guest.

```bash
ssh hostbrr "cd /root/agent-sandbox-deploy && docker compose exec -T -e OMP_BAKE_NPX='@cap-js/mcp-server,hana-mcp-server,mcp-abap-abap-adt-api,@drawio/mcp,mcp-remote,btp-mcp-server,chrome-devtools-mcp@latest' agent-sandbox node dist/bake-omp-image.js agent-omp:1"
# then set MSB_OMP_IMAGE=agent-omp:1 in .env and restart the controller
```

`MSB_OMP_IMAGE` takes precedence over `MSB_OMP_SNAPSHOT`, which stays as the fallback. Docker on
the host builds `FROM` the digest msb already caches for `MSB_IMAGE`, so the base layers are shared
with the plain image. `docker save | msb load` imports the result, and the Docker copy is removed
afterwards. The build is one pruned `RUN`: it drops the onnxruntime CUDA/TensorRT providers
(~700 MB), non-linux-x64 binaries, bun's hardlinked install cache, and the baseline CPU builds when
the host has AVX2. That leaves a 1.44 GB layer. Remove old tags with `msb image rm`.

## The claude snapshot carries the MCP server packages, on a 3G disk

Every task start used to `npm i -g` the `npx …` MCP servers of the caller's config into the box
(`installMcpConfig` → `preinstallSh`), because the `agent-base` snapshot held only Claude Code. On
the 1G claude tier that was ~30s of every start, and from 2026-10-26 (`@cap-js/mcp-server` 0.1.0
pulled in onnxruntime; `btp-mcp-server` ships two 107 MB bun binaries) it no longer fit: the
install plus npm's tarball cache took the disk to 0 bytes free, and every later write of the run —
`git config`, the PR-only hooks, the agent log — failed with ENOSPC. The box booted, the task was
accepted, and the agent died before turn one; the dashboard showed a box that started and stopped.
Fifty-five runs went that way before anyone looked at `df` inside a box.

Two things changed. The pre-install is now disk-guarded (it reads free space before each package,
cleans the cache after each one, removes a failed install, and DROPS a server it could not install
from the run's config instead of leaving `npx` to download it mid-run — each decision is logged as
`[mcp] <box>: mcp-skip:… / mcp-fail:… / mcp-drop:…`). And the claude snapshot is baked with the
deployment's servers already installed, on a disk that holds them:

```bash
ssh hostbrr "cd /root/agent-sandbox-deploy && docker compose exec -T -e MSB_ROOT_DISK=3G -e BAKE_NPX='btp-mcp-server,@cap-js/mcp-server,chrome-devtools-mcp@latest,hana-mcp-server' agent-sandbox node dist/bake-snapshot.js agent-base-3g-2"
# compact it (below), boot-test, then set MSB_SNAPSHOT=agent-base-3g-2 in .env, `docker compose up -d`,
# and remove the warm box the pool booted from the old snapshot (msb rm --force <pool-…>) so it reseeds.
```

The guest cannot `fstrim` (virtio-blk without discard), so the install-then-delete churn of a bake
leaves ~1.5 GB of freed blocks allocated in `upper.ext4`, and a box boot copies allocated blocks.
Zero-fill and hole-punch on the host before switching to it (2.1 GB → 931 MB, 4 s boot):

```bash
ssh hostbrr 'F=/root/.microsandbox/snapshots/agent-base-3g-2/upper.ext4; mkdir -p /mnt/asb-snap; mount -o loop $F /mnt/asb-snap; dd if=/dev/zero of=/mnt/asb-snap/.zero bs=4M status=none || true; sync; rm -f /mnt/asb-snap/.zero; umount /mnt/asb-snap; fallocate -d $F; du -sh $F'
```

Two box facts the fix ran into: `/tmp` in a box is a 256 MB tmpfs in RAM, so a postinstall that
downloads something big dies with ENOSPC however large the disk is (onnxruntime-node's GPU
package, via `@cap-js/mcp-server`) — `preinstallSh` therefore runs npm with `TMPDIR=/root/.npm-tmp`
and `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`. And an `msb exec` that launches an MCP server binary
(even under `timeout`) returns with its whole output lost, as does an exec in the first ~10 s after
`msb run -d`; probe a fresh box with `ls`, not by starting a server.

A snapshot pins the root disk of every box booted from it, so `MSB_ROOT_DISK` matters at BAKE
time, not at boot (createBox omits `--root-disk` for snapshot boots). The upper is copied sparsely
(a 1G snapshot with 398 MB of content costs 398 MB per box and boots in ~5s), so the 3G tier costs
host disk only for what the packages actually weigh. `BAKE_NPX` is the explicit list: the bake
runs outside a login, so it cannot read the encrypted per-user MCP stores, only the operator's
legacy file. When a user adds a new `npx` server, the guard installs it per run if it fits, and
the next rebake makes it free.

## The service watches itself (2026-11-11)

The 2026-10 outage (every claude run dying before its first turn for two weeks, 55 runs, nothing
but "failed (exit 1)" to show for it) was found by a user. These are the pieces that find the next
one from the inside. All of them are best-effort and never throw into the sweep or a timer.

- **Start failures are named** (`src/run-health.ts`). A failed edge whose log has no session,
  tool call, plan or usage behind it is a start failure: the sandbox failed the run, not the
  agent. The notification says "failed to start" with the box's last lines, the thread's run pill
  says "Failed to start", the digest carries `startFailure.tail`. The third in a row alerts the
  operator (`[alert] start-failures` in the log; webhook + push), then once per 6h while it goes on.
- **Disk preflight** (`guardedAgentSh`, msb.ts). Before the agent launches, the box's free space is
  read; below 100M the npm caches and temp dirs are dropped and it is read again; still short means
  the run is NOT started: a note goes to the agent log, `250` to the done mark (the thread shows
  "Disk full", the notification "not started: the sandbox disk is full"), and the controller throws
  a `DiskFullError` so the caller gets a sentence instead of a dead box.
- **Warm boxes are checked before they are handed out** (`WARM_HEALTH_SH`, `warmBoxVerdict`). At
  warm-up time, where nobody waits, the box must have 100M free and `claude --version` must answer,
  or `/.ready` is never written and the box is removed (the refill boots another). The claim re-reads
  only the disk, in the same exec as the claim marker; a box that fails it is removed and the
  delegation cold-boots.
- **MCP install notes reach the thread.** `preinstallSh`'s `mcp-skip/fail/drop` lines are kept in
  the box (`/root/.agent-mcp.notes`); the watch probe reads them (`---N---`) and the thread says
  "Running without 2 MCP servers: btp-mcp-server (no disk space), ...". The MCP settings page shows
  each npx server as *baked in*, *installed each run* or *left out of the last run*
  (`/mcp-servers.json` `provision`).
- **Canary** (`src/canary.ts`, `CANARY_INTERVAL_MS`, default hourly). One real task
  ("Reply with exactly the word CANARY-OK") through `delegateOnce` as the operator, judged by its
  log, its box torn down; the fleet sweep skips `[canary]` boxes for notifications, history and
  memory. A failure alerts at once (then per 6h), the pass after a failure says "recovered". State
  on `/health.json`; `POST /health/canary.json` runs one now.
- **Host disk** (`src/host-disk.ts`). `df` under `MSB_HOME` every 10 min, one alert per 12h at
  `HOST_DISK_ALERT_PCT` (85). Daily (and 2 min after boot) the sandboxes dir is swept for
  directories `msb ls` no longer lists AND older than a day (`sweepOrphanSandboxDirs`); the listing
  must succeed and parse before anything is judged an orphan. Found on 2026-11-11: 13 dirs from
  one August afternoon, ~5G.
- **Baked package versions** (`src/package-watch.ts`). The bake writes `/etc/asb-baked-npm.json`
  (`npm ls -g --json`); every task start reports it (`mcp-baked:` line of the install exec). Daily the
  baked versions are compared to the registry's `latest`; a difference alerts "Rebake due" once a
  week. Pin the specs you bake (`BAKE_NPX=pkg@1.2.3`).
- **Claude boxes boot from an image** (`MSB_CLAUDE_IMAGE`, `npm run bake:claude-image`), like omp's
  `MSB_OMP_IMAGE`: one layer stored once, empty upper per box, instead of copying the 931M snapshot
  upper per boot. `claudeRootSource(cfg)` decides (image > snapshot > cold); the snapshot stays as
  the fallback when the variable is unset.
- **TMPDIR is on the root disk** (`/root/.tmp`, via `-e TMPDIR` on the agent exec and
  `/etc/profile.d/asb-tmpdir.sh` for login shells). The box's `/tmp` is a 256M tmpfs in RAM:
  anything parked there died with ENOSPC at 256M however large the disk was (the onnxruntime
  postinstall did). The scrub and the prune clear `/root/.tmp` too.
- **Snapshot compaction is part of the bake.** `bake-snapshot` zero-fills the guest's free space
  before stopping the box (the guest cannot fstrim) and runs `fallocate -d` on the snapshot upper on
  the host after `msb snapshot create` (`compactSnapshotUpper`): 2.1G -> 931M measured by hand on
  agent-base-3g-2, now automatic.

`/health.json` (dashboard token) returns all of it: canary, hostDisk, orphanSweep, startFailures,
baked, lastProvision, rebakeDue, claudeSource. The Fleet page shows the canary, the host disk and the
boot source under its heading.

### Updating the claude image from the dashboard

When baked packages fall behind, the Fleet page shows "Newer versions are available for the sandbox
image" with an **Update image** button (admins only; other users are sent no operator facts at all,
`/health.json` answers them with the canary alone). The button (`POST /health/image-update.json`,
`src/image-update.ts`) does the whole job:

1. plans the new image: the packages the notice names move to their latest, every other baked
   package is pinned at its current version, Claude Code included;
2. bakes `agent-claude:<yyyymmddhhmm>`;
3. switches new sandboxes to it by writing `DATA_DIR/image-override.json` (no `.env` edit, no
   restart; running sandboxes are not touched, the warm pool turns over within its max age);
4. runs the canary. If it fails, the previous image and Claude Code version come back.

The override only applies on top of the settings it was made on: change `MSB_CLAUDE_IMAGE` or
`CLAUDE_CODE_VERSION` by hand afterwards and the hand edit wins. Old image tags stay in msb's store;
remove the ones you no longer want with `msb image rm` when disk matters.

### Baking the claude image on the VPS (by hand)

    docker exec -e BAKE_NPX='@cap-js/mcp-server@0.1.0,btp-mcp-server@1.2.3' agent-sandbox       node dist/bake-claude-image.js agent-claude:1
    # then in /root/agent-sandbox-deploy/.env: MSB_CLAUDE_IMAGE=agent-claude:1
    docker compose up -d
    msb rm --force <the warm pool box>   # so the pool reseeds from the image

The image is shared by every user, so it bakes the list chosen for everyone (`BAKED_MCP_PACKAGES` in
`src/package-watch.ts`: mcp-remote, context7, sequential-thinking, with the reasons), not the
operator's own MCP servers. `BAKE_NPX` adds (or pins) more. Servers not in the image are installed
when a task starts. The daily check reports both newer releases and differences from the list
(added / removed), and the Update image button brings the image in line.

## What a sandbox can and cannot reach (audited 2026-11-11)

A box is a libkrun microVM with its own kernel, an overlay root and one virtiofs mount (`/.msb`,
the box's own `sandboxes/<box>/runtime/` on the host — writable from the guest, but per box, so a
guest writing there lands in its own directory and nowhere else). The guest's only neighbour is its
gateway (`172.16.21.41`), which answers DNS and nothing else; the compose network (controller, DB,
Traefik internals) is not routable from a box. Boxes are never reused across owners: a warm box
carries no owner secret until it is claimed, and a claimed box is destroyed, never re-pooled.

What DOES leave the controller for a box, by design, at task start: the owner's GitHub token for
the repos the task names, the model key for the run's provider, `NPM_TOKEN` if set, and the owner's
MCP store (headers and env included). Those are the agent's working credentials; the egress policy
decides where they can be sent. `EGRESS_ALLOW_ALL=1` (the current setting) lets a box talk to any
host on the internet, so a prompt-injected agent could post any of them anywhere — the in-box guard
hooks warn on obvious exfiltration patterns but are advisory. To close that, leave
`EGRESS_ALLOW_ALL` unset: boxes then get DNS plus the allow-listed domains only (`allowDomains` per
call, `DELEGATE_ALLOW_DOMAINS` as the default).

What never leaves the controller any more: its own operator token. Before this change the store's
`agent-sandbox-remote` entry (the controller itself, imported from a desktop MCP config with
`Authorization: Bearer <MCP_HTTP_TOKEN>`) was copied into every box's `/root/.agent-mcp.json`, so
any box could have driven the whole fleet as the operator. `boxExclusion()` in `src/mcp-store.ts`
now keeps any server whose header or env value equals `MCP_HTTP_TOKEN` or `DASHBOARD_TOKEN` out of
the in-box config (the MCP page shows it as **Kept out**, the controller log says
`[mcp] <box>: kept out of the box (carries the controller's operator token): <name>`). Agents that
need the controller get a per-user API key from the Account page; `BOX_SELF_MCP=1` restores the
old behaviour on purpose. If a token was ever exposed this way, rotate `MCP_HTTP_TOKEN` and
`DASHBOARD_TOKEN` in the host `.env` and restart.

## A browser in every sandbox (2026-11-11)

The dashboard's Browser pane and the agent share one headless browser, Moli (`/usr/local/bin/moli`,
version and sha256 pinned in `src/browser.ts`).

- **Where it comes from.** `agentImageDockerfile` installs it, so an image baked after this change
  carries it. A box from an older image installs it the first time the pane opens
  (`POST /browser/install.json`, about 4 s, archive checked against the pinned sha256, downloaded to
  `/var/tmp` because `/tmp` is a 256 MB tmpfs). It costs 107 MB of disk.
- **How the pane talks to it.** `POST /browser.json {session, op, ...}` runs a small script in the box
  over `msb exec`. The script makes sure a helper (`~/.asb/browser-daemon.cjs`, source in
  `src/browser-daemon.ts`) is running, restarts it when the controller's copy is newer, and posts the
  action. The helper listens on the box's `127.0.0.1:9334` and drives Moli over CDP on
  `127.0.0.1:9333`. Neither port leaves the box. One action per box runs at a time.
- **Cost.** About 220 MB of the box's memory while open (helper 65 MB, Moli 154 MB). Both exit after 15
  idle minutes. About 0.4 s per action.
- **Limits on the route.** Addresses are http or https only (`normalizeUrl`); the action is parsed to a
  fixed shape and embedded as JSON, never as shell. The route has its own limiter (600 a minute; a
  scroll is several calls) and writes no audit row per action. The global box-ownership check applies.
- **The agent.** Its system prompt says the browser exists and how to start it (`MOLI_PROMPT_HINT`).
- **When it misbehaves.** In the box: `curl -s -X POST -d '{"op":"quit"}' http://127.0.0.1:9334/` stops
  the helper and Moli; the next action starts them again. `moli --version` says whether it is installed.

### The agent's `browser` command

`installBrowserTool` (src/msb.ts) writes `/usr/local/bin/browser` on every turn: the helper file itself
(`/usr/local/lib/asb/browser.cjs`), run with arguments. `browser help` lists the commands. It talks to
the same helper and the same page as the pane, installs Moli on first use through
`/usr/local/bin/asb-moli-install`, and looks at the page at its own size (1280 x 800; `browser size`).

Moli lays a page out when it paints, not when a script asks for a size. The helper paints a few pixels
(`layout()`) before it measures anything and after every change of size. Two bugs came from leaving
that out: a wait that never saw an element a click had just added, and a pane that showed the agent's
phone layout stretched wide.

### The browser: trust, speed and upkeep (2026-11-11, second pass)

- **Who the helper trusts.** A page shown in the browser can reach `127.0.0.1` like anything else in
  the box, and the helper used to act on any POST it received: a hostile page could drive the browser.
  The helper now writes a random token to `~/.asb/browser.token` (mode 600) on each start and refuses
  a request that carries an `Origin` or `sec-fetch-site` header, a wrong `Host`, or no
  `x-asb-browser: <token>` header (403). A request built for another helper version gets 409.
- **The quick path.** `/browser.json` first runs one `curl` to the running helper (`browserFastSh` in
  `src/browser.ts`), with the action on stdin. Only when that misses (no helper, older helper, no
  token) does it send the full Node script that starts or replaces the helper.
- **The same picture is not sent twice.** Every action from the pane says which picture it already
  shows (`have`); the helper answers `same: true` without the picture when nothing changed.
- **Idle and restore.** The helper and Moli exit after 5 idle minutes (was 15), which gives about
  150 MB back to the agent. The address and scroll position are kept in `~/.asb/browser-last.json`
  and restored on the next action.
- **Memory guard.** The helper will not start Moli when the box has under 160 MB available; the pane
  says so (`code: low-memory`) instead of the agent being killed.
- **Fonts.** Moli does not load web fonts. The helper reads a page's Google Fonts stylesheet links,
  saves the fonts to `~/.fonts/asb` (at most 24 per stylesheet, 400 in all) and reloads the page once.
  The image recipe adds `fonts-liberation` and `fonts-noto-color-emoji`; boxes get them after the
  next **Update image**.
- **Errors.** The helper keeps the current page's console errors and failed requests. The pane shows
  the count; the `logs` action returns them. The agent reads the same list with `browser console`.
- **Pictures on disk.** `browser shot` without a file name saves to `$TMPDIR/browser` and keeps the
  newest 30.
- **Agent commands added.** `browser hover <target>`, `browser shot --of <target>`, `browser reset`.

### The console's inline theme script and the CSP

The shell (`web/index.html`) sets the theme before first paint with a few inline lines. Under
`script-src 'self'` the browser refused them, so dark-theme users saw a light flash on every load.
At start the controller hashes the inline scripts of the built `index.html`
(`allowShellScripts` in `src/security-headers.ts`) and adds those hashes to `script-src`. There is
still no `'unsafe-inline'`: any other inline script has a different hash and stays blocked.
