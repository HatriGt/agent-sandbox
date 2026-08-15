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
- `GIT_TOKEN` / `NPM_TOKEN` — optional short-lived creds, injected per-exec.

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
