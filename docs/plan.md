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

Tools (current shape):
- `delegate({source?, repo?, repos?, task, ref?, allowDomains?})` → stages the code, injects creds,
  **launches Claude Code in the background**, and returns a session id **immediately** (async — no
  waiting on the agent, so it never hits the MCP response timeout). Poll `status` for progress/result.
  - `source`: `local` (rsync working tree, default) or `git` (clone `owner/name` on the VPS).
  - `repos:[{repo,ref?}]` for a **cross-repo** task — each lands in `/workspace/<name>` in ONE box
    (single `repo` still works; a multi-root IDE window's folders are passed here by the agent).
  - Missing required info is **asked back**, not failed. Local with no repo falls back to
    `WORKSPACE_DIR` (`${workspaceFolder}` from the IDE).
  - **GitHub access is resolved by ACCESS from a login-keyed store** (see below). If exactly one
    stored account can reach the repo it's used silently; if several can, delegate asks you to pick a
    login; if none can, delegate asks for a token — which is then validated, stored, and reused.
  - New args: `githubToken` (answer the "need a token" ask) and `githubAccount` (answer the
    "which account" ask).
- `status(session)` → run state (`running` / `done exit=N` / `idle` / **`waiting`**, from in-box
  sentinels) + log tail. `waiting` means the agent asked a QUESTION (wrote `/workspace/.agent.question`)
  and paused; the calling agent answers (from context, else asks the user) and calls `resume`.
- `resume(session, message, secrets?)` → answer a follow-up / continue (async, like delegate).
  `secrets:{KEY:val}` injects **ephemeral** env for that step only. A GitHub token passed here is
  also probed + stored (login-keyed) so it's reusable next time.
- `teardown(session)` → `msb stop` + `msb rm`
- `pool_status()` → warm-pool availability.
- `gh_token_add({token, repo?})` → pre-register a token. It identifies itself (GET /user → login),
  records its org memberships, and (if `repo` given) confirms access. Usually unnecessary — delegate
  asks on demand.
- **Verify:** from Cursor, connected to the remote MCP, delegate a real task and get output back.

Login-keyed, access-based GitHub token store (multi-account):
- Lives on the VPS at `~/.agent-sandbox/gh-tokens.json` (chmod 600), keyed by **account login**.
  Each entry: `{login, token, type, orgs[], verifiedRepos[]}`.
- **Reactive by default:** user just delegates. On a clone that no stored account can reach, delegate
  returns "provide a token"; the token is probed (login + orgs + repo access), stored, and used.
- **Access, not owner-name:** to pick a token for a repo we live-probe `GET /repos/{owner}/{name}`
  with each candidate account (a personal token that spans several orgs is matched correctly).
- **Disambiguation:** if >1 account can access a repo, delegate asks the user to choose by login.
- Multi-owner tasks: the box gets per-owner `~/.git-credentials` entries (`credential.useHttpPath`),
  so each repo pushes with the right token; the primary repo's token drives the `gh` CLI.

The task defines the goal — analysis, root-cause, fix, PR, tests, anything. The infra only places
the repo(s) and hands over the task verbatim (no outcome is baked into the prompt).

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
