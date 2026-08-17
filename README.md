# agent-sandbox

Delegate a coding task **from Cursor** to an isolated microVM on your VPS, run an autonomous
agent (Claude Code) inside it, and stream the result back — with resume, follow-ups, and safe
credential handling. Built for Cursor first; because it speaks MCP, it also works from **any MCP
client** (Claude web, other IDEs, CI).

Runtime: **[microsandbox](https://github.com/microsandbox/microsandbox)** (`msb`, libkrun/KVM microVMs).
Orchestration: a small **TypeScript MCP server** with two entry points that share the same tools:

| Entry | Transport | Use it for | Client |
|---|---|---|---|
| `dist/index.js` | stdio (Cursor spawns it) | "delegate **THIS**" — your local working tree incl. uncommitted changes | Cursor on your Mac |
| `dist/http.js` | Streamable HTTP + bearer token | "delegate a **git repo/branch**" from anywhere | Cursor (remote MCP), Claude web, phone, CI |

## Why microsandbox

We benchmarked microsandbox, OpenSandbox, SmolVM, and CubeSandbox on the target VPS
(see `docs/eval-summary.md`). microsandbox won for this use case: real microVM isolation
(hardware boundary), sub-second boot, right-sized RAM, and — critically for v0.6.9 — a
**self-contained CLI** with the whole delegate wishlist built in:

| Need | microsandbox v0.6.9 feature |
|---|---|
| Ship repo + local changes | `--copy-dir SRC:DST`, `-v/--volume`, `msb cp` |
| Inject git/npm creds | `-e KEY=val`, `--secret-conf` (keyring/env secrets) |
| Egress control (creds-proxy-grade) | `--net public/private/host`, `--no-net`, `--net-rule allow@<target>`, DNS controls |
| Run Claude Code + MCP | any OCI image; Claude Code CLI + MCP servers run in-box |
| Use ccproxy for the model | `-e ANTHROPIC_BASE_URL=https://your-ccproxy.example.com` (verified) |
| Auto-teardown | `--idle-timeout`, `--max-duration` |
| Resume / continue | `msb exec`, `msb ssh` into a running box |
| Checkpoints / fast restore | `msb snapshot`, `msb run --from-snapshot` |
| Status / preview | `-p HOST:GUEST` port forward |

The egress/secret features mean we get the credential-injection-proxy pattern (that
Cleanroom and iron-proxy sell as separate products) natively.

## Architecture

```
Cursor (stdio)  ─ local working tree (rsync) ─┐
Any MCP client (HTTP + token) ─ git clone ────┤►  handlers (shared) → msb on VPS host
                                               │
                                               ▼
                                      microsandbox microVM (libkrun/KVM)
                                         • repo copied in (local tree OR fresh git clone)
                                         • git/npm creds injected (short-lived)
                                         • Claude Code runs the task → commit/PR (no AI attribution)
                                         • model calls → ccproxy
                                               │
                                      status/logs → resume/follow-ups → teardown
```

Both entries register identical tools (`src/handlers.ts`) backed by the same side-effecting deps
(`src/deps.ts`), so behavior is the same whichever client you use.

## Tools

`delegate` · `status` · `resume` · `teardown` · `pool_status`. `delegate` takes `source`
(`local` ships your working tree; `git` clones `owner/repo@ref` on the VPS), `task`, optional
`ref`, optional `allowDomains`. Missing required info is **asked back**, not failed.

## Connect from Cursor

**Local (delegate THIS, uncommitted changes)** — `~/.cursor/mcp.json`:
```json
{ "mcpServers": { "agent-sandbox": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/agent-sandbox/dist/index.js"]
} } }
```

**Remote (delegate a git repo from anywhere)** — same file, HTTP entry:
```json
{ "mcpServers": { "agent-sandbox-remote": {
  "url": "https://<ASB_DOMAIN>/mcp",
  "headers": { "Authorization": "Bearer <MCP_HTTP_TOKEN>" }
} } }
```

Any other MCP client (Claude web, another IDE, CI) adds the same HTTP URL + bearer header.

## Layout

```
src/          MCP orchestrator: handlers (shared) + stdio entry (index.ts) + HTTP entry (http.ts)
              + git-source, delegate-input, deps, http-auth, msb/pool/ssh/sync
test/         unit tests (node:test via tsx) — run `npm test`
docs/         plan, remote-mcp plan, eval summary, runbook
Dockerfile    HTTP controller image (Dokploy)
compose.yaml  Dokploy app: Traefik route ${ASB_DOMAIN} → :8787
```

## Status

Phase 1 built + tested (29 unit tests, HTTP auth verified live). Remaining: deploy the HTTP
entry to Dokploy and smoke-test a remote delegate. See `docs/remote-mcp-plan.md` (Phase 1 done /
Phase 2 backlog).

## Deploy the remote (HTTP) entry

Prereq: a VPS with [microsandbox](https://github.com/microsandbox/microsandbox) (`msb`) installed
and Docker + a Traefik reverse proxy (e.g. Dokploy). Then, from a machine that can SSH to the VPS:

```bash
VPS_SSH_ALIAS=<your-vps-ssh> ./setup.sh
```

That one script: verifies `msb` on the VPS, creates + authorizes a dedicated SSH key, pulls the
private key into `deploy/` (gitignored), scaffolds `.env` with a generated `MCP_HTTP_TOKEN` and
the container→host SSH settings, and builds. Then:

1. Edit `.env`: `ASB_DOMAIN`, `ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL` (your proxy), `GH_TOKEN`,
   `GIT_AUTHOR_*`.
2. Point DNS `ASB_DOMAIN` → your VPS.
3. Deploy: a Dokploy Compose app from this repo (path `./compose.yaml`), or on the VPS
   `docker compose up -d --build`.
4. Add the remote entry to Cursor (see **Connect from Cursor** above).

The container drives `msb` on the VPS **host** over SSH (msb needs KVM on the host), reaching it
as `host.docker.internal`. Everything site-specific lives in `.env`; the repo ships no secrets.

For this VPS specifically, the deploy pointer is tracked in AKVps
`deployments/apps/agent-sandbox/`.

## License

MIT.
