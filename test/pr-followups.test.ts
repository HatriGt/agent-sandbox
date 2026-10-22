import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.ts";
import {
  addressedToAgent, admitFollowup, ciTask, classifyEvent, commandOf, commandReply, commandTask, dedupeKey, enabledFor, excerptLog, FOLLOWUP_MARKER, followupLine,
  MAX_ATTEMPTS, MAX_COMMANDS, normalizePrefs, parseAddressed, parseReply, REPLY_CLOSE, REPLY_OPEN, reviewTask, subjectOf, summaryComment, type Signal,
} from "../src/pr-followups.ts";
import { makeFollowupEngine, type GhRequest } from "../src/pr-followup-engine.ts";
import { followupsForBox, getAgentPr, hookDeliveries, mentionsSourceId, rotateHook } from "../src/pr-followup-store.ts";
import { isAgentCommand, makeMentionWatcher, payloadOf } from "../src/agent-mentions.ts";
import { GhRateLimitError } from "../src/repo-watch.ts";
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
  const ic = (body: string, assoc = "OWNER") =>
    classifyEvent("issue_comment", { action: "created", repository: repo, sender: user, issue: { number: 5, pull_request: {} }, comment: { id: 12, body, author_association: assoc, user } });
  assert.equal(ic("looks good").ok, false);
  // An addressed PR comment is a command: the ask with the prefix stripped, the comment kept for the reply.
  const cmd = ic("/agent please add a test");
  assert.ok(cmd.ok && cmd.signal.kind === "command" && cmd.signal.command === "please add a test" && cmd.signal.comment.id === 12 && cmd.signal.author === "alice");
  assert.equal(dedupeKey(cmd.ok ? cmd.signal : (null as never)), "issue_comment:12");
  const mention = ic("hey @agent can you fix the lint");
  assert.ok(mention.ok && mention.signal.kind === "command" && mention.signal.command === "hey can you fix the lint");
  assert.equal(ic("/agent do it", "NONE").ok, false);
  assert.equal(classifyEvent("issue_comment", { action: "created", repository: repo, sender: user, issue: { number: 5 }, comment: { id: 12, body: "/agent", author_association: "OWNER", user } }).ok, false);
  assert.ok(addressedToAgent("/agent") && !addressedToAgent("/agents"));
  assert.equal(commandOf("/agent"), "");
  assert.equal(commandOf("/agent\nfix the build"), "fix the build");
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
  // Commands are a conversation: the 3-attempt loop guard does not apply, only the runaway cap.
  const cmd: Signal = { kind: "command", repo: REPO, prs: [5], unit: { type: "issue_comment", id: 12 }, author: "alice", command: "add a test", comment: { id: 12, type: "issue", author: "alice", body: "/agent add a test" } };
  assert.deepEqual(admitFollowup(cmd, { ...base, attempts: MAX_ATTEMPTS }), { ok: true, attempt: MAX_ATTEMPTS + 1 });
  assert.equal((admitFollowup(cmd, { ...base, attempts: MAX_COMMANDS }) as { code: string }).code, "limit");
  assert.match((admitFollowup(cmd, { ...base, enabled: false }) as { reason: string }).reason, /any PR is off/);
});

test("prefs: default ON; an automation's explicit value wins", () => {
  const p = normalizePrefs(undefined);
  assert.deepEqual(p, { keepGreen: true, addressReviews: true, commandAnywhere: true });
  assert.equal(enabledFor("ci", { ...p, keepGreen: false }), false);
  assert.equal(enabledFor("ci", { ...p, keepGreen: false }, { keepGreen: true }), true);
  assert.equal(enabledFor("review", p, { addressReviews: false }), false);
  // A command on an agent PR rides on "Address review comments"; on an adopted PR on "Answer /agent on any PR".
  assert.equal(enabledFor("command", { ...p, addressReviews: false }), false);
  assert.equal(enabledFor("command", { ...p, addressReviews: false }, undefined, true), true);
  assert.equal(enabledFor("command", { ...p, commandAnywhere: false }, undefined, true), false);
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
  const c = commandTask({ ...pr, title: "Add login" }, { id: 12, type: "issue", author: "alice", body: "/agent add a test for {{x}}" }, "add a test for {{x}}", 2);
  assert.match(c, /@alice asked you something on pull request acme\/app#5 \("Add login"\) — comment 12, the 2nd request/);
  assert.match(c, /branch `agent\/fix`/);
  assert.doesNotMatch(c, /\{\{x\}\}/);
  assert.match(c, new RegExp(`^${REPLY_OPEN}$`, "m"));
  assert.equal(parseReply(c), undefined); // the instructions' placeholder is not a reply
  const bare = commandTask(pr, { id: 12, type: "issue", author: "alice", body: "/agent" }, "", 1);
  assert.match(bare, /just "\/agent"/);
  const log = `${c}\n…work…\n${REPLY_OPEN}\nAdded \`login.test.ts\` covering the happy path.\n\n- pushed 1 commit\n${REPLY_CLOSE}\ntrailing harness noise`;
  assert.equal(parseReply(log), "Added `login.test.ts` covering the happy path.\n\n- pushed 1 commit");
  assert.equal(parseReply(`${REPLY_OPEN}\n\`\`\`\nfenced anyway\n\`\`\`\n${REPLY_CLOSE}`), "fenced anyway");
  assert.equal(parseReply(`${REPLY_OPEN}\nno close marker`), "no close marker");
});

test("labels: the outcome line and the summary comment", () => {
  assert.equal(followupLine({ kind: "ci", subject: "failing check `test`", attempt: 2, state: "done" }), "Fixed failing check `test` · 2nd attempt");
  assert.equal(followupLine({ kind: "review", subject: "3 review comments", attempt: 1, state: "running" }), "Addressing 3 review comments");
  const s = summaryComment({ kind: "ci", subject: "failing check `test`", attempt: 3, state: "failed", headline: "gave up" });
  assert.match(s, /last automatic attempt/);
  assert.ok(s.includes(FOLLOWUP_MARKER));
  assert.equal(followupLine({ kind: "command", subject: "@alice: “add a test”", attempt: 3, state: "done" }), "Answered @alice: “add a test” · 3rd request");
  const sig: Signal = { kind: "command", repo: REPO, prs: [5], unit: { type: "issue_comment", id: 12 }, author: "alice", command: "x".repeat(80), comment: { id: 12, type: "issue", author: "alice", body: "" } };
  assert.equal(subjectOf(sig), `@alice: “${"x".repeat(57)}…”`);
  assert.equal(subjectOf({ ...sig, command: "" }), "@alice's /agent");
  const reply = commandReply({ reply: "Done, pushed.", headline: "h", state: "done", author: "alice", runUrl: "https://x/run" });
  assert.ok(reply.startsWith("Done, pushed.") && reply.includes("[open the run](https://x/run)") && reply.includes(FOLLOWUP_MARKER));
  const noReply = commandReply({ headline: "fixed the lint", state: "done", author: "alice" });
  assert.match(noReply, /^@alice fixed the lint/);
  assert.match(commandReply({ headline: "boom", state: "failed", author: "alice" }), /run failed before it could reply: boom/);
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

const issueComment = (body: string, over: Record<string, unknown> = {}) => ({
  action: "created",
  repository: repo,
  sender: user,
  issue: { number: 7, pull_request: {} },
  comment: { id: 31, body, author_association: "OWNER", user, html_url: "https://github.com/acme/app/pull/7#issuecomment-31", ...over },
});

function setupAnyPr(opts: { prefs?: { keepGreen: boolean; addressReviews: boolean; commandAnywhere: boolean }; prOpen?: boolean } = {}) {
  const db = openMemoryDb();
  const calls: GhRequest[] = [];
  const starts: Array<{ task: string; branch: string; startedBy: { attempt: number; parent: string; followup: string } }> = [];
  const logs: Array<{ id: string; outcome: string; reason?: string; detail?: string }> = [];
  let n = 0;
  const engine = makeFollowupEngine({
    db,
    publicUrl: "https://asb.example",
    redact: (s) => s.replace(/ghp_\w+/g, "[redacted]"),
    prefs: () => opts.prefs ?? { keepGreen: true, addressReviews: true, commandAnywhere: true },
    logDelivery: (id, e) => logs.push({ id, ...e }),
    log: () => {},
    gh: async (_owner, _repo, req) => {
      calls.push(req);
      if (req.path === `/repos/${REPO}/pulls/7`) return { state: opts.prOpen === false ? "closed" : "open", title: "Human PR", head: { ref: "feat/login", sha: "h1", repo: { full_name: REPO } } };
      if (req.path === `/repos/other/repo/pulls/1`) throw new Error("GitHub answered 404");
      return {};
    },
    startFollowup: async (f) => {
      starts.push(f as never);
      return { ok: true, box: `cmd-${++n}` };
    },
  });
  return { db, engine, calls, starts, logs };
}

test("engine: /agent on a PR nobody here opened is adopted only when asked to; the reply is posted; the next /agent is a new turn", async () => {
  const { db, engine, calls, starts, logs } = setupAnyPr();
  // An automation's webhook (no adopt): still "not ours".
  const plain = await engine.handle({ id: "h", owner: "u1" }, "issue_comment", issueComment("/agent add a test"));
  assert.equal(plain.handled, false);
  assert.equal(getAgentPr(db, REPO, 7), undefined);
  // The owner's hook / the activity poller (adopt): read the PR as the owner, adopt, run on its branch.
  const r = await engine.handle({ id: "h", owner: "u1" }, "issue_comment", issueComment("/agent add a test for ghp_secret123"), { adopt: true });
  assert.ok(r.handled && r.outcome === "fired" && r.box === "cmd-1");
  const apr = getAgentPr(db, REPO, 7);
  assert.ok(apr?.adopted && apr.owner === "u1" && apr.branch === "feat/login");
  assert.equal(starts[0].branch, "feat/login");
  assert.equal(starts[0].startedBy.followup, "command");
  assert.equal(starts[0].startedBy.parent, "");
  assert.match(starts[0].task, /@alice asked you something on pull request acme\/app#7/);
  assert.match(starts[0].task, /add a test for \[redacted\]/);
  assert.doesNotMatch(starts[0].task, /ghp_secret123/);
  // Same comment again (a second delivery): deduped.
  const dup = await engine.handle({ id: "h", owner: "u1" }, "issue_comment", issueComment("/agent add a test"), { adopt: true });
  assert.ok(dup.handled && dup.outcome === "skipped" && dup.reason === "dedupe");
  // A new ask while the first runs: skipped, and told so on the PR — once.
  const busy = await engine.handle({ id: "h", owner: "u1" }, "issue_comment", issueComment("/agent also lint", { id: 32 }), { adopt: true });
  assert.ok(busy.handled && busy.outcome === "skipped" && busy.reason === "limit");
  const busyNote = calls.filter((c) => c.method === "POST" && c.path === `/repos/${REPO}/issues/7/comments`);
  assert.equal(busyNote.length, 1);
  assert.match(JSON.stringify(busyNote[0].body), /still working on the previous request/);
  await engine.handle({ id: "h", owner: "u1" }, "issue_comment", issueComment("/agent also lint", { id: 32 }), { adopt: true });
  assert.equal(calls.filter((c) => c.method === "POST" && c.path === `/repos/${REPO}/issues/7/comments`).length, 1);
  // The run finishes: the agent's reply block is what lands on the PR.
  await engine.onRunFinished("cmd-1", digest({ box: "cmd-1", headline: "added the test" }), `noise\n${REPLY_OPEN}\nAdded \`login.test.ts\`; pushed to feat/login.\n${REPLY_CLOSE}\n`, 9);
  const posted = calls.filter((c) => c.method === "POST" && c.path === `/repos/${REPO}/issues/7/comments`);
  assert.equal(posted.length, 2);
  const body = (posted[1].body as { body: string }).body;
  assert.ok(body.startsWith("Added `login.test.ts`; pushed to feat/login."));
  assert.match(body, /open the run\]\(https:\/\/asb\.example\/dashboard\/box\/cmd-1\)/);
  assert.ok(body.includes(FOLLOWUP_MARKER));
  // The next /agent on the same PR is request 2 — no 3-attempt cap in the way.
  const again = await engine.handle({ id: "h", owner: "u1" }, "issue_comment", issueComment("/agent now the docs", { id: 33 }), { adopt: true });
  assert.ok(again.handled && again.outcome === "fired");
  assert.equal(starts[1].startedBy.attempt, 2);
  assert.match(starts[1].task, /the 2nd request on this PR/);
  // CI / review signals never fire on an adopted PR.
  const ci = await engine.handle({ id: "h", owner: "u1" }, "check_run", checkRun({ pull_requests: [{ number: 7 }], check_suite: { head_branch: "feat/login" } }), { adopt: true });
  assert.equal(ci.handled, false);
  // Another owner's hook cannot touch it.
  assert.equal((await engine.handle({ id: "h", owner: "u2" }, "issue_comment", issueComment("/agent hi", { id: 34 }), { adopt: true })).handled, false);
  assert.deepEqual(followupsForBox(db, "u1", "cmd-1").map((f) => [f.kind, f.state, f.attempt]), [["command", "done", 1], ["command", "running", 2]]);
  assert.ok(logs.every((l) => l.id === "h"));
});

test("engine: adoption needs the owner's token to read the PR; the toggle off skips; a failed run says so", async () => {
  const { engine, calls } = setupAnyPr();
  const far = await engine.handle({ id: "h", owner: "u1" }, "issue_comment", { ...issueComment("/agent x"), repository: { full_name: "other/repo" }, issue: { number: 1, pull_request: {} } }, { adopt: true });
  assert.ok(far.handled && far.outcome === "failed" && /could not read the PR/.test(far.detail));
  const off = setupAnyPr({ prefs: { keepGreen: true, addressReviews: true, commandAnywhere: false } });
  const r = await off.engine.handle({ id: "h", owner: "u1" }, "issue_comment", issueComment("/agent x"), { adopt: true });
  assert.ok(r.handled && r.outcome === "skipped" && r.reason === "disabled");
  const ok = await engine.handle({ id: "h", owner: "u1" }, "issue_comment", issueComment("/agent x"), { adopt: true });
  assert.ok(ok.handled && ok.outcome === "fired");
  await engine.onRunFinished(ok.box!, digest({ box: ok.box!, state: "failed", headline: "box crashed" }), "", 1);
  const posted = calls.filter((c) => c.method === "POST" && c.path === `/repos/${REPO}/issues/7/comments`);
  assert.match((posted.at(-1)!.body as { body: string }).body, /run failed before it could reply: box crashed/);
});

/* ───────────── the activity poller ───────────── */

const feedEvent = (id: string, body: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "IssueCommentEvent",
  actor: { login: "alice", type: "User" },
  repo: { name: REPO },
  created_at: new Date().toISOString(),
  payload: { action: "created", issue: { number: 7, pull_request: {} }, comment: { id: Number(id), body, author_association: "OWNER", user } },
  ...over,
});

test("mentions: baseline replays nothing; later /agent PR comments from the feed reach the engine once; noise is ignored", async () => {
  const { db, engine, starts, logs } = setupAnyPr();
  let feed: unknown[] = [feedEvent("100", "/agent old ask")];
  const gets: Array<{ login: string; path: string; etag?: string }> = [];
  let etag = "e1";
  const watcher = makeMentionWatcher({
    db,
    engine,
    log: () => {},
    enabled: () => true,
    accounts: async () => [{ owner: "u1", login: "alice" }],
    get: async (_owner, login, path, e) => {
      gets.push({ login, path, ...(e ? { etag: e } : {}) });
      if (e === etag) return { notModified: true, pollInterval: 60 };
      return { notModified: false, data: feed, etag, pollInterval: 60 };
    },
  });
  await watcher.tick();
  assert.equal(gets[0].path, "/users/alice/events?per_page=100");
  assert.equal(starts.length, 0); // baseline
  // Nothing new: a 304, and the poll interval keeps the next tick quiet.
  await watcher.pollFeed("u1", "alice");
  assert.equal(gets.at(-1)?.etag, "e1");
  await watcher.tick();
  assert.equal(gets.length, 2);
  // Three new events: a PR comment with /agent, an issue (not PR) comment with /agent, a push.
  // GitHub's event ids are not one sequence: the comment's id is below the baseline's (a real
  // feed shows IssueCommentEvents around 1.7e10 next to PushEvents around 2.4e10), and it must
  // still be picked up.
  etag = "e2";
  feed = [
    { id: "104", type: "PushEvent", repo: { name: REPO }, payload: {} },
    feedEvent("37", "/agent add a test"),
    feedEvent("102", "/agent on an issue", { payload: { action: "created", issue: { number: 2 }, comment: { id: 102, body: "/agent on an issue", author_association: "OWNER", user } } }),
    feedEvent("101", "plain comment"),
    feedEvent("100", "/agent old ask"),
  ];
  await watcher.pollFeed("u1", "alice");
  assert.equal(starts.length, 1);
  assert.match(starts[0].task, /add a test/);
  // The same feed read again: every event already seen.
  etag = "e3";
  await watcher.pollFeed("u1", "alice");
  assert.equal(starts.length, 1);
  // A row written by the old high-water-mark version re-baselines instead of replaying the page.
  db.prepare(`UPDATE repo_watch SET state_json = ? WHERE repo = '@alice'`).run(JSON.stringify({ lastId: "104" }));
  feed = [feedEvent("36", "/agent another ask"), ...feed];
  await watcher.pollFeed("u1", "alice"); // its etag is not sent either: a 304 would keep the old row
  assert.equal(gets.at(-1)?.etag, undefined);
  assert.equal(starts.length, 1);
  // The first request is still running, so the next one is a new turn once it finishes.
  await engine.onRunFinished("cmd-1", digest({ box: "cmd-1", headline: "added" }), `${REPLY_OPEN}
Added a test.
${REPLY_CLOSE}
`, 1);
  etag = "e5";
  feed = [feedEvent("35", "/agent after the baseline"), ...feed];
  await watcher.pollFeed("u1", "alice");
  assert.equal(starts.length, 2);
  assert.match(starts[1].task, /after the baseline/);
  assert.deepEqual(payloadOf(feedEvent("5", "/agent x") as never, "alice").repository, { full_name: REPO, name: "app", owner: { login: "acme" }, html_url: `https://github.com/${REPO}` });
  assert.equal(isAgentCommand(feedEvent("5", "nope") as never), false);
  assert.equal(isAgentCommand(feedEvent("5", "/agent yes") as never), true);
  assert.ok(logs.some((l) => l.id === "mentions:u1" && l.outcome === "fired"));
  assert.equal(mentionsSourceId("u1"), "mentions:u1");
});

test("mentions: the owner's toggle off means no read; a rate limit pauses the feed; a missing association is fetched", async () => {
  const { db, engine, starts } = setupAnyPr();
  let enabled = false;
  let calls = 0;
  let fail = false;
  const watcher = makeMentionWatcher({
    db,
    engine,
    log: () => {},
    enabled: () => enabled,
    accounts: async () => [{ owner: "u1", login: "alice" }],
    get: async (_o, _l, path) => {
      calls++;
      if (fail) throw new GhRateLimitError(403, { retryAfterMs: 3_600_000 }, path);
      if (path.includes("/issues/comments/")) return { notModified: false, data: { author_association: "COLLABORATOR" } };
      return { notModified: false, data: calls === 1 ? [] : [feedEvent("9", "/agent hi", { payload: { action: "created", issue: { number: 7, pull_request: {} }, comment: { id: 9, body: "/agent hi", user } } })], etag: `e${calls}` };
    },
  });
  await watcher.tick();
  assert.equal(calls, 0);
  enabled = true;
  await watcher.tick(); // baseline
  assert.equal(calls, 1);
  fail = true;
  await assert.rejects(watcher.pollFeed("u1", "alice"));
  await watcher.tick(); // paused for an hour: no read
  assert.equal(calls, 2);
  fail = false;
  await watcher.pollFeed("u1", "alice"); // the event lacks author_association → the comment is read
  assert.equal(starts.length, 1);
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
