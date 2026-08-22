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

`delegate` · `status` · `resume` · `teardown` · `pool_status` · `monitor` · `watch` · `ask` · `gh_token_add`.
`delegate` takes `source` (`local` ships your working tree; `git` clones `owner/repo@ref` on the VPS),
`task`, optional `ref`, optional `allowDomains`, and `repos:[{repo,ref?}]` for a cross-repo task (each
lands in `/workspace/<name>` in one box). Missing required info is **asked back**, not failed.

**Fleet monitor.** `monitor` (no args; or `npm run monitor`) shows the whole fleet in one call — how
many sandboxes are up and what each is doing: role (session / claimed-pool / free-pool), run state
(running / waiting-for-answer / done / idle), the task text, uptime, and CPU/MEM. Only running boxes
count as "up"; auto-stopped boxes are noted separately. `status` is one session; `monitor` is all of
them at a glance.

**Watch one box live.** `watch(session)` returns a rich snapshot of a single box — run state, task,
resources, and a tail of the agent's log (what it's doing right now). For a terminal live-stream that
redraws every ~2s, run `npm run watch -- <session>` on the VPS.

**Ask a running box — without stopping it.** `ask(session, question)` runs a **second, read-only
co-pilot agent inside the same box** and answers you from what it reads: the workspace, `git diff`,
and the driver's live log. The driver agent keeps working, is never paused, and never sees the
exchange — so you can ask "what has it changed so far?", "why is it stuck?", "is it about to do
something dumb?" mid-run. `watch` gives you the raw log; `ask` gives you the log *interpreted*.

Three things keep the lanes apart (see `src/ask.ts`):

- **Separate session bucket.** Claude Code keys resumable sessions by cwd, so the ask lane is rooted
  at `/ask`. If it shared the repo workdir, an ask turn would become the most recent session there
  and the next `resume` would continue the *co-pilot's* conversation instead of the driver's.
- **No shared state.** Ask artifacts live under `/ask`, outside `/workspace` — the repo tree stays
  clean, `monitor`/`watch` never show ask chatter, and nothing lands in a PR.
- **Read-only, enforced.** A second `PreToolUse` hook (`ask-ro.js`) denies the edit tools and mutating
  shell in this lane. Both in-box hooks self-select on the `ASK_LANE` env flag: the driver's ask-gate
  skips when it's set (so a pending question doesn't freeze the co-pilot — exactly when you most want
  to ask what it's stuck on), and the read-only gate skips when it isn't. The gate is generated from
  the same predicate the tests exercise, and the shipped file is run under `node` in the suite.

`ask` can only look, never steer: to change what the driver does, answer its question with `resume`.
Follow-ups continue the same co-pilot thread unless you pass `newThread:true`. One turn is capped by
`ASK_TIMEOUT_MS` (default 45s, under the client's request timeout); `ASK_MODEL` optionally points the
co-pilot at a cheaper/faster alias than the driver's.

**Web dashboard.** The HTTP entry also serves a token-protected page at `/dashboard` — open
`https://<ASB_DOMAIN>/dashboard?token=<MCP_HTTP_TOKEN>` in a browser to see all boxes as auto-refreshing
cards (role, run-state badge, task, question, cpu/mem); click a card to load that box's live log. It
polls `/monitor.json` every 3s (and `/watch.json?session=…` for logs); both JSON endpoints require the
same token. Auth accepts the token via `Authorization: Bearer` header or the `?token=` query param.

**Reactive GitHub auth — no default account.** There is no baked GitHub token or git identity. Access
is resolved **per repo** from a login-keyed store on the VPS: on the first delegation to a repo no
stored account can reach, `delegate` asks for a `githubToken`; it's probed (login + orgs + access),
stored, and reused. Each repo's commit identity + push token + `gh` come from the account that has
access to **that** repo (works for `local` too — owner read from the origin remote). `status` shows
`run:waiting` when the agent asks a question; you answer with `resume`.

**On-demand secrets (ask-then-resume).** If a task needs a credential it doesn't have (a token for a
private repo it can't reach, a DB URL, an API key), the agent is instructed to **stop and name the
exact env var** instead of failing or faking. You then call `resume` with `secrets`, injected as env
for **that step only** — never stored, gone on teardown:

```jsonc
resume({
  session: "box-abc",
  message: "Use the token I provided to clone and continue.",
  secrets: { "GITHUB_TOKEN": "ghp_…", "DB_URL": "postgres://…" }
})
```

## How delegation flows (A2A)

`delegate` is **interactive and blocking**: one call ships the repo, launches the agent, and waits —
it does not fire-and-forget. It returns only at a real boundary: the run finished (`run:done`), the
box paused to ask a question (`run:waiting`), or the wait cap elapsed with the box still working
(`run:running` — an explicit "reconnect via `status`"). The wait window is bounded (`WAIT_TIMEOUT_MS`,
default 50s) so the call always returns **under** the MCP client's request timeout instead of hanging
to a `-32001`.

```
delegate ──► launch, then wait to a boundary:
   ┌────────────────────────────────────────────────────────────────────┐
   │  waitForBoundary (≤ WAIT_TIMEOUT_MS)                                 │
   │    ├─ done              → return result ────────────────────────────┼──► report PR/result to user
   │    ├─ waiting(question) → return the QUESTION as text ──────────────┼──► calling agent answers it
   │    │                       (from context) OR asks the user via its   │     (from context) or asks
   │    │                       OWN native question UI, then resume(...)  │     the user, then resume()
   │    └─ still running     → return "reconnect via status" ────────────┼──► status() to keep waiting
   └────────────────────────────────────────────────────────────────────┘
```

**Client-driven question loop (why not native elicitation).** The spec-intended mechanism is MCP
**Elicitation** (a server→client `elicitation/create` request sent *before* the final result). We
implemented it, but Cursor auto-**declines** a server-initiated elicitation for a token-bearing
`delegate`/`status`/`resume` call *before the user ever sees a card* — the server gets
`action=decline` instantly and the call then hangs to `-32001`. So native elicitation is **disabled**
(`canElicit()` returns false; one-line re-enable if a future Cursor build renders it). Instead the
wait loop **hands the pending question back as text**, and the *calling* agent (Cursor) does the
turn-taking with its own reliable UI: it answers the question itself when it can from repo/task
context, otherwise prompts the user via its native question UI (e.g. `AskQuestion`), then calls
`resume({session, message})`. Repeat until `run:done`. `resume` also auto-starts a box that
idle-stopped while waiting; `status` reconnects and resumes the same loop. The tool descriptions
carry this as an imperative protocol so the calling agent never ends its turn on a `run:waiting`.

**Live output (stream-json terminal).** The in-box agent runs with
`claude -p --output-format stream-json --verbose`, whose NDJSON events are piped through a small
formatter (`~/.claude/stream-fmt.js`, installed on every claim) that appends readable lines to the
agent log **as work happens** — assistant text, `→ Tool: <arg>` calls, and indented results. Plain
`claude -p` buffers and flushes only at the end; this makes `watch`/`monitor`/the dashboard terminal
genuinely live during a run.

**Ask-and-stop is enforced.** Writing a question to the channel doesn't by itself stop a headless
agent, so a `PreToolUse` hook (`ask-gate.sh`, installed at bootstrap) **denies every further tool
call** while `/workspace/.agent.question` exists. The agent writes its question as its last action and
its turn ends — it can't self-answer or work around a pending question until you `resume` with the
answer.

The in-box agent reaches back through **one channel** (`/workspace/.agent.question` → `run:waiting`)
whenever it hits something it shouldn't guess through:

- **a decision / missing fact** (ambiguous requirement, which approach, destructive confirmation),
- **a missing credential** (names the exact env var; you supply it via `resume` `secrets`),
- **an environment blocker** — failed `npm install` / build / test / auth, a 401/403 from a package
  registry or API, a missing scope. It reports the exact failure and what unblocks it, and does **not**
  quietly skip the step or declare success. You (or the calling agent) answer, `resume`, and it picks up.

So a `delegate`/`resume` call returns only when it truly finishes (`run:done`), is genuinely blocked
and waiting on you (`run:waiting`), or the wait cap elapsed (explicit "still working, reconnect via
`status`") — never a silent "I'll report back later".

## Connect from Cursor

**Local (delegate THIS, uncommitted changes)** — `~/.cursor/mcp.json`:
```json
{ "mcpServers": { "agent-sandbox": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/agent-sandbox/dist/index.js"],
  "env": { "WORKSPACE_DIR": "${workspaceFolder}" }
} } }
```
`WORKSPACE_DIR=${workspaceFolder}` lets Cursor tell the server which project is open, so you can
just say **"delegate this"** with no repo. If Cursor doesn't expand it, the server asks for the path.
(Remote/git always names the repo — the VPS can't see your Mac.)

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
              + ask.ts (read-only co-pilot lane: gate predicate + in-box hook + prompt)
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

1. Edit `.env`: `ASB_DOMAIN`, `ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL` (your proxy), and optionally
   `NPM_TOKEN`. No `GH_TOKEN`/`GIT_AUTHOR_*` — GitHub access is reactive and resolved per repo from
   the login-keyed store (`delegate` asks for a token on first use).
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
