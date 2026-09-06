# Roadmap — sandbox as a service

**Framing (2026-09-06).** Agent Sandbox is a hosted SaaS: we provide microVM sandboxes as a
service, reachable from the dashboard, from AI agents/IDEs over MCP, or from scripts. Free for all
during beta; self-hosting free forever. The roadmap optimizes two numbers during beta —
**time-to-first-magic-moment** (activation) and **runs-per-user-per-week** (retention) — while
quietly metering usage so pricing, when it comes, is a data decision.

The repo's biggest opportunity is not invention: an unusual amount of finished, tested server
capability (notify, digest, verify, handoff, audit) is stranded behind missing UI. Ship the last
mile first.

## Priority list

### 🔴 P1 — Immediate (activation + the retention loop)

| # | Feature | Why | Where |
|---|---|---|---|
| 1 | **Web notifications settings UI** | `/notify.json` + `/notify/test.json` are built/tested; configurable only on Android. Completes "safe to walk away" on the primary surface. Every ping is a product-initiated return visit. | web `Account`/settings; server done |
| 2 | **Digest card on finished threads** | `/digest.json` has zero consumers. Turns transcript-scroll into a 5-second receipt: files, plan, failed commands, questions, headline. | web Thread + mobile Thread |
| 3 | **Activation pass** | Route the orphaned welcome flow (`Connect.tsx` welcome mode, `/dashboard/welcome`); seed 3–5 curated skills on signup; a demo first run that reaches ask-and-stop in minutes without GitHub. | web + server seed |
| 4 | **Usage meter** | Trial days + boxes vs `USER_MAX_BOXES` visible in Account and the trial band. Trains users that the resource has value; groundwork for billing. | web + mobile settings |
| 5 | **Verify in the composer** | Pass `verify` through `/delegate.json` (exists MCP-only); stamp threads with `done:verified`. The hosted quality pitch. | server plumb + web/mobile composer |
| 6 | **Paper cuts** | Run duration in `RunSummary`; artifacts restored (`ProducedFiles.tsx` dead); Esc handler; `window.confirm` → Dialog; NaN date guards; token-mode access to Account/Connect; duplicated condition `Hub.tsx:326`. | web |

### 🟠 P2 — Next (reach & durability)

7. **Run history archive** — persist digest + diff summary + final state at teardown/reap (SQLite);
   read-only History page. The retention asset and the substrate for weekly emails and billing.
8. **Mobile push notifications + deep links** — `push_devices`, `/push/register.json`, FCM/APNs,
   `asb://box/<name>` (scheme declared, unhandled). The lock-screen "needs you" is the thesis.
9. **Email notification channel** — hosted users have inboxes, not webhook receivers.
10. **Durable inbox** — queued follow-ups survive controller restarts (SQLite, not memory).
11. **Audit view** — surface `audit_events` to its owner + admin; add retention pruning.
12. **Run again** — prefill composer from a finished box's run-memory.

### 🟡 P3 — Growth & convert

13. GitHub-triggered runs (`/agent fix this` on an issue/PR comment).
14. Scheduled runs (nightly chores on the existing delegate flow + verify).
15. Pipelines UI for `after`/`carry` dependent delegations.
16. Declared-vs-observed drift indicator.
17. Billing on the P1 metering; orgs/teams; premium-tier candidates from 13–15.

## Open-core stance

The hosted and self-host products stay feature-identical. Differentiate later on capacity, managed
model access, and team features (orgs, SSO) — none exist yet, so nothing is clawed back. Token-mode
UX is never second-class (it is the community and the top of the hosted funnel).

## Trust made visible (cross-cutting)

Hosted users hand us GitHub tokens with push rights. The security machinery (tenancy, per-owner
AES-GCM, redaction, audit) is excellent and invisible — surface it: an in-console security page,
the egress allowlist in the composer, the audit log readable. Launch blocker carried from
status.md: **regenerate the leaked GitHub OAuth client secret.**
