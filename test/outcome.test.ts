import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.ts";
import { archiveRun } from "../src/run-archive.ts";
import { recordStartedBy } from "../src/started-by.ts";
import { buildOutcome, openedPrs, outcomeOf, resolveFollowedBy } from "../src/outcome.ts";
import { parseTestCounts } from "../src/test-counts.ts";
import type { RunDigest } from "../src/digest.ts";
import type { TraceEvent } from "../src/trace.ts";

const digest = (over: Partial<RunDigest> = {}): RunDigest => ({
  box: "box-a",
  task: "fix it",
  state: "done",
  exitCode: 0,
  startedAt: 1_000,
  endedAt: 61_000,
  plan: [],
  files: [],
  failedCommands: [],
  blocked: [],
  questions: [],
  headline: "done",
  ...over,
});

test("test counts: node:test, jest, vitest, pytest, go, cargo; unknown is null", () => {
  assert.deepEqual(parseTestCounts("ℹ tests 5\nℹ pass 4\nℹ fail 1\nℹ skipped 0\n"), { runner: "node", passed: 4, failed: 1, skipped: 0 });
  assert.deepEqual(parseTestCounts("Tests:       1 failed, 8 passed, 9 total\nTime: 1.2 s"), { runner: "jest", passed: 8, failed: 1, skipped: 0 });
  assert.deepEqual(parseTestCounts(" Tests  8 passed | 1 skipped (9)\n Duration  1.23s"), { runner: "vitest", passed: 8, failed: 0, skipped: 1 });
  assert.deepEqual(parseTestCounts("==== 3 passed, 2 failed, 1 skipped in 0.52s ===="), { runner: "pytest", passed: 3, failed: 2, skipped: 1 });
  assert.deepEqual(parseTestCounts("--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\nFAIL\tpkg\t0.1s"), { runner: "go", passed: 1, failed: 1, skipped: 0 });
  assert.deepEqual(
    parseTestCounts("test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured\ntest result: FAILED. 2 passed; 1 failed; 0 ignored;"),
    { runner: "cargo", passed: 5, failed: 1, skipped: 1 }
  );
  assert.equal(parseTestCounts("ok  \tgithub.com/x/y\t0.2s"), null);
  assert.equal(parseTestCounts("Build succeeded"), null);
});

test("outcome: PRs only from a create call, diff sums, tests from trace, unpriced cost is null", () => {
  const events: TraceEvent[] = [
    { kind: "tool", name: "Bash", arg: "gh pr view 3", result: "https://github.com/o/r/pull/3" },
    { kind: "tool", name: "Bash", arg: "npm test", result: "ℹ pass 12\nℹ fail 0" },
    { kind: "tool", name: "Bash", arg: "gh pr create --fill", result: "https://github.com/o/r/pull/7\n" },
  ];
  const o = buildOutcome({
    digest: digest({
      files: [
        { path: "a", status: "M", additions: 10, deletions: 2 },
        { path: "b", status: "A", additions: 5, deletions: 0 },
      ],
      questions: [{ question: "which?", answer: "a" }],
      provenance: { model: "some-unpriced-model" },
    }),
    events,
    log: "⟦usage⟧ in=100 out=20 ctx=1\n⟦usage⟧ in=50 out=5 ctx=1\n",
    filesKnown: true,
    env: {},
  });
  assert.deepEqual(o.result.prs, [{ url: "https://github.com/o/r/pull/7", repo: "o/r", number: 7 }]);
  assert.deepEqual(o.result.diff, { files: 2, additions: 15, deletions: 2 });
  assert.deepEqual(o.trust.tests, { runner: "node", passed: 12, failed: 0, skipped: 0, source: "trace" });
  assert.equal(o.trust.questions, 1);
  assert.equal(o.trust.prOnly, false);
  assert.deepEqual(o.cost.tokens, { input: 150, output: 25 });
  assert.equal(o.cost.usd, null);
  assert.equal(o.cost.durationMs, 60_000);
});

test("outcome: priced model gets dollars; verify tests win; trigger header links the issue; PR-only", () => {
  const o = buildOutcome({
    digest: digest({
      verified: { mode: "command", pass: false, detail: "x", tests: { runner: "jest", passed: 3, failed: 1, skipped: 0 } },
      provenance: {
        model: "claude-sonnet-4-5",
        startedBy: { kind: "trigger", triggerId: "t1", name: "triage", source: "github", subject: { kind: "issue", number: 12, repo: "o/r" } },
      },
    }),
    events: [{ kind: "tool", name: "Bash", arg: "npm test", result: "ℹ pass 9\nℹ fail 0" }],
    log: "⟦usage⟧ in=1000000 out=0 ctx=1\n",
    env: {},
  });
  assert.equal(o.trust.tests?.source, "verify");
  assert.equal(o.trust.tests?.failed, 1);
  assert.equal(o.cost.usd, 3);
  assert.equal(o.trust.prOnly, true);
  assert.equal(o.header.label, "github triage: issue #12");
  assert.deepEqual(o.header.link, { href: "https://github.com/o/r/issues/12", external: true });
  // No file list captured and no diff: size is unknown, not zero.
  assert.equal(o.result.diff, null);
});

test("outcome: unknowns stay null; old rows derive an outcome; diff size from archived diff", () => {
  const o = outcomeOf(digest({ startedAt: undefined, endedAt: undefined, exitCode: undefined }), "diff --git a/x b/x\n--- a/x\n+++ b/x\n+new\n-old\n+more\n");
  assert.ok(o);
  assert.equal(o!.cost.durationMs, null);
  assert.equal(o!.cost.tokens, null);
  assert.equal(o!.trust.tests, null);
  assert.equal(o!.trust.exitCode, null);
  assert.deepEqual(o!.result.diff, { files: 1, additions: 2, deletions: 1 });
  assert.equal(outcomeOf(null), null);
});

test("followed by: archived chain child (with id), then live after: handoff, owner-scoped", () => {
  const db = openMemoryDb();
  assert.equal(resolveFollowedBy(db, "u1", "p"), null);
  recordStartedBy(db, "child-live", { kind: "after", parent: "p" });
  assert.deepEqual(resolveFollowedBy(db, "u1", "p"), { box: "child-live", archiveId: null });
  assert.equal(resolveFollowedBy(db, "u1", "p", () => false), null);
  const id = archiveRun(db, {
    box: "child-done",
    owner: "u1",
    digest: digest({ box: "child-done", provenance: { startedBy: { kind: "trigger", triggerId: "c", name: "c", source: "chain", parent: "p" } } }),
  });
  assert.deepEqual(resolveFollowedBy(db, "u1", "p"), { box: "child-done", archiveId: id });
  assert.equal(resolveFollowedBy(db, "u2", "p", () => false), null);
});

test("openedPrs ignores failed create calls", () => {
  assert.deepEqual(openedPrs([{ kind: "tool", name: "Bash", arg: "gh pr create", result: "https://github.com/o/r/pull/1", failed: true }]), []);
});
