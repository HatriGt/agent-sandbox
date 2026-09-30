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

> **Agent Sandbox — your own agent cloud.** Any coding agent, any model, any account. Every run in
> its own microVM. Always on: manual, scheduled, event-triggered, long-running. When it needs a
> decision, it asks instead of guessing.

That sentence is the direction (plan: `docs/plan-agent-cloud.md`). What exists **today**:

- **Drivers:** Claude Code, oh-my-pi, Codex CLI and OpenCode (`src/drivers/`). Claude Code and
  oh-my-pi meet the supervision floor (a hook gate seen denying calls on a live box, plus resume).
  Codex and OpenCode are **supervised: partial** until their gates are verified live — they wire the
  same ask gate through each CLI's documented hook, but Codex's hosted web search bypasses it and a
  failing hook fails open; OpenCode's transcript is best-effort, no plan card.
  **Planned:** Gemini CLI.
- **Models:** per-user providers (`src/providers.ts`): Anthropic, ccproxy, OpenAI,
  OpenAI-compatible and Ollama (local). Which driver runs which source comes from each driver's
  `capabilities.modelSources`: Claude Code / oh-my-pi → Anthropic; Codex → OpenAI,
  OpenAI-compatible; OpenCode → all four.
- **Triggers:** manual runs (dashboard, MCP, curl), schedules, generic webhooks, GitHub events
  (issue labelled, `/agent` comment, PR opened) and chains (`src/triggers.ts`), managed on the
  Automations page (web and mobile).
- **Long-running:** per-run budgets that ask-and-stop, heartbeat and a stalled state
  (`src/budget.ts`). Dollars only for models with a known price; otherwise tokens only.
  **Planned:** continue-across-boxes.
- **Walk-away:** mobile push + `asb://` deep links; harness bundles (export/import) and
  two-harness compare; "tries several approaches" (2-3 parallel attempts, scored, one PR —
  `src/attempts.ts`). **Planned:** public harness gallery.
- **Box:** built — a hardware-isolated microVM per run, warm pool, sleep/wake, checkpoints, keep.

Every feature must be expressible as a field of one primitive, or it is out of scope:
`Run = Trigger × Harness × Box → Artifact, under Supervision`.

Users reach their agent cloud from the **dashboard**, from **AI agents / IDEs over MCP** (Cursor,
Claude Code, Codex, VS Code, Windsurf, Zed…), or from **scripts/CI over plain HTTP** — three peer
entry points into the same fleet. Self-host is the identity; hosted is "we run your agent cloud for
you" and stays feature-identical (open-core).

**Business model:** hosted service, free for all during beta; self-hosting free forever
(open-core). Billing is deliberately deferred, but the product must be **monetization-ready**:
usage must be measured during beta so pricing is a data decision, and the trial/plan/quota
machinery (already built) must be visible to the user.

## Users

Two personas now, and the product must serve both:

1. **The hosted user** — signs up cold on the landing page. Has zero skills, zero GitHub accounts
   connected, no mental model. The funnel is: land → sign up → **activate** (first successful run,
   ideally reaching the asks-instead-of-guessing "magic moment") → habit (runs per week) → convert (paid,
   post-beta). Time-to-first-successful-run is the metric that decides whether beta produces
   advocates or churned emails.
2. **The self-host operator** — owns the VPS, uses `AUTH_MODE=token`. The original persona. Their
   UX must never be second-class: they are the open-source community and the top of the hosted
   funnel.

Both personas appear in four situations: at the dashboard, inside an IDE (delegating the
uncommitted working tree), away from the desk (phone), and absent (CI/scripts).

## Product Purpose

Run any coding agent, on any model and account, inside a throwaway microVM; be asked when it needs
a decision; get a verified pull request back. The microVM is why "always on, unattended" is a safe
sentence; supervision is what makes it worth leaving on. How you reach it is your choice.
Any capability that works on only one entry path is a bug in the strategy.

Success, restated for SaaS: **a delegated run never silently stalls waiting for a human who didn't
know they were needed — and every finished run leaves an artifact of value inside the product,
pulling the user back.**

## Positioning

Vendor cloud agents are each locked to one model, one account, one cloud; the popular self-hosted
agents are model-agnostic but have no hard isolation boundary or supervision layer. Four things a
neighbouring agent-runner does not have together:

- **microVM isolation** (microsandbox/KVM), not containers — a hard boundary around
  model-generated code.
- **Asks instead of guessing.** A `PreToolUse` hook denies every further tool call while a
  question sentinel exists, so the agent genuinely waits for the answer.
- **A read-only co-pilot lane.** A second agent in the same box answers questions about a run
  *without* pausing or perturbing the driver.
- **Entry-point parity.** Browser, any MCP client, or curl — no privileged "real" client.

Self-host pitch: *"your own agent cloud, one command."* Hosted pitch: *"we run your agent cloud
for you."* Quality pitch (once verify is surfaced):
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

Not built: **Gemini CLI driver**, **live verification of the Codex/OpenCode gates**,
**continuing a run across boxes** past the box's max duration, **cost for unpriced models**
(tokens only, never a guessed dollar), **public harness gallery**, **billing** (free during beta;
`plan` set by admin).

## Direction — the SaaS funnel (current focus)

Priorities, in order:

1. **Activation.** A demo first run that reaches the first question in minutes without a
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

Display name: **Agent Sandbox**. Repo and package: `agent-sandbox`. "Your own agent cloud" is the
tagline; the sandbox is the honest reason the rest is safe. Mark: `web/src/components/ui/logo.tsx` +
`web/public/favicon.svg`. Full token system in `web/src/index.css`; light and dark first-class.
Copy voice is direct and technical; the landing page adds a serif display headline. UX bar is
premium: motion with purpose, real empty states, no fabricated data.

## Accessibility & Inclusion

Both themes must hold real contrast (phone in daylight, desk in the dark). Mobile needs
screen-reader labels and Dynamic Type work (known gap).
