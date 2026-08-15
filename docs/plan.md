# Build plan

Phased, each phase independently verifiable.

## Phase 0 — repo scaffold (this)
- Repo structure, README, architecture, package.json, delegate bash skeleton, MCP skeleton.
- **Verify:** `npm run build` compiles the TS skeleton; `scripts/delegate.sh --help` prints usage.

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

## Phase 2 — delegate.sh (bash core)
Wrap Phase 1 into one idempotent script: `delegate.sh --repo <path> --task "<text>" [--name box1]`.
Handles: box create, repo ship, cred injection, agent run, log capture, teardown.
- **Verify:** one command reproduces Phase 1.

## Phase 3 — orchestrator MCP (TypeScript)
Thin MCP server exposing tools:
- `delegate(repo, task)` → starts a box via delegate.sh, returns a session id + streams status
- `status(session)` → current state + recent logs
- `resume(session, message)` → answer a follow-up / continue (`msb exec`/`ssh` into the box)
- `continue(session)` → keep going
- `teardown(session)` → stop + remove box
- **Verify:** from Cursor, connected to the remote MCP, delegate a real task and get status back.

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
