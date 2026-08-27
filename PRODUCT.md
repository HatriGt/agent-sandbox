# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Node + TypeScript **MCP server** with two entry points sharing one set of handlers: stdio
(`dist/index.js`, spawned by a local client) and Streamable HTTP + bearer token (`dist/http.js`).

The dashboard is a **React + Vite SPA** (Tailwind v4 tokens, Radix primitives, Motion, shiki for code)
built to `web/dist` and served by the same container that serves `/mcp`, so `docker compose up --build`
remains the only deploy step. It is **not** the buildless single HTML file described in earlier
revisions of this document — that decision was reversed when the console grew a router, live SSE
streaming, thread views and an integrations surface.

## Users

One operator today — the person who owns the VPS. **Multi-user is the stated direction**, so treat
single-tenancy as a current limitation to be removed, not a design principle (see *Direction* below).

The same person, in four situations, and the product must be equally usable in all of them:

- **In the dashboard.** Opens the console, picks repos, types a task, sends. No client installed, no
  IDE open. This is a first-class way to *start* work, not just to watch it.
- **In a coding agent / IDE.** Cursor, Claude Code, Codex, VS Code, Windsurf, Zed — anything speaking
  MCP. The draw here is specific: the local entry ships the **uncommitted working tree**.
- **Away from the desk.** The dashboard is the only surface: check the fleet, read a log, answer a
  question a box is blocked on. Confirmed: fleet overview and single-box detail are *both* first-class
  on mobile.
- **Not present at all.** A script or CI job starts a run over HTTP and something else reads the result.

## Product Purpose

**Agent Sandbox is a cloud sandbox for coding agents, running on hardware you own.** Give a coding
task to an autonomous agent inside a throwaway microVM, then stay in the loop while it works: see what
every box is doing, read the live log, ask a read-only co-pilot about a run in flight, and answer the
questions the agent stops to ask.

**Where the task is delegated from is an option, not the product.** Dashboard, coding agent/IDE, and
script are peers: they hit the same handlers, produce the same box, and land in the same fleet. A run
started in the browser is fully drivable from an IDE and vice versa. Any feature that works on only
one entry path is a bug in the strategy, not a feature of that path.

Success is that a delegated run never silently stalls waiting for a human who didn't know they were
needed.

## Positioning

Four things a neighbouring agent-runner does not have together:

- **microVM isolation** (microsandbox/KVM), not containers — a hard boundary around
  model-generated code, on your own server rather than someone else's cloud.
- **Ask-and-stop interactivity.** A `PreToolUse` hook denies every further tool call while a
  question sentinel exists, so the agent genuinely halts instead of guessing, and resumes with the
  answer.
- **A read-only co-pilot lane.** A second agent in the same box answers questions about a run
  *without* pausing or perturbing the driver.
- **Entry-point parity.** The sandbox is reachable from a browser, any MCP client, or curl — with no
  privileged "real" client.

## Operating Context

- Boxes are ephemeral: `--idle-timeout 15m`, `--max-duration 1h`, and a warm pool of pre-booted
  boxes so a claim skips the boot. A box can be Stopped while its rootfs and Claude session survive.
  A **kept (pinned)** box still sleeps but is never reaped — only Destroy removes it.
- The HTTP controller runs in a container on `dokploy-network`; Traefik terminates TLS at
  `agent-sandbox.ajeethkumar.dev`. The container SSHes to the VPS host to drive `msb` (microVMs need
  KVM on the host).
- Auth is a single bearer token, **header-only**. The earlier decision to keep `?token=` in the URL
  was **reversed**: it put a root-equivalent secret into browser history, proxy logs and Referer
  headers. The browser holds the token in `localStorage` behind a token gate and sends it as a bearer
  header on every call, including the SSE stream (fetch-based) and artifact downloads. The token can
  boot VMs and reach GitHub tokens — treat it as root.
- Responses carry a strict CSP (no inline script, no eval, `connect-src 'self'`), HSTS, nosniff,
  frame-ancestors none and COOP/CORP. Artifact bytes get `default-src 'none'; sandbox`.
- Two lanes share every box: the **driver** (`/workspace`, the `.agent.*` sentinels, its own
  resumable Claude session) and the **co-pilot** (`/ask`, read-only, gated by a second hook).
- Run states the operator acts on: `running`, `waiting` (a question is pending — the only state that
  *needs* a human), `done exit=N`, `idle`. Roles: `session`, `session · pool`, `warm pool`.

## Capabilities and Constraints

Confirmed server surface, all bearer-guarded and failing closed: `POST /delegate.json` (start a run),
`GET /monitor.json` and `GET /fleet.json` (fleet + lifecycle + sleeping boxes), `GET /watch.json` and
`GET /watch.sse` (one box, poll or live stream), `POST /ask.json` (read-only co-pilot),
`POST /resume.json` (answer / steer), `POST /teardown.json`, `POST /keep.json` (pin),
`GET /files.json` + `GET /artifact` (produced files), `GET|POST|DELETE /accounts.json` and the device
flow, `GET /repos.json` + `POST /repos/attach.json`, `GET|POST /mcp-servers.json`,
`GET|DELETE /inbox.json` (queued follow-ups), and `POST /mcp` (MCP).

**Built since the last revision of this document** (previously listed as future work): answering a
waiting question, tearing down a box, and **starting a new delegation from the dashboard** — via a
chat-style composer where the operator states a task, gets a sandbox, and keeps working with it
conversationally. The composer attaches repos named in the task text when none are picked explicitly.

Constraints future work must respect:

- One co-pilot turn is capped in-box (`ASK_TIMEOUT_MS`, default 45s) so a request always returns
  under the client's timeout. `ASK_MODEL` runs the co-pilot on a cheaper alias than the driver.
- `delegate` blocks server-side up to `WAIT_TIMEOUT_MS` (default 50s) driving the interactive loop.
  A browser chat cannot inherit that blocking shape — it starts a run and streams/polls instead.
- `resume` steers the driver and is the *only* way to answer a pending question. `ask` can never
  steer, by design.
- Fleet size is small (`MSB_MAX_BOXES`, default 5). This is not a table that needs virtualization.
- Native MCP elicitation is disabled: the calling agent receives the pending question as text and
  answers it with its own UI. Every client takes this path, so no client is privileged.

### Direction — multi-user (not built)

The system has **no ownership model at all** today: no user, owner or tenant concept exists anywhere
in `src/`. Every one of these is global to the token holder, and each is a concrete blocker:

- **Identity.** One shared, non-expiring bearer token; no sessions, revocation, or per-user identity.
  The replacement is short-lived revocable sessions in an `HttpOnly` cookie — which also retires the
  `localStorage` risk.
- **Attribution.** Nothing records who started a run, answered a question, or destroyed a box. There
  is no audit log to add roles on top of.
- **Isolation between users.** The fleet, produced files and artifact bytes are readable, and every
  box destroyable, by any token holder. Boxes need owners before a second person gets access.
- **Shared credential stores.** The GitHub account store, MCP server config, repo list and follow-up
  inbox are single global stores; each needs a scope.
- **Quota.** `MSB_MAX_BOXES` is one global cap with no per-user allocation.

Until those exist, "multi-user" must not be implied in the UI or in marketing copy.

## Brand Commitments

Display name: **Agent Sandbox**. Repo and package: `agent-sandbox`. "Cloud agent sandbox" is the
**category**, not the name — use it to describe what the product *is*, never as a wordmark.

A mark exists (`web/src/components/ui/logo.tsx` + `web/public/favicon.svg`) and the console ships a
full token system in `web/src/index.css` — light and dark are both first-class, not a theme bolted
onto its opposite. Copy voice is direct and technical: it names mechanisms rather than benefits
("run:waiting — the agent asked a question and paused"). The landing page adds a serif display
headline over that same plain-spoken body voice.

## Evidence on Hand

Real, live: the JSON endpoints above; genuine box names (`pool-1787402942072-3v65qa`), task text,
`cpu 0.02 / 1c`, `mem 283.5 MiB / 1.0 GiB`, uptimes, and stream-formatted agent logs
(`● session started`, `→ Write: /workspace/p1.md`, indented tool results).

Absent — must not be fabricated: any notion of users, teams, billing, historical runs, run
analytics, success rates, or cost per run. Nothing in this system stores a finished run: when a box
is torn down, its history is gone. The dashboard shows only what is alive right now. There is also no
attribution — no record of *who* did anything — so no per-user view can be mocked up as if it existed.

## Product Principles

1. **`waiting` is the only state that needs a human.** Whatever else the surface does, a box blocked
   on a question must be impossible to miss and answerable on the spot.
2. **Every entry point is a peer.** Dashboard, MCP client and script produce the same run and can
   drive it equally. No capability may exist on only one path.
3. **Two lanes, never conflated.** Driver output and co-pilot conversation must never look like the
   same voice; the co-pilot must never read as a way to steer the agent.
4. **Show what is alive, don't imply history.** No trends, no sparklines, no aggregates over runs
   that were never stored.
5. **Destructive actions are deliberate.** Teardown and delegation spawn or destroy real VMs from a
   web page held open by a root-equivalent token.
6. **The phone is not a degraded desktop.** The same operator does the same jobs — start, triage,
   watch, unblock — on both.

## Accessibility & Inclusion

No externally imposed standard. Single operator today, but the surface is read in bright outdoor light
on a phone and in a dark room at a desk, so both themes must hold real contrast — not a dark theme
with a light theme bolted on.
