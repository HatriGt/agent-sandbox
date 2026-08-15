# Build plan

Phased, each phase independently verifiable.

## Phase 0 — repo scaffold (this)
- Repo structure, README, architecture, package.json, MCP skeleton.
- **Verify:** `npm run build` compiles the TS skeleton.

## Phase 1 — prove the loop manually (no MCP yet)
The single most important milestone. On the VPS, by hand:
1. `msb run` a base image (Ubuntu/Node) with:
   - `--copy-dir <repo>:/workspace` (repo incl. local uncommitted changes)
   - `-e ANTHROPIC_BASE_URL=https://your-ccproxy.example.com` (+ auth as ccproxy expects)
   - `-e` git/npm creds (short-lived), or `--secret-conf`
   - `--net public` (or an allowlist reaching ccproxy + npm + git remotes)
   - `--idle-timeout`/`--max-duration` for auto-teardown
2. Inside the box: install Claude Code CLI, run a trivial task, confirm it reaches the model via ccproxy.
3. Register one MCP server in-box, confirm Claude Code can call it.
4. `msb cp` results back out.
- **Verify:** Claude Code completes a real task end-to-end; output captured on host.
- Record exact commands + timings in `docs/runbook.md`.

## Phase 2 — orchestrator MCP (TypeScript), the single entry point
No bash wrapper. The MCP server *is* the delegate logic: it shells out to `msb` directly
via Node `child_process`. In Cursor you say "delegate this to agent sandbox" → Cursor calls
the MCP tool → the server runs the proven Phase 1 `msb` sequence.

Tools:
- `delegate(repo, task)` → creates a box, ships the repo, injects creds, runs Claude Code;
  returns a session id + initial status
- `status(session)` → current state + recent logs
- `resume(session, message)` → answer a follow-up / continue (`msb exec` → `claude -c -p`)
- `teardown(session)` → `msb stop` + `msb rm`
- **Verify:** from Cursor, connected to the remote MCP, delegate a real task and get status back.

### The local-uncommitted-changes problem (decided: sync working tree to VPS)
The MCP runs on the VPS; your editable working tree lives on your Mac. "Delegate THIS"
must include local uncommitted changes. So `delegate` needs the current working tree on the
VPS before `msb --copy-dir` can ship it into the box. Chosen approach:
- A tiny client-side step syncs the Mac working tree → a staging dir on the VPS
  (`rsync`/`git bundle`+patch over SSH), then the MCP copies from that staging dir into the box.
- Exact mechanism finalized in Phase 2 (keep it dumb: rsync the tree, respecting `.gitignore`).

## Phase 4 — credential strategy hardening
Move from `-e` env creds to the safer pattern: short-lived tokens, `--secret-conf`, and an
egress allowlist so the box can only reach ccproxy + the git/npm remotes it needs.
Optionally borrow Cleanroom's host-side gateway idea if we want zero secrets-in-box.
- **Verify:** box completes an npm publish + git push without a long-lived PAT living inside it.

## Phase 5 — polish
Concurrency cap, auto-teardown defaults, snapshot warm-start for faster boots, status streaming UX.

## Open decisions (revisit as we learn)
- MSB_HOME on a reflink-capable fs (XFS/btrfs loop) to enable CoW clones → faster/cheaper boxes.
- Base image: prebuilt with Claude Code + common toolchains, snapshotted for sub-second warm start.
- How Cursor authenticates to the remote MCP (SSH tunnel vs authenticated HTTP).
