/**
 * "Tries several approaches" (src/attempts.ts): spec validation and defaults, the budget split,
 * scoring (pass → failing tests → diff → cost, ties asked), and the orchestrator end to end with
 * fake IO: launch → all finished → winner PR → losers kept for the override window → override.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.ts";
import {
  attemptBrief,
  branchFor,
  decide,
  defaultAttemptSpecs,
  factsFromDigest,
  getGroup,
  groupOfBox,
  makeAttempts,
  normalizeAttempts,
  OVERRIDE_WINDOW_MS,
  prUrlsOf,
  splitBudget,
  tieChoices,
  tieQuestion,
  type AttemptFacts,
} from "../src/attempts.ts";
import { listCompares, recordRunHarness } from "../src/harness-runs.ts";
import { questionChoices } from "../src/answer-choice.ts";

const f = (index: number, o: Partial<AttemptFacts> = {}): AttemptFacts => ({
  index,
  box: `b${index}`,
  state: "done",
  exitCode: 0,
  verified: null,
  tests: null,
  diffLines: 10,
  files: 1,
  costUsd: null,
  tokens: 1000,
  durationMs: 1000,
  ...o,
});

test("normalizeAttempts: 1/undefined is a plain delegation, 2..3 ok, specs must match", () => {
  assert.deepEqual(normalizeAttempts(undefined, undefined), { ok: true, n: 1, specs: undefined });
  assert.deepEqual(normalizeAttempts(1, undefined), { ok: true, n: 1, specs: undefined });
  assert.equal(normalizeAttempts(4, undefined).ok, false);
  assert.equal(normalizeAttempts(2.5, undefined).ok, false);
  assert.equal(normalizeAttempts(2, [{}]).ok, false);
  assert.equal(normalizeAttempts(2, [{ model: "a b" }, {}]).ok, false);
  const r = normalizeAttempts(2, [{ agent: "claude", model: "opus" }, { agent: "codex", provider: "p1" }]);
  assert.deepEqual(r, { ok: true, n: 2, specs: [{ agent: "claude", model: "opus" }, { agent: "codex", provider: "p1" }] });
});

test("defaultAttemptSpecs: same driver first with different models, then other drivers, then repeats", () => {
  const specs = defaultAttemptSpecs(3, { baseAgent: "claude", catalog: ["sonnet", "opus"], providers: [] });
  assert.deepEqual(specs, [{ agent: "claude" }, { agent: "claude", model: "sonnet" }, { agent: "claude", model: "opus" }]);
  const other = defaultAttemptSpecs(2, { baseAgent: "claude", catalog: [], providers: [{ id: "oa", drivers: ["codex", "opencode"], models: ["gpt-x"] }] });
  assert.deepEqual(other, [{ agent: "claude" }, { agent: "codex", provider: "oa", model: "gpt-x" }]);
  // Nothing else available: the base repeats (two independent samples).
  assert.deepEqual(defaultAttemptSpecs(2, { baseAgent: "omp", catalog: ["sonnet"], providers: [] }), [{ agent: "omp" }, { agent: "omp" }]);
  // The base's explicit model is not offered again from the catalog.
  assert.deepEqual(defaultAttemptSpecs(2, { baseAgent: "claude", baseModel: "opus", catalog: ["opus", "haiku"], providers: [] }), [
    { agent: "claude", model: "opus" },
    { agent: "claude", model: "haiku" },
  ]);
});

test("splitBudget: $ and tokens are a total, minutes are wall-clock", () => {
  assert.equal(splitBudget(undefined, 2), undefined);
  assert.deepEqual(splitBudget({ maxMinutes: 30, maxUsd: 3, maxTokens: 1000 }, 3), { maxMinutes: 30, maxUsd: 1, maxTokens: 333 });
});

test("branch + brief: own branch, no push, no PR", () => {
  const b = branchFor("att_AbC-dEf_123", 2);
  assert.match(b, /^asb\/try-[a-z0-9]{1,8}-2$/);
  const brief = attemptBrief(2, 3, b);
  assert.match(brief, /attempt 2 of 3/);
  assert.match(brief, /Do NOT push and do NOT open a pull request/);
  assert.ok(brief.includes(`git checkout -b ${b}`));
});

test("decide: verified beats unverified beats failing; then fewer failing tests, smaller diff, lower cost", () => {
  let d = decide([f(1, { verified: false }), f(2, { verified: true, diffLines: 500 }), f(3)]);
  assert.equal(d.kind, "winner");
  assert.equal(d.kind === "winner" && d.winner.index, 2);
  d = decide([f(1, { tests: { passed: 5, failed: 3 } }), f(2, { tests: { passed: 5, failed: 1 } })]);
  assert.equal(d.kind === "winner" && d.winner.index, 2);
  d = decide([f(1, { diffLines: 90 }), f(2, { diffLines: 40 })]);
  assert.equal(d.kind === "winner" && d.winner.index, 2);
  assert.match(d.reason, /smaller diff/);
  d = decide([f(1, { tokens: 900 }), f(2, { tokens: 1200 })]);
  assert.equal(d.kind === "winner" && d.winner.index, 1);
  // $ only when every attempt is priced.
  d = decide([f(1, { costUsd: 0.5, tokens: 1 }), f(2, { costUsd: 0.2, tokens: 9 })]);
  assert.equal(d.kind === "winner" && d.winner.index, 2);
  // A failed / unfinished / empty run never wins over a clean one.
  d = decide([f(1, { state: "failed", exitCode: 1, diffLines: 1 }), f(2, { diffLines: 0 }), f(3, { state: "timeout" }), f(4, { diffLines: 800 })]);
  assert.equal(d.kind === "winner" && d.winner.index, 4);
  assert.equal(decide([f(1, { state: "failed", exitCode: 2 }), f(2, { diffLines: 0 })]).kind, "none");
});

test("tie: asked in the answer-choice format, choices map back to attempts", () => {
  const d = decide([f(1), f(2), f(3, { verified: false })]);
  assert.equal(d.kind, "tie");
  if (d.kind !== "tie") return;
  assert.deepEqual(d.tied.map((t) => t.index), [1, 2]);
  const q = tieQuestion(d.tied, { 1: "Claude Code · opus", 2: "Codex CLI" });
  const cs = questionChoices(q);
  assert.equal(cs.length, 2);
  assert.equal(cs[0].label, "Attempt 1");
  assert.match(cs[0].answer, /Claude Code · opus/);
  assert.deepEqual(tieChoices(q).map((c) => c.index), [1, 2]);
  assert.deepEqual(tieChoices(null), []);
});

test("factsFromDigest reads the outcome card; prUrlsOf dedupes", () => {
  const facts = factsFromDigest(1, "b1", {
    state: "done",
    outcome: {
      state: "done",
      result: { diff: { files: 2, additions: 10, deletions: 4 } },
      trust: { tests: { passed: 3, failed: 0 }, exitCode: 0, verified: { pass: true } },
      cost: { durationMs: 5000, tokens: { input: 10, output: 5 }, usd: 0.01 },
    },
  }, "done");
  assert.deepEqual(facts, { index: 1, box: "b1", state: "done", exitCode: 0, verified: true, tests: { passed: 3, failed: 0 }, diffLines: 14, files: 2, costUsd: 0.01, tokens: 15, durationMs: 5000 });
  assert.equal(factsFromDigest(2, "b2", { state: "done", exitCode: 1 }, "done").state, "failed");
  assert.deepEqual(prUrlsOf("x https://github.com/o/r/pull/7\nhttps://github.com/o/r/pull/7 y"), ["https://github.com/o/r/pull/7"]);
});

function harness(opts: { failStart?: number[] } = {}) {
  const db = openMemoryDb();
  let t = 1_000_000;
  let seq = 0;
  const archived = new Map<string, Record<string, unknown>>();
  const alive = new Set<string>();
  const execs: Array<{ box: string; script: string }> = [];
  const torn: string[] = [];
  const started: Array<{ task: string; budget: unknown; spec: unknown }> = [];
  const att = makeAttempts({
    db,
    now: () => t,
    startOne: async (spec, task, budget, link) => {
      started.push({ task, budget, spec });
      if (opts.failStart?.includes(link.index)) return { ok: false, question: "no slot" };
      const box = `box-${++seq}`;
      alive.add(box);
      recordRunHarness(db, { box, owner: "u1", compareId: link.groupId, side: String(link.index) });
      return { ok: true, box };
    },
    archived: (_o, box) => archived.get(box),
    exists: async (box) => alive.has(box),
    exec: async (box, script) => {
      execs.push({ box, script });
      return script.includes("gh pr create") ? `https://github.com/o/r/pull/${execs.length}\n` : "";
    },
    teardown: async (box) => {
      torn.push(box);
      alive.delete(box);
    },
  });
  const finish = (box: string, o: Record<string, unknown>) =>
    archived.set(box, { state: "done", outcome: { state: "done", result: { diff: { files: 1, additions: 5, deletions: 0 } }, trust: { tests: null, exitCode: 0, verified: null }, cost: { usd: null, tokens: { input: 100, output: 0 } }, ...o } });
  return { db, att, archived, alive, execs, torn, started, finish, tick: (ms: number) => (t += ms) };
}

test("orchestrator: launch, score on finish, PR from the winner, losers torn down after the window", async () => {
  const h = harness();
  const r = await h.att.launch({ owner: "u1", task: "Fix the bug", specs: [{ agent: "claude" }, { agent: "codex" }], labels: ["A", "B"], budget: { maxMinutes: 30, maxUsd: 2 } });
  assert.ok(r.ok);
  if (!r.ok) return;
  const g = r.group;
  assert.equal(g.attempts.length, 2);
  assert.deepEqual(h.started.map((s) => s.budget), [{ maxMinutes: 30, maxUsd: 1 }, { maxMinutes: 30, maxUsd: 1 }]);
  assert.ok(h.started.every((s) => /Do NOT push/.test(s.task)));
  // Compares list stays harness-only; the box knows its siblings.
  assert.equal(listCompares(h.db, "u1").length, 0);
  assert.equal(groupOfBox(h.db, "u1", "box-2")?.index, 2);
  assert.equal(groupOfBox(h.db, "u2", "box-2"), undefined);

  h.finish("box-1", {});
  await h.att.sweep();
  assert.equal(getGroup(h.db, "u1", g.id)!.status, "running", "waits for the other attempt");

  h.finish("box-2", { result: { diff: { files: 1, additions: 2, deletions: 0 } } });
  await h.att.sweep();
  let after = getGroup(h.db, "u1", g.id)!;
  assert.equal(after.status, "decided");
  assert.equal(after.winnerBox, "box-2");
  assert.equal(after.decidedBy, "auto");
  assert.deepEqual(after.prUrls, ["https://github.com/o/r/pull/1"]);
  assert.equal(h.execs[0].box, "box-2");
  assert.ok(h.execs[0].script.includes(g.attempts[1].branch));
  assert.deepEqual(h.torn, [], "the loser is kept for the override window");

  // Override: close the old PR, open one from the new pick.
  const o = await h.att.pick("u1", g.id, "box-1");
  assert.ok(o.ok);
  after = getGroup(h.db, "u1", g.id)!;
  assert.equal(after.winnerBox, "box-1");
  assert.equal(after.decidedBy, "user");
  assert.ok(h.execs.some((e) => e.box === "box-2" && e.script.includes("gh pr close")));
  assert.equal(after.prUrls.length, 1);

  h.tick(OVERRIDE_WINDOW_MS + 1);
  await h.att.sweep();
  assert.deepEqual(h.torn, ["box-2"]);
  const gone = await h.att.pick("u1", g.id, "box-2");
  assert.equal(gone.ok, false);
  assert.equal(!gone.ok && gone.status, 410);
  assert.equal((await h.att.pick("u2", g.id, "box-1")).ok, false, "owner-scoped");
});

test("orchestrator: a tie asks, the answer awards; the deadline scores what finished", async () => {
  const h = harness();
  const r = await h.att.launch({ owner: "u1", task: "T", specs: [{}, {}], labels: ["A", "B"] });
  assert.ok(r.ok);
  if (!r.ok) return;
  h.finish("box-1", {});
  h.finish("box-2", {});
  await h.att.sweep();
  let g = getGroup(h.db, "u1", r.group.id)!;
  assert.equal(g.status, "needs-pick");
  assert.equal(tieChoices(g.question).length, 2);
  assert.equal(h.execs.length, 0, "no PR before the user picks");
  const p = await h.att.pick("u1", g.id, "box-2");
  assert.ok(p.ok);
  g = getGroup(h.db, "u1", g.id)!;
  assert.equal(g.winnerBox, "box-2");

  const h2 = harness();
  const r2 = await h2.att.launch({ owner: "u1", task: "T", specs: [{}, {}, {}], labels: ["A", "B", "C"] });
  assert.ok(r2.ok);
  if (!r2.ok) return;
  h2.finish("box-3", {});
  await h2.att.sweep();
  assert.equal(getGroup(h2.db, "u1", r2.group.id)!.status, "running");
  h2.tick(200 * 60_000);
  await h2.att.sweep();
  const g2 = getGroup(h2.db, "u1", r2.group.id)!;
  assert.equal(g2.winnerBox, "box-3");
  assert.deepEqual(h2.torn.sort(), ["box-1", "box-2"], "timed-out attempts are stopped");
});

test("orchestrator: partial launch keeps the rest; none started is a refusal", async () => {
  const h = harness({ failStart: [2] });
  const r = await h.att.launch({ owner: "u1", task: "T", specs: [{}, {}], labels: ["A", "B"] });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.group.attempts[1].error, "no slot");
  const h2 = harness({ failStart: [1, 2] });
  const r2 = await h2.att.launch({ owner: "u1", task: "T", specs: [{}, {}], labels: ["A", "B"] });
  assert.equal(r2.ok, false);
});
