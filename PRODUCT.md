# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing: Node + TypeScript MCP server (stdio + Streamable HTTP), no frontend framework. The
dashboard surface is **standalone HTML with no build step** — the user's explicit decision, so the
page stays served by the same container that serves `/mcp` and `docker compose up --build` remains
the only deploy step.

## Users

One operator — the repo owner — driving autonomous coding agents that run in isolated microVMs on
their own VPS. Three situations, all the same person:

- **At the desk, in Cursor.** The MCP client is primary; the dashboard is a second screen for
  watching a run they delegated.
- **At the desk, away from the IDE.** The dashboard is the only surface: check the fleet, read a
  log, answer a question a box is blocked on.
- **On a phone, away from both.** A run they started earlier is still going. They want to know
  whether anything needs them, and to be able to act if it does. Confirmed: fleet overview and
  single-box detail are *both* first-class on mobile.

No multi-user, no roles, no tenancy. One token holder.

## Product Purpose

Delegate a coding task to a throwaway microVM running Claude Code, then stay in the loop while it
works: see what every box is doing, read the live log, ask a read-only co-pilot about a run in
flight, and answer the questions the agent stops to ask. Success is that a delegated run never
silently stalls waiting for a human who didn't know they were needed.

## Positioning

Three things a neighbouring agent-runner does not have together:

- **microVM isolation** (microsandbox/KVM), not containers — a hard boundary around
  model-generated code.
- **Ask-and-stop interactivity.** A `PreToolUse` hook denies every further tool call while a
  question sentinel exists, so the agent genuinely halts instead of guessing, and resumes with the
  answer.
- **A read-only co-pilot lane.** A second agent in the same box answers questions about a run
  *without* pausing or perturbing the driver.

## Operating Context

- Boxes are ephemeral: `--idle-timeout 15m`, `--max-duration 1h`, and a warm pool of pre-booted
  boxes so a claim skips the boot. A box can be Stopped while its rootfs and Claude session survive.
- The HTTP controller runs in a container on `dokploy-network`; Traefik terminates TLS at
  `agent-sandbox.ajeethkumar.dev`. The container SSHes to the VPS host to drive `msb` (microVMs need
  KVM on the host).
- Auth is a single bearer token, accepted as a header or `?token=` query param. Confirmed decision:
  keep `?token=` in the URL. The token can boot VMs and reach GitHub tokens — treat it as root.
- Two lanes share every box: the **driver** (`/workspace`, the `.agent.*` sentinels, its own
  resumable Claude session) and the **co-pilot** (`/ask`, read-only, gated by a second hook).
- Run states the operator acts on: `running`, `waiting` (a question is pending — the only state that
  *needs* a human), `done exit=N`, `idle`. Roles: `session`, `session · pool`, `warm pool`.

## Capabilities and Constraints

Confirmed server surface: `GET /monitor.json` (fleet), `GET /watch.json?session=` (one box: state,
task, question, metrics, log tail), `POST /ask.json` (read-only co-pilot), `POST /mcp` (MCP).
Everything is token-guarded and fails closed.

The dashboard is to gain, per the user's decision, the ability to: **answer a waiting question
(resume)**, **ask the co-pilot** (already built), **tear down a box** (destructive — needs confirm),
and **start a new delegation**, the last of these driven from a **chat-style surface** where the
operator states a task, gets a sandbox, and keeps working with it conversationally.

Constraints future work must respect:

- One co-pilot turn is capped in-box (`ASK_TIMEOUT_MS`, default 45s) so a request always returns
  under the client's timeout. `ASK_MODEL` runs the co-pilot on a cheaper alias than the driver.
- `delegate` blocks server-side up to `WAIT_TIMEOUT_MS` (default 50s) driving the interactive loop.
  A browser chat cannot inherit that blocking shape — it needs to start a run and poll.
- `resume` steers the driver and is the *only* way to answer a pending question. `ask` can never
  steer, by design.
- Fleet size is small (`MSB_MAX_BOXES`, default 5). This is not a table that needs virtualization.
- The page must stay dependency-free and buildless.

## Brand Commitments

Name: **agent-sandbox**. No logo, wordmark, colour, or type commitment exists. Existing copy voice
is direct, lowercase-leaning, and technical — it names mechanisms rather than benefits
("run:waiting — the agent asked a question and paused").

## Evidence on Hand

Real, live: the JSON endpoints above; genuine box names (`pool-1787402942072-3v65qa`), task text,
`cpu 0.02 / 1c`, `mem 283.5 MiB / 1.0 GiB`, uptimes, and stream-formatted agent logs
(`● session started`, `→ Write: /workspace/p1.md`, indented tool results).

Absent — must not be fabricated: any notion of users, teams, billing, historical runs, run
analytics, success rates, or cost per run. Nothing in this system stores a finished run: when a box
is torn down, its history is gone. The dashboard shows only what is alive right now.

## Product Principles

1. **`waiting` is the only state that needs a human.** Whatever else the surface does, a box blocked
   on a question must be impossible to miss and answerable on the spot.
2. **Two lanes, never conflated.** Driver output and co-pilot conversation must never look like the
   same voice; the co-pilot must never read as a way to steer the agent.
3. **Show what is alive, don't imply history.** No trends, no sparklines, no aggregates over runs
   that were never stored.
4. **Destructive actions are deliberate.** Teardown and delegation spawn or destroy real VMs from a
   web page held open by a root-equivalent token.
5. **The phone is not a degraded desktop.** The same operator does the same two jobs — triage and
   watch — on both.

## Accessibility & Inclusion

No externally imposed standard. Single operator, but the surface is read in bright outdoor light on
a phone and in a dark room at a desk, so both themes must hold real contrast — not a dark theme with
a light theme bolted on.
