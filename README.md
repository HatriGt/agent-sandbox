<div align="center">

# agent-sandbox

**Delegate a coding task to a real microVM, let an autonomous agent finish it, and watch it happen live.**

Hand off work from **whatever agentic IDE you already use** — including your uncommitted working
tree — to an isolated [microsandbox](https://github.com/microsandbox/microsandbox) microVM on your own
VPS. Claude Code runs the task inside it, asks you questions when it's genuinely blocked, and streams
every tool call back to your editor or a web console.

agent-sandbox is an **MCP server**, so the client is your choice and the protocol is the contract —
no plugin per editor, no lock-in.

[![CI](https://github.com/HatriGt/agent-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/HatriGt/agent-sandbox/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-5FA04E?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![MCP](https://img.shields.io/badge/MCP-any%20client-000000)](https://modelcontextprotocol.io)
[![Isolation](https://img.shields.io/badge/isolation-KVM%20microVM-8A2BE2)](docs/security.md)

[**Live console**](https://agent-sandbox.ajeethkumar.dev) · [Security model](docs/security.md) · [Runbook](docs/runbook.md) · [Lifecycle](docs/lifecycle.md)

**Works with** Cursor · VS Code · Windsurf · Zed · Claude Code · Cline · JetBrains · Claude web · CI
<br><sub>— anything that speaks MCP over stdio or Streamable HTTP.</sub>

</div>

---

## Why this exists

Handing a task to an autonomous agent usually means one of two bad trades: run it on your own machine
and hope it doesn't `rm -rf` something, or run it in a container and pretend a shared kernel is a
boundary. agent-sandbox takes the third option — **one hardware-isolated microVM per run** — and then
solves the parts that make delegation actually usable:

| Problem | What agent-sandbox does |
|---|---|
| "Is this safe to run unattended?" | Every run is its own KVM guest kernel. A fork bomb or `rm -rf /` ends at the VM boundary. |
| "It went quiet for 10 minutes." | NDJSON tool events stream to a live log — `watch`, the fleet `monitor`, and SSE in the console. |
| "It guessed instead of asking." | The agent writes a question and a `PreToolUse` hook **denies every further tool call** until you answer. It cannot barrel on. |
| "What is it doing *right now*?" | `ask` runs a **second, read-only agent** in the same box that reads the diff and log — the driver is never paused. |
| "I don't want to paste tokens everywhere." | GitHub access is resolved per repo from a login-keyed store; on-demand secrets are injected for one step and never stored. |
| "A prompt injection could exfiltrate my keys." | A deterministic guard hook denies control-plane edits, credential exfiltration and runtime reconfiguration — no model in the loop. |

## Quickstart

Two ways to run it. Local (stdio) needs nothing but Node; remote (HTTP) needs a VPS with `msb`.

<details open>
<summary><b>Local — "delegate THIS", including uncommitted changes</b></summary>

```bash
git clone https://github.com/HatriGt/agent-sandbox.git
cd agent-sandbox
npm ci && npm run build
cp .env.example .env       # set VPS_SSH to a host that has microsandbox installed
```

Then register it with your IDE's MCP config (`~/.cursor/mcp.json`, `.vscode/mcp.json`, Windsurf's
`mcp_config.json`, `claude mcp add` — see [Connect your IDE](#connect-your-ide)):

```json
{ "mcpServers": { "agent-sandbox": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/agent-sandbox/dist/index.js"],
  "env": { "WORKSPACE_DIR": "${workspaceFolder}" }
} } }
```

Now say **"delegate this: add tests for the parser"** in your IDE's agent chat.

</details>

<details>
<summary><b>Remote — delegate a git repo from anywhere, plus the web console</b></summary>

```bash
VPS_SSH_ALIAS=<your-vps-ssh> ./setup.sh   # keys, .env, a generated MCP_HTTP_TOKEN, build
```

Set `ASB_DOMAIN`, point DNS at the VPS, then `docker compose up -d --build`. The console lands on
`https://<ASB_DOMAIN>/dashboard`. Full walkthrough: [**Deploy the remote (HTTP) entry**](#deploy-the-remote-http-entry).

</details>

> [!IMPORTANT]
> The HTTP entry refuses to start without `MCP_HTTP_TOKEN`, and that one token is root-equivalent —
> it can spawn VMs. Read [`docs/security.md`](docs/security.md) before exposing it to the internet.

## Contents

- [Why microsandbox](#why-microsandbox) — the runtime evaluation, and what it gave us for free
- [Architecture](#architecture) — one set of handlers, two transports
- [Tools](#tools) — `delegate` · `status` · `resume` · `monitor` · `watch` · `ask` · …
- [How delegation flows (A2A)](#how-delegation-flows-a2a) — the blocking wait loop and the question protocol
- [Connect your IDE](#connect-your-ide) — Cursor, VS Code, Windsurf, Zed, Claude Code, Cline, CI
- [Layout](#layout) · [Deploy](#deploy-the-remote-http-entry)
- [Security](#security) · [Contributing](#contributing) · [License](#license)

---

Runtime: **[microsandbox](https://github.com/microsandbox/microsandbox)** (`msb`, libkrun/KVM microVMs).
Orchestration: a small **TypeScript MCP server** with two entry points that share the same tools:

| Entry | Transport | Use it for | Client |
|---|---|---|---|
| `dist/index.js` | stdio (your IDE spawns it) | "delegate **THIS**" — your local working tree incl. uncommitted changes | Any MCP client on your machine — Cursor, VS Code, Windsurf, Zed, Claude Code, Cline… |
| `dist/http.js` | Streamable HTTP + bearer token | "delegate a **git repo/branch**" from anywhere | Any remote MCP client — your IDE, Claude web, a phone, CI |

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
Your IDE (stdio) ─ local working tree (rsync) ─┐
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
`ASK_TIMEOUT_MS` (default 45s, under the client's request timeout); `ASK_MODEL` points the co-pilot at
a cheaper/faster alias than the driver's (the co-pilot mostly reads a log and summarizes — it does not
need the driver's model).

Three surfaces, one lane: the `ask` MCP tool, an **Ask panel** in each dashboard row (under that box's
terminal — POSTs to `/ask.json`), and a CLI. With no question the CLI reads them from stdin, one per
line, so you can hold a conversation with the co-pilot while the driver works:

```bash
# in the deployed setup the built dist lives in the container, not on the host
ssh <vps> "docker exec agent-sandbox npm run ask -- <session> 'what has it changed so far?'"
ssh -t <vps> "docker exec -i agent-sandbox npm run ask -- <session>"   # interactive, stdin
```

**Web dashboard.** The HTTP entry also serves the console at `/dashboard` (and a public landing page at
`/`). Open `https://<ASB_DOMAIN>/dashboard`, paste `MCP_HTTP_TOKEN` once into the token gate, and the
browser keeps it and sends it as a bearer header on every call; `?token=` is no longer accepted. The
console streams each box live over SSE, shows the fleet, GitHub accounts and MCP servers
(Integrations), and lets you answer the agent's questions. See `docs/security.md` and `web/DESIGN.md`.

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
wait loop **hands the pending question back as text**, and the *calling* agent does the
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

## Connect your IDE

agent-sandbox registers standard MCP tools over two standard transports, so wiring it up is the same
three lines everywhere — only the config file's location and key name differ per client.

### Local entry — "delegate THIS", including uncommitted changes

```json
{ "mcpServers": { "agent-sandbox": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/agent-sandbox/dist/index.js"],
  "env": { "WORKSPACE_DIR": "${workspaceFolder}" }
} } }
```

Where that goes:

| Client | Config |
|---|---|
| Cursor | `~/.cursor/mcp.json` (or `.cursor/mcp.json` in the project) |
| VS Code / Copilot agent mode | `.vscode/mcp.json` — uses `servers` instead of `mcpServers` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Claude Code | `claude mcp add agent-sandbox -- node /absolute/path/dist/index.js` |
| Zed | `settings.json` → `context_servers` |
| Cline / Roo | the extension's MCP settings JSON |

`WORKSPACE_DIR` is what lets you say **"delegate this"** with no repo argument — it tells the server
which project is open. `${workspaceFolder}` is a VS Code-family variable, so Cursor, VS Code and
Windsurf expand it for you. In any client that doesn't, set an absolute path instead, or just name the
repo — the server asks for it rather than guessing. (The remote entry always names a repo: the VPS
cannot see your machine.)

### Remote entry — delegate a git repo from anywhere

```json
{ "mcpServers": { "agent-sandbox-remote": {
  "url": "https://<ASB_DOMAIN>/mcp",
  "headers": { "Authorization": "Bearer <MCP_HTTP_TOKEN>" }
} } }
```

Same URL and bearer header for every remote client — an IDE on another machine, Claude web, a phone,
or a CI job that shells out to an MCP client. Nothing about the transport is editor-specific.

> [!NOTE]
> Cursor is the most heavily exercised client today, which is why one Cursor-specific quirk is
> documented below (its Auto-review auto-declines server-initiated MCP *elicitation*). The workaround
> — handing the pending question back as plain text for the calling agent to answer — is
> client-agnostic and is the path **all** clients take, so no client depends on native elicitation.

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

Actively developed and deployed. The orchestrator ships a **~300-case unit suite** (`npm test`) covering the
handlers, the guard predicates, the auth guard, the response security headers, the lifecycle/pool
logic and the stream formatter — all pure, so they run in CI with no VPS. Both entries (stdio + HTTP)
are live, and the web console runs against a real fleet.

Next up: real user authentication (replacing the single shared bearer token), rate limiting on the
token check, and egress deny-by-default for RFC1918 ranges. See `docs/remote-mcp-plan.md` for the
phase breakdown and [Known gaps](docs/security.md#known-gaps-honest) for what is deliberately not
solved yet.

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
4. Add the remote entry to your MCP client (see **[Connect your IDE](#connect-your-ide)** above).

The container drives `msb` on the VPS **host** over SSH (msb needs KVM on the host), reaching it
as `host.docker.internal`. Everything site-specific lives in `.env`; the repo ships no secrets.


## Security

Every run is a KVM microVM, so the *host* is protected by hardware regardless of what the agent does.
The interesting threat is therefore not escape but **a prompt-injected agent exfiltrating the
credentials the box legitimately holds** — so the defences that matter are deterministic, not
model-mediated: a `PreToolUse` guard hook denylist, a read-only lane for `ask`, allow-listed tools,
per-repo credential resolution, and a strict CSP around the console.

[`docs/security.md`](docs/security.md) documents the full model, including an honest
[Known gaps](docs/security.md#known-gaps-honest) section.

Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md). Do not open a
public issue.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the dev loop (`npm run build`,
`npm test`), the testing conventions (pure units, no VPS required) and what a good PR looks like.

## License

[Apache-2.0](LICENSE) © 2026 Ajeeth Kumar Ravichandran.
