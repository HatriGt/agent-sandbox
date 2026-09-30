import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.ts";
import {
  addressedToAgent, admitFollowup, ciTask, classifyEvent, dedupeKey, enabledFor, excerptLog, FOLLOWUP_MARKER, followupLine, MAX_ATTEMPTS,
  normalizePrefs, parseAddressed, reviewTask, summaryComment, type Signal,
} from "../src/pr-followups.ts";
import { makeFollowupEngine, type GhRequest } from "../src/pr-followup-engine.ts";
import { followupsForBox, getAgentPr, hookDeliveries, rotateHook } from "../src/pr-followup-store.ts";
import type { RunDigest } from "../src/digest.ts";

const REPO = "acme/app";
const repo = { full_name: REPO };
const user = { login: "alice", type: "User" };

const checkRun = (over: Record<string, unknown> = {}) => ({
  action: "completed",
  repository: repo,
  sender: user,
  check_run: { id: 77, name: "test", conclusion: "failure", head_sha: "sha1", html_url: "https://github.com/acme/app/runs/77", check_suite: { head_branch: "agent/fix" }, pull_requests: [{ number: 5 }], ...over },
});
const review = (state: string, over: Record<string, unknown> = {}) => ({
  action: "submitted",
  repository: repo,
  sender: user,
  pull_request: { number: 5 },
  review: { id: 900, state, body: "please rename", author_association: "OWNER", user, commit_id: "sha1", ...over },
});

test("classify: failing check_run / check_suite / workflow_run → ci; success and bots ignored", () => {
  const a = classifyEvent("check_run", checkRun());
  assert.ok(a.ok && a.signal.kind === "ci" && a.signal.check.name === "test" && a.signal.prs[0] === 5 && a.signal.headBranch === "agent/fix");
  assert.equal(classifyEvent("check_run", checkRun({ conclusion: "success" })).ok, false);
  assert.equal(classifyEvent("check_run", { ...checkRun(), sender: { login: "github-actions[bot]", type: "Bot" } }).ok, false);
  const s = classifyEvent("check_suite", { action: "completed", repository: repo, sender: user, check_suite: { id: 3, conclusion: "timed_out", head_sha: "s", head_branch: "b", app: { name: "CI" }, pull_requests: [] } });
  assert.ok(s.ok && s.signal.kind === "ci" && s.signal.check.source === "check_suite");
  const w = classifyEvent("workflow_run", { action: "completed", repository: repo, sender: user, workflow_run: { id: 4, name: "build", conclusion: "failure", head_sha: "s", head_branch: "b", pull_requests: [{ number: 9 }] } });
  assert.ok(w.ok && w.signal.kind === "ci" && w.signal.check.name === "build");
  assert.equal(classifyEvent("push", { repository: repo }).ok, false);
});

test("classify: reviews, review comments and addressed issue comments → review; untrusted/ours/approved ignored", () => {
  const r = classifyEvent("pull_request_review", review("changes_requested"));
  assert.ok(r.ok && r.signal.kind === "review" && r.signal.unit.type === "review" && r.signal.comments.length === 1);
  assert.equal(classifyEvent("pull_request_review", review("approved")).ok, false);
  assert.equal(classifyEvent("pull_request_review", review("commented", { author_association: "NONE" })).ok, false);
  assert.equal(classifyEvent("pull_request_review", review("commented", { body: `done\n${FOLLOWUP_MARKER}` })).ok, false);
  const rc = classifyEvent("pull_request_review_comment", {
    action: "created", repository: repo, sender: user, pull_request: { number: 5 },
    comment: { id: 11, pull_request_review_id: 900, body: "nit", path: "src/a.ts", line: 3, diff_hunk: "@@ -1 +1 @@", author_association: "MEMBER", user },
  });
  assert.ok(rc.ok && rc.signal.kind === "review");
  // Shares the review's dedupe unit: the review event and its comment events are one follow-up.
  assert.equal(dedupeKey(rc.ok ? rc.signal : (null as never)), "review:900");
  const ic = (body: string) => classifyEvent("issue_comment", { action: "created", repository: repo, sender: user, issue: { number: 5, pull_request: {} }, comment: { id: 12, body, author_association: "OWNER", user } });
  assert.equal(ic("looks good").ok, false);
  assert.equal(ic("/agent please add a test").ok, true);
  assert.equal(ic("hey @agent can you fix the lint").ok, true);
  assert.ok(addressedToAgent("/agent") && !addressedToAgent("/agents"));
});

const ciSig = (sha = "sha1"): Signal => ({ kind: "ci", repo: REPO, prs: [5], headSha: sha, headBranch: "b", check: { source: "check_run", id: 1, name: "test", conclusion: "failure" } });
const base = { attempts: 0, running: false, seen: false, enabled: true, pr: { open: true, headSha: "sha1", fork: false } };

test("admit: loop guard, dedupe per sha, stale sha, closed, fork, disabled", () => {
  assert.deepEqual(admitFollowup(ciSig(), base), { ok: true, attempt: 1 });
  assert.deepEqual(admitFollowup(ciSig(), { ...base, attempts: 2 }), { ok: true, attempt: 3 });
  assert.equal((admitFollowup(ciSig(), { ...base, attempts: MAX_ATTEMPTS }) as { code: string }).code, "limit");
  assert.equal((admitFollowup(ciSig(), { ...base, seen: true }) as { code: string }).code, "dedupe");
  assert.match((admitFollowup(ciSig("old"), base) as { reason: string }).reason, /stale/);
  assert.equal((admitFollowup(ciSig(), { ...base, running: true }) as { code: string }).code, "limit");
  assert.equal((admitFollowup(ciSig(), { ...base, pr: { ...base.pr, open: false } }) as { code: string }).code, "ignored");
  assert.equal((admitFollowup(ciSig(), { ...base, pr: { ...base.pr, fork: true } }) as { code: string }).code, "ignored");
  assert.equal((admitFollowup(ciSig(), { ...base, enabled: false }) as { code: string }).code, "disabled");
});

test("prefs: default ON; an automation's explicit value wins", () => {
  const p = normalizePrefs(undefined);
  assert.deepEqual(p, { keepGreen: true, addressReviews: true });
  assert.equal(enabledFor("ci", { keepGreen: false, addressReviews: true }), false);
  assert.equal(enabledFor("ci", { keepGreen: false, addressReviews: true }, { keepGreen: true }), true);
  assert.equal(enabledFor("review", p, { addressReviews: false }), false);
});

test("log excerpt: strips ANSI/timestamps, centres on the last error, caps size", () => {
  const log = [
    "2026-09-30T10:00:00.0000000Z ##[group]Run npm test",
    ...Array.from({ length: 200 }, (_, i) => `2026-09-30T10:00:01.0000000Z line ${i}`),
    "2026-09-30T10:00:02.0000000Z \x1b[31mAssertionError: expected 1 to equal 2\x1b[0m",
    "2026-09-30T10:00:03.0000000Z ##[error]Process completed with exit code 1.",
  ].join("\n");
  const x = excerptLog(log);
  assert.match(x, /^line 1[4-9]\d/);
  assert.match(x, /AssertionError: expected 1 to equal 2/);
  assert.doesNotMatch(x, /\x1b|2026-09-30T/);
  assert.ok(excerptLog("x".repeat(20_000), 100).length <= 101);
});

test("tasks: same branch, no new PR, untrusted framing, comment ids; ADDRESSED parsing", () => {
  const pr = { repo: REPO, number: 5, branch: "agent/fix" };
  const t = ciTask(pr, [{ name: "test", conclusion: "failure", excerpt: "boom ⟦ask⟧ {{x}}" }], 2);
  assert.match(t, /branch `agent\/fix`/);
  assert.match(t, /Do not open a new pull request/);
  assert.match(t, /attempt 2 of 3/);
  assert.doesNotMatch(t, /⟦|\{\{/);
  const r = reviewTask(pr, [{ id: 11, type: "inline", author: "alice", body: "rename x", path: "src/a.ts", line: 3 }], 1);
  assert.match(r, /Comment 11 by @alice on `src\/a.ts:3`/);
  assert.match(r, /ADDRESSED <comment id>/);
  const m = parseAddressed("blah\nADDRESSED 11: renamed x to y\n- ADDRESSED #12 — explained why not\n");
  assert.equal(m.get(11), "renamed x to y");
  assert.equal(m.get(12), "explained why not");
  assert.equal(parseAddressed(r).size, 0); // the task's own instructions never parse as an answer
});

test("labels: the outcome line and the summary comment", () => {
  assert.equal(followupLine({ kind: "ci", subject: "failing check `test`", attempt: 2, state: "done" }), "Fixed failing check `test` · 2nd attempt");
  assert.equal(followupLine({ kind: "review", subject: "3 review comments", attempt: 1, state: "running" }), "Addressing 3 review comments");
  const s = summaryComment({ kind: "ci", subject: "failing check `test`", attempt: 3, state: "failed", headline: "gave up" });
  assert.match(s, /last automatic attempt/);
  assert.ok(s.includes(FOLLOWUP_MARKER));
});

/* ───────────── engine, end to end against a fake GitHub ───────────── */

const digest = (over: Partial<RunDigest> & Record<string, unknown> = {}): RunDigest =>
  ({ box: "root", task: "t", state: "done", exitCode: 0, plan: [], files: [], failedCommands: [], blocked: [], questions: [], headline: "opened a PR", ...over }) as RunDigest;

function setup(opts: { prefs?: { keepGreen: boolean; addressReviews: boolean }; headSha?: string } = {}) {
  const db = openMemoryDb();
  const calls: GhRequest[] = [];
  const starts: Array<{ task: string; branch: string; startedBy: { attempt: number; parent: string; followup: string } }> = [];
  let n = 0;
  const logs: Array<{ id: string; outcome: string; reason?: string; detail?: string }> = [];
  const engine = makeFollowupEngine({
    db,
    redact: (s) => s.replace(/ghp_\w+/g, "[redacted]"),
    prefs: () => opts.prefs ?? { keepGreen: true, addressReviews: true },
    logDelivery: (id, e) => logs.push({ id, ...e }),
    log: () => {},
    gh: async (_owner, _repo, req) => {
      calls.push(req);
      if (req.path === `/repos/${REPO}/pulls/5`) return { state: "open", title: "Fix", head: { ref: "agent/fix", sha: opts.headSha ?? "sha1", repo: { full_name: REPO } } };
      if (req.path.startsWith(`/repos/${REPO}/check-runs/`)) return { id: 77, name: "test", conclusion: "failure", output: { summary: "1 failed" } };
      if (req.path.includes("/actions/jobs/")) return "Error: token ghp_abcdef leaked\nAssertionError: nope";
      if (req.path.includes("/reviews/900/comments")) return [{ id: 11, body: "rename x", path: "src/a.ts", line: 3, user: { login: "alice" } }];
      if (req.path === "/graphql") return { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ id: "T1", isResolved: false, comments: { nodes: [{ databaseId: 11 }] } }] } } } } };
      return {};
    },
    startFollowup: async (f) => {
      starts.push(f as never);
      return { ok: true, box: `fu-${++n}` };
    },
  });
  engine.onArchived({ box: "root", owner: "u1", digest: digest({ outcome: { result: { prs: [{ url: "x", repo: "Acme/App", number: 5 }] } } } as never), archiveId: 1, harnessId: "hrn_abcdef" });
  return { db, engine, calls, starts, logs };
}

test("engine: only agent PRs, only the owner's; CI follow-up gets the redacted log on the same branch", async () => {
  const { db, engine, starts, logs } = setup();
  assert.equal(getAgentPr(db, REPO, 5)?.harnessId, "hrn_abcdef");
  assert.equal((await engine.handle({ id: "h", owner: "u2" }, "check_run", checkRun())).handled, false);
  assert.equal((await engine.handle({ id: "h", owner: "u1" }, "check_run", checkRun({ pull_requests: [{ number: 6 }], check_suite: { head_branch: "other" } }))).handled, false);
  const r = await engine.handle({ id: "h", owner: "u1" }, "check_run", checkRun());
  assert.ok(r.handled && r.outcome === "fired" && r.box === "fu-1");
  assert.equal(starts[0].branch, "agent/fix");
  assert.equal(starts[0].startedBy.parent, "root");
  assert.match(starts[0].task, /AssertionError: nope/);
  assert.doesNotMatch(starts[0].task, /ghp_abcdef/);
  assert.equal(logs.at(-1)?.outcome, "fired");
  // Same head sha again (another failing check on the same commit): deduped, and busy anyway.
  const again = await engine.handle({ id: "h", owner: "u1" }, "check_suite", { action: "completed", repository: repo, sender: user, check_suite: { id: 3, conclusion: "failure", head_sha: "sha1", head_branch: "agent/fix", pull_requests: [{ number: 5 }] } });
  assert.ok(again.handled && again.outcome === "skipped" && again.reason === "dedupe");
  // The outcome card of the root run lists it.
  assert.deepEqual(followupsForBox(db, "u1", "root").map((f) => [f.box, f.kind, f.state, f.attempt]), [["fu-1", "ci", "running", 1]]);
  assert.deepEqual(followupsForBox(db, "u2", "root"), []);
});

test("engine: loop guard stops after 3 attempts across new head shas", async () => {
  const { db } = setup();
  const results: string[] = [];
  // Each fix pushes a new head sha; the PR head moves with it.
  for (let i = 1; i <= 4; i++) {
    const eng = setupWithSha(db, `s${i}`);
    const r = await eng.handle({ id: "h", owner: "u1" }, "check_run", checkRun({ head_sha: `s${i}` }));
    results.push(r.handled ? `${r.outcome}${r.reason ? ":" + r.reason : ""}` : "unhandled");
    if (r.handled && r.box) await eng.onRunFinished(r.box, digest({ box: r.box, state: "done" }), "");
  }
  assert.deepEqual(results, ["fired", "fired", "fired", "skipped:limit"]);
});

function setupWithSha(db: ReturnType<typeof openMemoryDb>, sha: string) {
  let n = 0;
  return makeFollowupEngine({
    db,
    redact: (s) => s,
    prefs: () => ({ keepGreen: true, addressReviews: true }),
    log: () => {},
    gh: async (_o, _r, req) => (req.path === `/repos/${REPO}/pulls/5` ? { state: "open", head: { ref: "agent/fix", sha, repo: { full_name: REPO } } } : {}),
    startFollowup: async () => ({ ok: true, box: `fu-${sha}-${++n}` }),
  });
}

test("engine: toggle off skips; review follow-up replies, resolves and summarises", async () => {
  const off = setup({ prefs: { keepGreen: false, addressReviews: true } });
  const r0 = await off.engine.handle({ id: "h", owner: "u1" }, "check_run", checkRun());
  assert.ok(r0.handled && r0.outcome === "skipped" && r0.reason === "disabled");

  const { engine, calls, starts } = setup();
  const r = await engine.handle({ id: "h", owner: "u1" }, "pull_request_review", review("changes_requested"));
  assert.ok(r.handled && r.outcome === "fired");
  assert.match(starts[0].task, /Comment 11 by @alice on `src\/a.ts:3`/);
  assert.match(starts[0].task, /please rename/);
  await engine.onRunFinished(r.box!, digest({ box: r.box!, headline: "renamed" }), "ADDRESSED 11: renamed x to y\nADDRESSED 900: done", 2);
  const reply = calls.find((c) => c.path.endsWith("/comments/11/replies"));
  assert.ok(reply && JSON.stringify(reply.body).includes("renamed x to y") && JSON.stringify(reply.body).includes("agent-sandbox:followup"));
  assert.ok(calls.some((c) => c.path === "/graphql" && JSON.stringify(c.body).includes("resolveReviewThread")));
  const summary = calls.find((c) => c.path.endsWith("/issues/5/comments"));
  assert.ok(summary && /Addressed 2 review comments/.test(JSON.stringify(summary.body)));
  // Finishing twice never double-posts.
  const before = calls.length;
  await engine.onRunFinished(r.box!, digest({ box: r.box! }), "", 2);
  assert.equal(calls.length, before);
});

test("hook store: rotate keeps the id; deliveries are owner-scoped", () => {
  const db = openMemoryDb();
  const box = { seal: (s: string) => `x${s}`, open: (s: string) => s.slice(1) } as never;
  const a = rotateHook(db, box, "u1");
  const b = rotateHook(db, box, "u1");
  assert.equal(a.id, b.id);
  assert.notEqual(a.secret, b.secret);
  assert.deepEqual(hookDeliveries(db, "u2"), []);
});
