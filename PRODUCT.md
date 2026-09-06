# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (hosted SaaS console + self-host), Android/iOS companion app, MCP for agents/IDEs.

## Stack

Node + TypeScript **MCP server** with two entry points sharing one set of handlers: stdio
(`dist/index.js`, spawned by a local client) and Streamable HTTP + bearer token (`dist/http.js`).

The dashboard is a **React + Vite SPA** (Tailwind v4 tokens, Radix primitives, Motion, shiki for code)
built to `web/dist` and served by the same container that serves `/mcp`, so `docker compose up --build`
remains the only deploy step. A React Native / Expo companion app lives in `mobile/`.

## What the product is

**Agent Sandbox is sandbox-as-a-service for coding agents.** We provide hardware-isolated microVM
sandboxes as a service: sign up on the hosted controller and use them immediately, or self-host the
whole stack for free. Users reach their sandboxes from the **dashboard**, from **AI agents / IDEs
over MCP** (Cursor, Claude Code, Codex, VS Code, Windsurf, Zed…), or from **scripts/CI over plain
HTTP** — three peer entry points into the same fleet.

**Business model:** hosted service, free for all during beta; self-hosting free forever
(open-core). Billing is deliberately deferred, but the product must be **monetization-ready**:
usage must be measured during beta so pricing is a data decision, and the trial/plan/quota
machinery (already built) must be visible to the user.

## Users

Two personas now, and the product must serve both:

1. **The hosted user** — signs up cold on the landing page. Has zero skills, zero GitHub accounts
   connected, no mental model. The funnel is: land → sign up → **activate** (first successful run,
   ideally reaching the ask-and-stop "magic moment") → habit (runs per week) → convert (paid,
   post-beta). Time-to-first-successful-run is the metric that decides whether beta produces
   advocates or churned emails.
2. **The self-host operator** — owns the VPS, uses `AUTH_MODE=token`. The original persona. Their
   UX must never be second-class: they are the open-source community and the top of the hosted
   funnel.

Both personas appear in four situations: at the dashboard, inside an IDE (delegating the
uncommitted working tree), away from the desk (phone), and absent (CI/scripts).

## Product Purpose

Give a coding task to an autonomous agent inside a throwaway microVM, stay in the loop while it
works, and get a pull request back. The sandbox is the product; how you reach it is your choice.
Any capability that works on only one entry path is a bug in the strategy.

Success, restated for SaaS: **a delegated run never silently stalls waiting for a human who didn't
know they were needed — and every finished run leaves an artifact of value inside the product,
pulling the user back.**

## Positioning

Four things a neighbouring agent-runner does not have together:

- **microVM isolation** (microsandbox/KVM), not containers — a hard boundary around
  model-generated code.
- **Ask-and-stop interactivity.** A `PreToolUse` hook denies every further tool call while a
  question sentinel exists, so the agent genuinely halts instead of guessing.
- **A read-only co-pilot lane.** A second agent in the same box answers questions about a run
  *without* pausing or perturbing the driver.
- **Entry-point parity.** Browser, any MCP client, or curl — no privileged "real" client.

Hosted pitch: *"the 5-minute self-host, in 0 minutes."* Quality pitch (once verify is surfaced):
*"our sandbox doesn't just run your agent, it proves the work."*

## Capabilities (confirmed, shipped)

Multi-user SaaS mode is **built**: GitHub OAuth + password signup, opaque sessions, revocable API
keys, per-user encrypted stores (GitHub tokens, MCP servers, skills, notify webhooks), per-user
quotas, trial clock, admin page, audit log (`src/identity.ts`, `src/tenancy.ts`,
`src/user-store.ts`, `src/audit.ts`). `AUTH_MODE=token` remains for single-operator self-host.

Run lifecycle: delegate (multi-repo, branches, image attachments, model pick, egress allowlist),
warm pool, sleep/wake/keep, per-box memory/disk tiers, checkpoints/revert, mid-turn inbox,
send-now. Interaction: structured question cards, side questions, `@` file mentions, `/` skills,
voice dictation. Git/GitHub: full PR surface (merge/approve/review/checks) on web and mobile.
Walk-away layer: webhook notifications (`src/notify.ts`), run digest (`src/digest.ts`), verified
outcomes (`src/verify.ts`), dependent delegations (`src/handoff.ts`).

Not built: **billing** (free during beta; `plan` set by admin), **run history** (a torn-down box's
history is gone — see Direction), **push notifications** (mobile has a local activity feed only).

## Direction — the SaaS funnel (current focus)

Priorities, in order:

1. **Activation.** A demo first run that reaches the ask-and-stop moment in minutes without a
   GitHub account; the welcome flow routed after signup; a curated skill library seeded into new
   accounts.
2. **Retention loop.** Notifications configurable on every surface (web UI for `/notify.json`;
   later mobile push + email); a **run history archive** so finished work stops evaporating —
   the digest of every run persisted at teardown becomes the "what your agents did" page users
   return to, and later the substrate for billing and weekly digest emails.
3. **Legible value.** The digest card on finished threads; verify surfaced in the composer and
   stamped as `done:verified`; a visible usage meter (boxes vs quota, trial days).
4. **Monetization readiness.** Meter usage (runs, box-hours) quietly during beta. No paywall.
5. **Trust made visible.** The security model surfaced in-console, the audit log readable by its
   owner, the egress allowlist exposed in the composer.

## Operating Context

- Boxes are ephemeral: `--idle-timeout 15m`, `--max-duration 1h`, warm pool. A **kept (pinned)**
  box is never reaped. Fleet cap `MSB_MAX_BOXES` global + `USER_MAX_BOXES` per user.
- The HTTP controller runs in a container; Traefik terminates TLS at
  `agent-sandbox.ajeethkumar.dev`. The container SSHes to the VPS host to drive `msb`.
- Auth: operator bearer → `asb_` API keys → HttpOnly session cookies; CSRF-checked mutations;
  strict CSP (`connect-src 'self'` — third-party APIs must be proxied through the controller).
- Two lanes per box: the **driver** (`/workspace`) and the **co-pilot** (`/ask`, read-only).
- Run states: `running`, `waiting` (needs a human), `done exit=N`, `idle`, sleeping.

## Product Principles

1. **`waiting` is the only state that needs a human.** A box blocked on a question must be
   impossible to miss — on the surface the user is actually looking at, which for a hosted user
   is often *no surface at all*: that is why notifications are core, not polish.
2. **Every entry point is a peer.** Dashboard, MCP client and script produce the same run and can
   drive it equally. Server capabilities without UI (digest, verify, handoff, notify) are parity
   bugs, not backlog items.
3. **Two lanes, never conflated.** Driver output and co-pilot conversation must never look like
   the same voice.
4. **Show what is alive; history is a separate, clearly-past surface.** Live views never fabricate
   trends. A run *archive* (persisted digests) is allowed and wanted — it must read as a record,
   never as live state.
5. **Destructive actions are deliberate.**
6. **The phone is not a degraded desktop.**
7. **The self-hoster is never second-class.** Every hosted-funnel feature must degrade sensibly in
   token mode.

## Brand Commitments

Display name: **Agent Sandbox**. Repo and package: `agent-sandbox`. "Sandbox as a service" is the
category line; "cloud agent sandbox" describes what it is. Mark: `web/src/components/ui/logo.tsx` +
`web/public/favicon.svg`. Full token system in `web/src/index.css`; light and dark first-class.
Copy voice is direct and technical; the landing page adds a serif display headline. UX bar is
premium: motion with purpose, real empty states, no fabricated data.

## Accessibility & Inclusion

Both themes must hold real contrast (phone in daylight, desk in the dark). Mobile needs
screen-reader labels and Dynamic Type work (known gap).
