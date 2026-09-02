/**
 * Dependent delegations — fleet as a team (docs/features-2026-09.md §4).
 *
 * handoffPlan resolves the child's repos/carry from an inspection of the parent box; pure and
 * written before src/handoff.ts. The patch extraction is IO-injected and covered at the shape
 * level here (the underlying git-diff pipeline is already proven end to end by the patch feature).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { handoffPlan, buildCarryDiffSh, type ParentInspection } from "../src/handoff.ts";

const parent = (over: Partial<ParentInspection> = {}): ParentInspection => ({
  exists: true,
  runState: "done",
  exitCode: 0,
  repos: [{ name: "api", repo: "acme/api", ref: "main" }],
  ...over,
});

test("a done parent with one repo: child inherits repo+ref and carries a patch by default", () => {
  const r = handoffPlan(parent(), { task: "write tests for the new endpoint" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plan.repos, [{ repo: "acme/api", ref: "main", carry: true, dir: "api" }]);
  assert.equal(r.plan.task, "write tests for the new endpoint");
});

test("carry:none inherits the checkout but ships no patch", () => {
  const r = handoffPlan(parent(), { task: "t", carry: "none" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plan.repos.map((x) => x.carry), [false]);
});

test("an explicit child repo overrides inheritance (still carries the matching parent repo only)", () => {
  const r = handoffPlan(parent({ repos: [{ name: "api", repo: "acme/api", ref: "main" }, { name: "web", repo: "acme/web", ref: "dev" }] }), {
    task: "t",
    repo: "acme/web",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plan.repos, [{ repo: "acme/web", ref: "dev", carry: true, dir: "web" }]);
});

test("a running parent is a refusal that names wait:true; a waiting parent names its question", () => {
  const running = handoffPlan(parent({ runState: "running", exitCode: undefined }), { task: "t" });
  assert.equal(running.ok, false);
  if (!running.ok) assert.match(running.question, /still running.*wait/is);

  const waiting = handoffPlan(parent({ runState: "waiting", exitCode: undefined }), { task: "t" });
  assert.equal(waiting.ok, false);
  if (!waiting.ok) assert.match(waiting.question, /waiting on a question/i);
});

test("a missing parent, and a task-only parent asked to carry, are refusals", () => {
  const gone = handoffPlan(parent({ exists: false }), { task: "t" });
  assert.equal(gone.ok, false);
  if (!gone.ok) assert.match(gone.question, /no sandbox/i);

  const bare = handoffPlan(parent({ repos: [] }), { task: "t", carry: "patch" });
  assert.equal(bare.ok, false);
  if (!bare.ok) assert.match(bare.question, /task-only|no repo/i);
});

test("a task-only parent with carry:none is fine — the child is simply task-only too", () => {
  const r = handoffPlan(parent({ repos: [] }), { task: "t", carry: "none" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plan.repos, []);
});

test("a failed parent still hands off (reviewing a failed attempt is a legit child task) but says so", () => {
  const r = handoffPlan(parent({ exitCode: 1 }), { task: "review what went wrong" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.parentFailed, true);
});

test("buildCarryDiffSh diffs against the delegated ref with -N and --binary, in the repo dir", () => {
  const sh = buildCarryDiffSh("api", "main");
  assert.match(sh, /cd '\/workspace\/api'/);
  assert.match(sh, /git add -A -N/);
  assert.match(sh, /git diff 'origin\/main' --binary/);
  // No ref (default branch): diff against the upstream tracking ref instead.
  const noRef = buildCarryDiffSh("api", undefined);
  assert.match(noRef, /git diff "\$\(git rev-parse --abbrev-ref '@\{upstream\}'\)" --binary/);
});
