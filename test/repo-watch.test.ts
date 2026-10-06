import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import { normalizeTrigger } from "../src/triggers.ts";
import { createTrigger } from "../src/trigger-store.ts";
import { diffComments, diffPulls, diffRuns, makeRepoWatcher, watchMatches, type WatchGet } from "../src/repo-watch.ts";

const T0 = Date.UTC(2026, 9, 6, 10, 0);
const pr = (n: number, o: Record<string, unknown> = {}) => ({
  number: n,
  state: "open",
  draft: false,
  merged_at: null,
  created_at: new Date(T0 + 1000).toISOString(),
  updated_at: new Date(T0 + 1000).toISOString(),
  head: { sha: "a1", ref: "feat", repo: { full_name: "o/r" } },
  base: { ref: "main", repo: { full_name: "o/r" } },
  ...o,
});

test("watch pulls: baseline replays nothing; then opened, pushed, ready, merged fire once each", () => {
  const old = pr(1, { created_at: new Date(T0 - 86_400_000).toISOString() });
  const base = diffPulls(undefined, [old], T0);
  assert.deepEqual(base.hits, []);

  // An old PR that only now scrolls into the list is not "opened".
  const scrolled = diffPulls(base.state, [old, pr(9, { created_at: new Date(T0 - 5000).toISOString() })], T0 + 2000);
  assert.deepEqual(scrolled.hits, []);

  const opened = diffPulls(base.state, [pr(2), pr(3, { draft: true })], T0 + 2000);
  assert.deepEqual(opened.hits.map((h) => h.event), ["pr_opened"]);
  assert.equal(opened.hits[0].subject?.number, 2);

  const next = diffPulls(opened.state, [pr(2, { head: { sha: "b2", ref: "feat", repo: { full_name: "o/r" } } }), pr(3, { draft: false })], T0 + 3000);
  assert.deepEqual(next.hits.map((h) => `${h.event}#${h.subject?.number}`).sort(), ["pr_pushed#2", "pr_ready#3"]);

  const merged = diffPulls(next.state, [pr(2, { state: "closed", merged_at: "x" }), pr(3, { state: "closed", closed_at: "y" })], T0 + 4000);
  assert.deepEqual(merged.hits.map((h) => `${h.event}#${h.subject?.number}`).sort(), ["pr_closed#3", "pr_merged#2"]);
  assert.deepEqual(diffPulls(merged.state, [pr(2, { state: "closed", merged_at: "x" })], T0 + 5000).hits, []);
});

test("watch runs: only completed runs after the baseline, failure vs success, once per attempt", () => {
  const run = (id: number, conclusion: string, attempt = 1) => ({ id, run_attempt: attempt, status: "completed", conclusion, updated_at: new Date(T0 + 1000).toISOString(), head_branch: "main" });
  const base = diffRuns(undefined, [run(1, "failure")], T0);
  assert.deepEqual(base.hits, []);
  const r = diffRuns(base.state, [run(1, "failure"), run(2, "failure"), run(3, "success"), run(4, "cancelled"), run(1, "success", 2)], T0 + 2000);
  assert.deepEqual(r.hits.map((h) => `${h.event}:${h.key}`), ["run_failed:run:201", "run_succeeded:run:301", "run_succeeded:run:102"]);
});

test("watch comments: the watching account's own comments and receipts never fire a plain comment automation", () => {
  const c = (id: number, login: string, body: string) => ({ id, body, user: { login, type: "User" }, html_url: `https://github.com/o/r/pull/5#issuecomment-${id}`, issue_url: "https://api.github.com/repos/o/r/issues/5" });
  const base = diffComments(undefined, [c(10, "x", "old")]);
  const { hits } = diffComments(base.state, [c(12, "me", "my review"), c(11, "alice", "please look"), c(13, "alice", "**Agent Sandbox receipt** — …")]);
  assert.deepEqual(hits.map((h) => h.key), ["comment:11", "comment:12", "comment:13"]);
  assert.deepEqual(hits[0].subject, { kind: "pr", number: 5 });
  const spec = { watch: ["comment_created" as const] };
  assert.deepEqual(hits.map((h) => watchMatches(spec, h, "me", "main").ok), [true, false, false]);
  // With a command prefix, the owner's own command does fire.
  const cmd = diffComments(base.state, [c(14, "me", "/agent fix it")]).hits[0];
  assert.equal(watchMatches({ ...spec, command: "/agent" }, cmd, "me", "main").ok, true);
});

test("watch validation: repo and at least one known event are required", () => {
  const b = { name: "w", kind: "watch", taskTemplate: "t" };
  assert.equal(normalizeTrigger({ ...b, spec: { watch: ["pr_opened"] } }).ok, false);
  assert.equal(normalizeTrigger({ ...b, repo: "o/r", spec: { watch: [] } }).ok, false);
  assert.equal(normalizeTrigger({ ...b, repo: "o/r", spec: { watch: ["pr_opened", "nope"] } }).ok, false);
  const ok = normalizeTrigger({ ...b, repo: "o/r", spec: { watch: ["push", "pr_opened", "push"], branch: "release" } });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.trigger.spec, { watch: ["pr_opened", "push"], branch: "release" });
});

test("watcher tick: conditional reads, one fire per change across ticks, 304 fires nothing", async () => {
  const db = openMemoryDb();
  const box = makeSecretBox(crypto.randomBytes(32));
  const v = normalizeTrigger({ name: "review", kind: "watch", repo: "o/r", taskTemplate: "Review #{{pr.number}} on {{event}}", spec: { watch: ["pr_opened"] } });
  assert.ok(v.ok);
  if (!v.ok) return;
  createTrigger(db, box, "u1", v.trigger);

  let now = T0;
  let pulls: unknown[] = [];
  const etags: Array<string | undefined> = [];
  const get: WatchGet = async (_o, _r, path, etag) => {
    if (path === "/repos/o/r") return { notModified: false, data: { full_name: "o/r", default_branch: "main" }, login: "me" };
    etags.push(etag);
    const tag = `"${pulls.length}"`;
    return etag === tag ? { notModified: true } : { notModified: false, data: pulls, etag: tag, login: "me" };
  };
  const fired: Array<{ event?: string; n?: number; payload: unknown }> = [];
  const w = makeRepoWatcher({
    db,
    get,
    redact: (s) => s,
    now: () => now,
    log: () => {},
    dispatcher: {
      fire: async (_t, ctx) => {
        fired.push({ event: ctx.event, n: ctx.match?.subject?.number, payload: ctx.payload });
        return { at: now, outcome: "started" as const, box: "b" };
      },
    },
  });

  await w.tick(); // baseline
  now += 15_000;
  await w.tick(); // 304
  pulls = [pr(7, { created_at: new Date(now).toISOString() })];
  now += 15_000;
  await w.tick();
  now += 15_000;
  await w.tick(); // 304 again
  assert.deepEqual(fired.map((f) => `${f.event}#${f.n}`), ["pr_opened#7"]);
  const p0 = fired[0].payload;
  assert.ok(p0 && typeof p0 === "object" && "asb_event" in p0 && p0.asb_event === "pr_opened");
  assert.deepEqual(etags, [undefined, '"0"', '"0"', '"1"']);
});
