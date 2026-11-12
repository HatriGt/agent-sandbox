// Run from web/:  npx --yes tsx --tsconfig tsconfig.json --test src/lib/next-steps.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSteps } from "./next-steps";
import type { RunOutcome } from "./api";

const base = (over: { state?: RunOutcome["state"]; result?: Partial<RunOutcome["result"]>; trust?: Partial<RunOutcome["trust"]> } = {}): RunOutcome => ({
  v: 1,
  state: over.state ?? "done",
  header: { startedBy: null, label: null, link: null },
  result: { prs: [], diff: null, ...over.result },
  trust: { tests: null, exitCode: 0, verified: null, prOnly: false, questions: 0, openQuestions: 0, blocked: 0, ...over.trust },
  cost: { durationMs: null, tokens: null, usd: null, model: null },
});
const ids = (o: RunOutcome | null, code: number | null = 0) => nextSteps(o, code).map((s) => s.id);

test("nothing to offer without an outcome, mid-run, or after a talk-only run", () => {
  assert.deepEqual(ids(null), []);
  assert.deepEqual(ids(base({ state: "running" })), []);
  assert.deepEqual(ids(base()), []);
});
test("untested changes without a pull request: test, pull request, review", () => {
  assert.deepEqual(ids(base({ result: { diff: { files: 3, additions: 9, deletions: 1 } } })), ["test", "pr", "review"]);
});
test("failing tests come first and hold the pull request back", () => {
  const o = base({ result: { diff: { files: 1, additions: 1, deletions: 0 } }, trust: { tests: { runner: "vitest", passed: 4, failed: 2, skipped: 0, source: "verify" } } });
  const s = nextSteps(o, 0);
  assert.deepEqual(s.map((x) => x.id), ["fix-checks", "review"]);
  assert.equal(s[0].label, "Fix the 2 failing tests");
});
test("a pull request that exists is checked, not opened again", () => {
  const o = base({ result: { prs: [{ url: "u", repo: "r", number: 1 }], diff: { files: 1, additions: 1, deletions: 0 } }, trust: { verified: { pass: true, mode: "auto" } } });
  assert.deepEqual(ids(o), ["ci", "review"]);
});
test("a failed run offers another way; a dead sandbox offers nothing", () => {
  assert.deepEqual(ids(base({ state: "failed" }), 1), ["retry"]);
  assert.deepEqual(ids(base({ state: "failed" }), 137), []);
});
