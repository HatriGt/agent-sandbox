import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import { normalizeFollow, normalizeTrigger } from "../src/triggers.ts";
import { createTrigger, deleteTrigger } from "../src/trigger-store.ts";
import { diffReviewComments, makeRepoWatcher, watchMatches, type WatchGet, type WatchHit } from "../src/repo-watch.ts";
import type { AfterFire } from "../src/trigger-dispatch.ts";
import { FOLLOW_MARK, followDecision, followPr, followPreface, getFollowed, listFollows, noteRoundStarted, queueNote, roundGate, settleFollow } from "../src/pr-follow.ts";

const T0 = Date.UTC(2026, 10, 22, 10, 0);
const FOLLOW = { onPush: true, onComment: true, resolve: true, rounds: 2 };

const pushHit = (sha: string, fork = false): WatchHit => ({ event: "pr_pushed", key: `pr:7:push:${sha}`, payload: { pull_request: { number: 7, head: { sha } } }, subject: { kind: "pr", number: 7 }, fork });
const commentHit = (author: string, body: string, bot = false): WatchHit => ({ event: "comment_created", key: `comment:${body.length}`, payload: { comment: { body } }, subject: { kind: "pr", number: 7 }, comment: { author, body, bot } });

test("normalize: follow is stored only when a change is followed; rounds clamp; non-watch kinds ignore it", () => {
  assert.equal(normalizeFollow(undefined), undefined);
  assert.equal(normalizeFollow({ onPush: false, onComment: false, resolve: true }), undefined, "nothing followed = off");
  assert.deepEqual(normalizeFollow({ onPush: true }), { onPush: true, onComment: false, resolve: false, rounds: 5 });
  assert.deepEqual(normalizeFollow({ onComment: true, rounds: 99, resolve: true }), { onPush: false, onComment: true, resolve: true, rounds: 20 });
  assert.deepEqual(normalizeFollow({ onComment: true, rounds: 0 }), { onPush: false, onComment: true, resolve: false, rounds: 1 });
  const w = normalizeTrigger({ name: "Review", kind: "watch", repo: "o/r", taskTemplate: "t", spec: { watch: ["pr_opened"], follow: { onPush: true, onComment: true, resolve: true, rounds: 3 } } });
  assert.ok(w.ok && w.trigger.spec.follow?.rounds === 3);
  const s = normalizeTrigger({ name: "Nightly", kind: "schedule", taskTemplate: "t", spec: { cron: "0 9 * * *", follow: { onPush: true } } });
  assert.ok(s.ok && s.trigger.spec.follow === undefined, "a schedule has no PR to follow");
});

test("decision: merge and close settle; pushes and others' comments are rounds; own, bot and marked comments are not", () => {
  assert.deepEqual(followDecision(FOLLOW, { event: "pr_merged", key: "k", payload: {} }, "me", false), { kind: "settle", state: "merged" });
  assert.deepEqual(followDecision(FOLLOW, { event: "pr_closed", key: "k", payload: {} }, "me", false), { kind: "settle", state: "closed" });
  const push = followDecision(FOLLOW, pushHit("abcdef1234"), "me", false);
  assert.ok(push.kind === "round" && push.note.sha === "abcdef1234" && push.note.text.includes("abcdef1"));
  assert.equal(followDecision({ ...FOLLOW, onPush: false }, pushHit("a2"), "me", false).kind, "ignore");
  assert.equal(followDecision(FOLLOW, pushHit("a2", true), "me", false).kind, "ignore", "a fork's push is ignored unless forks are allowed");
  assert.equal(followDecision(FOLLOW, pushHit("a2", true), "me", true).kind, "round");
  const c = followDecision(FOLLOW, commentHit("alice", "Is the DST case covered?"), "me", false);
  assert.ok(c.kind === "round" && c.note.text.startsWith("alice commented") && c.note.text.includes("> Is the DST case covered?"));
  assert.equal(followDecision(FOLLOW, commentHit("ME", "my own reply"), "me", false).kind, "ignore", "the watching account never re-reviews itself");
  assert.equal(followDecision(FOLLOW, commentHit("dependabot", "bump", true), "me", false).kind, "ignore");
  assert.equal(followDecision(FOLLOW, commentHit("alice", `Addressed in abc\n${FOLLOW_MARK}`), "me", false).kind, "ignore", "a marked comment is the automation's own voice");
  assert.equal(followDecision({ ...FOLLOW, onComment: false }, commentHit("alice", "hi"), "me", false).kind, "ignore");
  assert.equal(followDecision(FOLLOW, { event: "pr_reopened", key: "k", payload: {} }, "me", false).kind, "ignore");
});

test("store: register, queue behind a running round, count rounds, settle; a deleted automation takes its rows", () => {
  const db = openMemoryDb();
  const box = makeSecretBox(crypto.randomBytes(32));
  const v = normalizeTrigger({ name: "Review", kind: "watch", repo: "o/r", taskTemplate: "t", spec: { watch: ["pr_opened"], follow: FOLLOW } });
  assert.ok(v.ok);
  if (!v.ok) return;
  const { row: t } = createTrigger(db, box, "u1", v.trigger);
  const f = followPr(db, { triggerId: t.id, repo: "O/R", number: 7, headSha: "a1", box: "b1" }, T0);
  assert.equal(f.repo, "o/r", "repos compare case-insensitively");
  assert.deepEqual([f.rounds, f.box, f.state, f.pending], [0, "b1", "open", []]);
  assert.deepEqual(roundGate(FOLLOW, f, true), { ok: false, reason: "running" });
  assert.deepEqual(roundGate(FOLLOW, f, false), { ok: true });
  queueNote(db, t.id, "o/r", 7, { event: "pr_pushed", key: "p1", text: "pushed a2", sha: "a2" }, T0 + 1);
  queueNote(db, t.id, "o/r", 7, { event: "pr_pushed", key: "p1", text: "pushed a2 again", sha: "a2" }, T0 + 2);
  assert.deepEqual(getFollowed(db, t.id, "o/r", 7)!.pending.map((n) => n.text), ["pushed a2 again"], "the same change queues once");
  noteRoundStarted(db, t.id, "o/r", 7, "b2", "a2", T0 + 3);
  const r1 = getFollowed(db, t.id, "o/r", 7)!;
  assert.deepEqual([r1.rounds, r1.box, r1.headSha, r1.pending], [1, "b2", "a2", []]);
  noteRoundStarted(db, t.id, "o/r", 7, "b3", undefined, T0 + 4);
  assert.deepEqual(roundGate(FOLLOW, getFollowed(db, t.id, "o/r", 7)!, false), { ok: false, reason: "capped" });
  settleFollow(db, t.id, "o/r", 7, "merged", T0 + 5);
  assert.deepEqual([getFollowed(db, t.id, "o/r", 7)!.state, getFollowed(db, t.id, "o/r", 7)!.box], ["merged", null]);
  followPr(db, { triggerId: t.id, repo: "o/r", number: 8, headSha: "c1", box: "b4" }, T0 + 6);
  assert.deepEqual(listFollows(db, t.id).map((x) => [x.number, x.state]), [[8, "open"], [7, "merged"]], "open first");
  assert.ok(deleteTrigger(db, "u1", t.id));
  assert.equal(listFollows(db, t.id).length, 0);
});

test("preface: names the round, the last head, every change, and resolves threads only when asked", () => {
  const row = { triggerId: "t", repo: "o/r", number: 7, headSha: "a1a1a1a1a1", rounds: 1, box: null, pending: [], state: "open" as const, createdAt: 0, updatedAt: 0 };
  const notes = [{ event: "pr_pushed", key: "p", text: "new commits were pushed (head is now b2b2b2b)", sha: "b2b2b2b2" }, { event: "comment_created", key: "c", text: "alice commented:\n  > why?" }];
  const p = followPreface({ row, notes, follow: FOLLOW, login: "me", prUrl: "https://github.com/o/r/pull/7" });
  assert.ok(p.includes("Follow-up round 2 on this PR (https://github.com/o/r/pull/7)"));
  assert.ok(p.includes("as me at commit a1a1a1a"));
  assert.ok(p.includes("git diff a1a1a1a...HEAD"));
  assert.ok(p.includes("- new commits were pushed (head is now b2b2b2b)") && p.includes("- alice commented:\n  > why?"));
  assert.ok(p.includes("resolveReviewThread") && p.includes("Never merge, never push to the PR branch, never close it."));
  assert.ok(p.includes(FOLLOW_MARK));
  const noResolve = followPreface({ row, notes, follow: { ...FOLLOW, resolve: false }, login: "me", prUrl: "u" });
  assert.ok(!noResolve.includes("resolveReviewThread") && noResolve.includes("Do not resolve threads yourself"));
});

test("review comments: one hit per new inline comment with the PR as subject; own and bot comments never fire a comment automation", () => {
  const rc = (id: number, login: string, body: string, type = "User") => ({ id, body, user: { login, type }, path: "src/a.js", line: 12, html_url: `https://github.com/o/r/pull/7#discussion_r${id}`, pull_request_url: "https://api.github.com/repos/o/r/pulls/7" });
  const base = diffReviewComments(undefined, [rc(1, "x", "old")]);
  assert.deepEqual(base.hits, []);
  const { hits } = diffReviewComments(base.state, [rc(3, "me", "mine"), rc(2, "alice", "hmm"), rc(4, "bot", "beep", "Bot")]);
  assert.deepEqual(hits.map((h) => h.key), ["rcomment:2", "rcomment:3", "rcomment:4"]);
  assert.deepEqual(hits[0].subject, { kind: "pr", number: 7 });
  assert.equal((hits[0].payload.pull_request as { html_url: string }).html_url, "https://github.com/o/r/pull/7");
  const spec = { watch: ["review_comment_created" as const] };
  assert.deepEqual(hits.map((h) => watchMatches(spec, h, "me", "main").ok), [true, false, false]);
});

test("watcher: a following automation re-reviews its PR on a push and others' comments, queues behind a running round, stops at the cap and at the merge", async () => {
  const db = openMemoryDb();
  const box = makeSecretBox(crypto.randomBytes(32));
  const v = normalizeTrigger({ name: "Review", kind: "watch", repo: "o/r", taskTemplate: "Review #{{pr.number}} on {{event}}", spec: { watch: ["pr_opened"], follow: FOLLOW } });
  assert.ok(v.ok);
  if (!v.ok) return;
  const { row: t } = createTrigger(db, box, "u1", v.trigger);

  let now = T0;
  const pr = (sha: string, o: Record<string, unknown> = {}) => ({
    number: 7, state: "open", draft: false, merged_at: null, created_at: new Date(T0 + 20_000).toISOString(), updated_at: new Date(now).toISOString(),
    user: { login: "bob" }, head: { sha, ref: "feat", repo: { full_name: "o/r" } }, base: { ref: "main", repo: { full_name: "o/r" } }, ...o,
  });
  const data: Record<string, unknown[]> = { pulls: [], comments: [], review_comments: [] };
  const versions: Record<string, number> = { pulls: 0, comments: 0, review_comments: 0 };
  const set = (src: string, items: unknown[]) => { data[src] = items; versions[src]++; };
  const reads: string[] = [];
  const get: WatchGet = async (_o, _r, path, etag) => {
    if (path === "/repos/o/r") return { notModified: false, data: { full_name: "o/r", default_branch: "main" }, login: "me" };
    const src = path.includes("/pulls/comments") ? "review_comments" : path.includes("/issues/comments") ? "comments" : path.includes("/pulls?") ? "pulls" : "other";
    reads.push(src);
    const tag = `"${src}:${versions[src] ?? 0}"`;
    return etag === tag ? { notModified: true } : { notModified: false, data: data[src] ?? [], etag: tag, login: "me" };
  };
  const fired: Array<{ event?: string; round?: number; preface?: string; task?: string }> = [];
  let boxes = 0;
  const hooks: AfterFire[] = [];
  const w = makeRepoWatcher({
    db, get, redact: (s) => s, now: () => now, log: () => {},
    dispatcher: {
      fire: async (t, ctx) => {
        fired.push({ event: ctx.event, round: ctx.follow?.round, preface: ctx.follow?.preface });
        const r = { at: now, outcome: "started" as const, box: `b${++boxes}` };
        for (const h of hooks) h(t, ctx, r);
        return r;
      },
      admits: () => ({ ok: true as const }),
      onFire: (h) => hooks.push(h),
    },
  });
  const tick = async () => { now += 15_000; await w.tick(); };

  await tick(); // baseline: only pulls is read (nothing followed yet)
  assert.deepEqual([...new Set(reads)], ["pulls"]);
  set("pulls", [pr("a1")]);
  await tick();
  assert.deepEqual(fired.map((f) => [f.event, f.round]), [["pr_opened", undefined]]);
  assert.deepEqual(getFollowed(db, t.id, "o/r", 7)?.box, "b1", "the first review registers the PR as followed");

  await tick(); // comment sources join and record their baselines
  assert.ok(reads.includes("comments") && reads.includes("review_comments"));

  // A push: not an event the automation fires on, but the PR is followed → round 1 with the delta.
  set("pulls", [pr("a2")]);
  await tick();
  assert.equal(fired.length, 2);
  assert.deepEqual([fired[1].event, fired[1].round], ["pr_pushed", 1]);
  assert.ok(fired[1].preface!.includes("Follow-up round 1") && fired[1].preface!.includes("head is now a2") && fired[1].preface!.includes("git diff a1...HEAD"));
  assert.deepEqual([getFollowed(db, t.id, "o/r", 7)!.rounds, getFollowed(db, t.id, "o/r", 7)!.headSha, getFollowed(db, t.id, "o/r", 7)!.box], [1, "a2", "b2"]);

  // Round 1 is still running (its fire row is open): a reviewer's inline comment queues; the reviewer's own does not.
  db.prepare(`INSERT INTO trigger_fires (trigger_id, at, box) VALUES (?, ?, ?)`).run(t.id, now, "b2");
  const rc = (id: number, login: string, body: string) => ({ id, body, user: { login, type: "User" }, path: "src/a.js", line: 3, html_url: `https://github.com/o/r/pull/7#discussion_r${id}`, pull_request_url: "https://api.github.com/repos/o/r/pulls/7" });
  set("review_comments", [rc(11, "me", "Consider a guard here"), rc(12, "alice", "The guard is there, see line 9")]);
  await tick();
  assert.equal(fired.length, 2, "nothing fires while a round runs");
  assert.deepEqual(getFollowed(db, t.id, "o/r", 7)!.pending.map((n) => n.event), ["review_comment_created"]);
  await tick();
  assert.equal(fired.length, 2, "still queued");

  // The round finishes: the queued change starts round 2 on the next tick, with alice's words.
  db.prepare(`UPDATE trigger_fires SET finished_at = ? WHERE box = ?`).run(now, "b2");
  await tick();
  assert.equal(fired.length, 3);
  assert.deepEqual([fired[2].event, fired[2].round], ["review_comment_created", 2]);
  assert.ok(fired[2].preface!.includes("alice commented on src/a.js:3") && fired[2].preface!.includes("> The guard is there, see line 9"));
  assert.ok(!fired[2].preface!.includes("Consider a guard here"), "the reviewer's own comment is not a reason");
  assert.deepEqual([getFollowed(db, t.id, "o/r", 7)!.rounds, getFollowed(db, t.id, "o/r", 7)!.pending], [2, []]);

  // At the cap, a further push is noted nowhere; the merge ends the follow.
  set("pulls", [pr("a3")]);
  await tick();
  assert.equal(fired.length, 3, "capped at 2 rounds");
  set("pulls", [pr("a3", { state: "closed", merged_at: new Date(now).toISOString() })]);
  await tick();
  assert.equal(fired.length, 3);
  assert.equal(getFollowed(db, t.id, "o/r", 7)!.state, "merged");
  // A merged PR's later comment is no round, and no plain fire either (the automation does not watch comments).
  set("comments", [{ id: 90, body: "thanks!", user: { login: "alice", type: "User" }, html_url: "https://github.com/o/r/pull/7#issuecomment-90", issue_url: "https://api.github.com/repos/o/r/issues/7" }]);
  await tick();
  await tick();
  assert.equal(fired.length, 3);
});

test("watcher: a round the storm cap holds waits with its notes; pushes meanwhile join it; it starts when the window frees", async () => {
  const db = openMemoryDb();
  const box = makeSecretBox(crypto.randomBytes(32));
  const v = normalizeTrigger({ name: "Review", kind: "watch", repo: "o/r", taskTemplate: "Review #{{pr.number}}", spec: { watch: ["pr_opened"], follow: { ...FOLLOW, rounds: 5 } } });
  assert.ok(v.ok);
  if (!v.ok) return;
  const { row: t } = createTrigger(db, box, "u1", v.trigger);
  let now = T0;
  const pr = (sha: string) => ({
    number: 7, state: "open", draft: false, merged_at: null, created_at: new Date(T0 + 20_000).toISOString(), updated_at: new Date(now).toISOString(),
    user: { login: "bob" }, head: { sha, ref: "feat", repo: { full_name: "o/r" } }, base: { ref: "main", repo: { full_name: "o/r" } },
  });
  let pulls: unknown[] = [];
  let version = 0;
  const get: WatchGet = async (_o, _r, path, etag) => {
    if (path === "/repos/o/r") return { notModified: false, data: { full_name: "o/r", default_branch: "main" }, login: "me" };
    if (!path.includes("/pulls?")) return etag === '"c"' ? { notModified: true } : { notModified: false, data: [], etag: '"c"', login: "me" };
    const tag = `"p${version}"`;
    return etag === tag ? { notModified: true } : { notModified: false, data: pulls, etag: tag, login: "me" };
  };
  const fired: Array<{ event?: string; round?: number; preface?: string }> = [];
  let capped = false;
  let boxes = 0;
  const hooks: AfterFire[] = [];
  const w = makeRepoWatcher({
    db, get, redact: (s) => s, now: () => now, log: () => {},
    dispatcher: {
      fire: async (tr, ctx) => {
        fired.push({ event: ctx.event, round: ctx.follow?.round, preface: ctx.follow?.preface });
        const r = { at: now, outcome: "started" as const, box: `b${++boxes}` };
        for (const h of hooks) h(tr, ctx, r);
        return r;
      },
      admits: () => (capped ? { ok: false as const, reason: "storm cap: 30 fires in the last hour" } : { ok: true as const }),
      onFire: (h) => hooks.push(h),
    },
  });
  const tick = async () => { now += 15_000; await w.tick(); };

  await tick();
  pulls = [pr("a1")];
  version++;
  await tick();
  assert.equal(fired.length, 1);
  assert.equal(getFollowed(db, t.id, "o/r", 7)?.box, "b1", "registered through the after-fire hook");
  db.prepare(`UPDATE trigger_fires SET finished_at = ? WHERE box = ?`).run(now, "b1");

  // The cap is on: a push is noted, not fired; a second push joins the note; nothing starts.
  capped = true;
  pulls = [pr("a2")];
  version++;
  await tick();
  pulls = [pr("a3")];
  version++;
  await tick();
  await tick();
  assert.equal(fired.length, 1, "no round while the cap holds");
  const held = getFollowed(db, t.id, "o/r", 7)!;
  assert.deepEqual([held.rounds, held.box, held.pending.map((n) => n.sha)], [0, null, ["a2", "a3"]]);

  // The window frees: one round, with both pushes, starts on the next poll.
  capped = false;
  await tick();
  assert.equal(fired.length, 2);
  assert.deepEqual([fired[1].event, fired[1].round], ["pr_pushed", 1]);
  assert.ok(fired[1].preface!.includes("head is now a3"), "the round reviews the latest head");
  assert.deepEqual([getFollowed(db, t.id, "o/r", 7)!.rounds, getFollowed(db, t.id, "o/r", 7)!.pending], [1, []]);
});
