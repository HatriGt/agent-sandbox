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
- **Credentials so the agent works like local Claude Code**: `GH_TOKEN` (+ `GITHUB_TOKEN`)
  injected per-exec; bootstrap runs `gh auth setup-git`, sets git identity, wires npm auth.
  Result: the in-box agent can fix → commit → push → open a PR.
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
- `GH_TOKEN` / `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` / `NPM_TOKEN` in-box creds.

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
