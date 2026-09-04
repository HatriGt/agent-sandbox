# Docs

Start with **[status.md](status.md)** — what is shipped, what is in flight, what is known-broken.

## Current

| Doc | What it answers |
|---|---|
| [status.md](status.md) | What is built and working right now, what is next, what is broken |
| [architecture.md](architecture.md) | How a request flows, from MCP call to a running microVM |
| [lifecycle.md](lifecycle.md) | How long a machine lives, and why it stops when it does |
| [runbook.md](runbook.md) | Operating it: deploy, recover, diagnose |
| [mobile-release.md](mobile-release.md) | Shipping the phone app: OTA vs APK, the Actions build, app anatomy |
| [security.md](security.md) | Threat model, isolation boundary, what a token can do |
| [self-hosting.md](self-hosting.md) | Running your own controller |
| [saas-design.md](saas-design.md) | The multi-user design (now largely built — see status.md) |

Outside this folder:

- **[../PRODUCT.md](../PRODUCT.md)** — product purpose, users, principles. Its *"Direction —
  multi-user (not built)"* section is **stale**; multi-user is built, see [status.md](status.md).
- **[../web/DESIGN.md](../web/DESIGN.md)** — the console's design reference and a round-by-round
  record of every UI decision. The source of truth for anything visual.

## Historical

Kept as a record of how decisions were reached. Do not read these as current state.

| Doc | Why it is here |
|---|---|
| [plan.md](plan.md) | The original phased build plan (Phase 0 → 2). Superseded by status.md |
| [remote-mcp-plan.md](remote-mcp-plan.md) | The plan for the HTTP controller, since built |
| [eval-summary.md](eval-summary.md) | The sandbox-runtime evaluation that chose microsandbox |
