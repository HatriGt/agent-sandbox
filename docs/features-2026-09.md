# Feature plan — September 2026

Five features that deepen the product's core promise: **safe to walk away from**. Spec'd together,
built one at a time, TDD (pure logic first, IO injected, live verification last). Order is by
dependency and daily-experience impact: notifications → digest → verify → handoffs → snapshots.

Backup of pre-feature main: branch `backup/pre-features-2026-09-01`.

---

## 1. Notifications — the missing half of walk-away

**Problem.** The premise is that the operator leaves. But the only way to learn a box is
`run:waiting` (or done, or failed) is to come back and look.

**Design.** A pure transition detector + a pluggable webhook sender, driven by the fleet sweep the
controller already runs every ~1.5 s (`makeFleetReader` in `src/fleet.ts`; the broker already
piggybacks on it the same way at `src/http.ts` `/fleet.json`).

- `src/notify.ts` (new):
  - `detectTransitions(prev, next)` — pure. Input: two fleet snapshots (name → {runState, exitCode,
    question}). Output: events `{box, kind: "waiting" | "done" | "failed", question?, exitCode?}`.
    Rules: fire on edges only (running→waiting, running→done exit=0, running→done exit≠0);
    a box first seen in a terminal state fires nothing (restart hydration must not replay history);
    exit 254/253 (interrupted/stopped-by-operator) are "failed" with a distinct note.
  - `makeNotifier({send, cooldownMs})` — dedupes per (box, kind, question-hash), swallows send
    errors (notification failure never breaks the sweep), logs to stderr.
  - `formatNotification(event, {title?, task?, publicUrl})` — one-line headline + link to
    `/dashboard/#/box/<name>`. Digest headline (feature 2) enriches this later.
- Transport: generic webhook POST (JSON body), which covers Slack incoming webhooks, ntfy, Discord,
  and home-grown receivers without per-vendor code. Config: `NOTIFY_WEBHOOK_URL` (operator-level,
  env) **and** a per-user webhook stored in the existing encrypted `user_blobs` (kind
  `notify`, same pattern as skills/mcp-store). A box's owner decides which webhook fires
  (`ownerOf(db, box)` → that user's blob, else the operator env URL).
- Routes: `GET/POST /notify.json` (view/set the caller's webhook + which events are on;
  cookie/bearer auth like every settings route; URL validated http(s), no credentials in URL).
- Wire-up: inside the fleet reader's sweep callback in http.ts, after `boxes` is built — compare
  against the previous sweep's states (the `lastSeenStatus` map generalises to `lastSeenRun`).

**Tests** (`test/notify.test.ts`): edge-only firing; hydration silence; dedupe window; question
change re-fires waiting; owner routing picks the user webhook over env; send failure swallowed;
formatter output shape; URL validation.

**Live verify.** Point a webhook at a request bin on the VPS, delegate a box that asks a question,
then one that finishes, then one that fails. Three posts, correct kinds, no duplicates.

---

## 2. Run digest — a claim ledger, not a transcript

**Problem.** Reviewing a finished run means scrolling a transcript. The human at a distance needs:
what was asked, what was claimed, what actually happened, what to distrust.

**Design.** Pure derivation from data that already exists — no new instrumentation in the box.

- `src/digest.ts` (new): `buildDigest(input)` — pure. Input: the parsed trace events (the same
  `parseTrace` the dashboard uses — it moves/gets re-exported so the server can import it, or the
  server keeps its own thin parser over the sentinels), plus `/changes.json` output, task text, run
  state/exit, timings from plan sentinel stamps. Output:
  ```ts
  interface RunDigest {
    box: string; task: string; state: "done" | "failed" | "waiting";
    exitCode?: number; startedAt?: number; endedAt?: number;
    plan: Array<{ text: string; state: "done" | "active" | "todo"; failed?: boolean }>;
    files: Array<{ path: string; status: string; additions: number; deletions: number }>;
    failedCommands: Array<{ name: string; arg?: string }>;   // tool calls flagged ⟦err⟧
    questions: Array<{ question: string; answer?: string }>; // ask/you pairs from the trace
    headline: string;                                        // one sentence for notifications
    verified?: VerifyResult;                                 // feature 3 slots in here
  }
  ```
  Headline rule: `"<done|failed> · <n> files · <m> steps<, k failed commands><, unanswered question>"`.
- `GET /digest.json?session=` — assembles trace (via the existing watch read) + changes, returns the
  digest; same auth/ownership/redaction path as `/watch.json`.
- MCP: `status` on a done box appends the headline; no new tool.
- UI: a digest card at the top of a finished thread (follow-up; the JSON route is the deliverable).
- Feature 1 uses `headline` in the done/failed notification once both exist.

**Tests** (`test/digest.test.ts`): plan extraction incl. failed steps; ask/you pairing (answered vs
pending); failed-command collection from ⟦err⟧; headline for clean/failed/waiting; empty log;
files merge; forged-sentinel content (defanged) never becomes digest structure.

---

## 3. Verified outcomes — "done" means proven

**Problem.** `run:done exit=0` means the agent *said* it finished. The verify lane makes "done"
mean *checked by something that cannot edit the code*.

**Design.** Reuse the ask lane wholesale: same box, read-only hooks, `ASK_LANE_ENV=1`, capped turn.

- `delegate`/`resume` gain optional `verify: string` — either a shell command (runs verbatim,
  exit 0 = pass) or a natural-language acceptance criterion (the read-only co-pilot judges it and
  must answer `VERDICT: pass|fail — <reason>`). Discriminated by shape: a string starting with
  `$ ` or matching a command heuristic runs as a command; else it goes to the co-pilot. To stay
  unambiguous the API is explicit instead: `verify: {command: "npm test"}` or
  `verify: {criterion: "the new endpoint returns 401 without a token"}` — no guessing.
  - Command mode runs in the driver's workdir but on the ASK lane env (read-only hooks are per-lane;
    the command itself may build/test — the RO gate applies to the *co-pilot's* tool calls, not to a
    verify command, so command mode uses a plain exec with a timeout, NOT the RO hook).
  - Criterion mode = one `askInBox` turn with a verdict-shaped prompt; parse `VERDICT:` from the
    answer (pure parser, tested).
- `src/verify.ts` (new): `parseVerdict(answer)`, `verifyPlanOf(input)` (validation: cap lengths,
  refuse both/neither key), and `runVerification(cfg, box, plan)` (IO: command exec or ask turn).
- Storage: the verify request rides in the run memory (`run-memory.ts` meta) so a resume knows it;
  the result lands in the digest (`verified: {mode, pass, detail}`) and the done notification says
  `done:verified` / `done:UNVERIFIED (failed: …)`.
- Trigger: after the driver reaches `done` in `runDelegation`/`resume` (post-`driveInteractive`,
  only when state is done, exit 0). A verify failure never un-finishes the run — it stamps it.

**Tests** (`test/verify.test.ts`): plan validation; verdict parsing (pass/fail/garbage/missing);
command mode maps exit codes; criterion mode wires the prompt and parses; done-with-failed-verify
digest/notification wording; verify skipped on failed runs.

---

## 4. Dependent delegations — fleet as a team

**Problem.** Multi-step workflows (implement → test → adversarial review) need N isolated agents
with clean context each; today the operator hand-carries patches between boxes.

**Design.** A handoff primitive on top of the existing patch pipeline (box 1 `git diff --binary`,
box 2 clone+apply — already proven end-to-end).

- `delegate` gains `after?: string` (a session id) and `carry?: "patch" | "none"` (default `patch`
  when `after` is set and the parent has a repo).
- `src/handoff.ts` (new):
  - `extractCarryPatch(cfg, parentBox, repoDir)` — IO: `git add -A -N && git diff origin/<ref>
    --binary` inside the parent box (driver lane is done, so this is safe), size-capped by
    `MAX_PATCH_BYTES`.
  - Pure: `handoffPlan(parentMeta, childInput)` — resolves the child's repo/ref from the parent's
    run memory when omitted; validation (parent must exist and be done; task-only parents carry
    nothing).
- Scheduling: v1 is **immediate-on-done** — if the parent is still running, delegate returns a
  question ("parent still running; re-call when done, or pass wait:true"). `wait: true` blocks on
  the same `waitForBoundary` loop status uses (bounded by the standard window; on timeout it says
  reconnect). No new queue infrastructure; the calling agent (or the operator) is the scheduler.
- Ownership: `own.check(after)` — you can only chain off your own boxes.
- The digest of the child records `carriedFrom: <parent>`.

**Tests** (`test/handoff.test.ts`): plan resolution from parent meta; refusal on running/missing/
foreign parent; patch size cap; task-only parent → carry none; carried patch lands in the child's
delegate plan (handler-level test with fake deps).

---

## 5. Step snapshots — time travel (last; riskiest)

**Problem.** A failed run is pure waste; a mid-run wrong turn can only be re-run from zero.

**Design.** `msb` snapshots at plan-step boundaries. Gated behind config (`SNAP_STEPS=1`) because
snapshot cost/latency on the VPS must be measured first (bench in `src/bench.ts` extended).

- v0 (ship first): **one snapshot at the ask-pause moment** — when a run enters `waiting`, snapshot
  the box before the answer arrives. `resume` gains `rewind?: true`: restore the snapshot, then
  deliver the (different) answer. One snapshot per box, replaced on each pause; deleted on teardown.
- v1: snapshot per `⟦plan⟧` transition (the formatter's plan sentinel gives the trigger), `rewind:
  {toStep: n}`.
- `src/snapshot.ts` (new): name scheme `snap-<box>-<n>`, list/prune, restore = stop box → boot from
  snapshot under the same name (msb semantics to be confirmed on the VPS before the spec hardens —
  this section is deliberately the least specified and MUST be re-planned after a spike).

**Tests:** naming/pruning pure logic; the restore flow against a live box in the spike.

---

## Cross-cutting rules

- Every feature: pure logic in its own module, IO injected, unit tests written FIRST, then the
  wire-up, then `npm run build && npm test`, then commit, deploy via `deploy-asb.cmd`, live-verify
  on the deployed controller, then next feature.
- No new auth surface: every route uses `dashAuthed` + the session middleware; every box-scoped
  input is `isBoxName`-checked at the edge (already enforced globally).
- Redaction: digest/notification text goes through the existing redactor before leaving the server.
- Docs: `docs/status.md` gets a row per shipped feature.
