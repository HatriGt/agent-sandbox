/**
 * Workflows — a task as a short script of agent turns and command checks (src/workflow.ts), and the
 * engine that drives one from the finish edge (src/workflow-engine.ts). The YAML subset, the
 * normaliser, the step rendering and the state machine are pure; the engine is IO-injected.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  checkFeedback,
  firstTask,
  normalizeWorkflow,
  parseWorkflowYaml,
  runLine,
  startRun,
  stepMessage,
  viewOf,
  workflowFromYaml,
  workflowToYaml,
  WORKFLOW_LIMITS,
  type WorkflowDef,
} from "../src/workflow.ts";
import { makeWorkflowEngine } from "../src/workflow-engine.ts";
import type { VerifyResult } from "../src/verify.ts";

const YAML = `# ship a feature
name: ship-feature
description: implement, test, review
steps:
  - title: Implement
    prompt: |
      Implement {{task}}.
      Write tests alongside the code.
  - command: npm test
    retry: 2
    feedback: Do not weaken or delete tests to make them pass.
  - prompt: Review the diff adversarially and fix what you would reject.
    skill: code-review
  - command: npm run lint
`;

/* ── yaml subset ─────────────────────────────────────────────────────────── */

test("yaml: the workflow shape parses — comments, block scalars, ints, a list of maps", () => {
  const d = parseWorkflowYaml(YAML);
  assert.equal(d.name, "ship-feature");
  assert.equal(d.description, "implement, test, review");
  const steps = d.steps as Array<Record<string, unknown>>;
  assert.equal(steps.length, 4);
  assert.deepEqual(steps[0], { title: "Implement", prompt: "Implement {{task}}.\nWrite tests alongside the code.\n" });
  assert.deepEqual(steps[1], { command: "npm test", retry: 2, feedback: "Do not weaken or delete tests to make them pass." });
  assert.deepEqual(steps[2], { prompt: "Review the diff adversarially and fix what you would reject.", skill: "code-review" });
  assert.deepEqual(steps[3], { command: "npm run lint" });
});

test("yaml: quoted scalars, booleans, folded blocks, a leading ---", () => {
  const d = parseWorkflowYaml(`---\nname: "a: b"\nsteps:\n  - prompt: >\n      one\n      two\n    skill: 'x-y'\n  - command: echo hi\n    retry: true\n`);
  assert.equal(d.name, "a: b");
  const s = d.steps as Array<Record<string, unknown>>;
  assert.equal(s[0].prompt, "one two\n");
  assert.equal(s[0].skill, "x-y");
  assert.equal(s[1].retry, true);
});

test("yaml: what it refuses, with a line number", () => {
  for (const [text, re] of [
    ["name: x\nsteps:\n  - [a, b]\n", /line 3/],
    ["name: x\nsteps:\n  - prompt: a\n   bad: b\n", /line 4/],
    ["name: x\nname: y\n", /duplicate key/],
    ["name: &a x\n", /unsupported yaml/],
    ["name: x\n---\nname: y\n", /one document/],
    ["name: x\nsteps:\n  - prompt: a\n  - - nested\n", /mapping/],
    ["x".repeat(WORKFLOW_LIMITS.maxYamlBytes + 1), /too large/],
  ] as const) {
    assert.throws(() => parseWorkflowYaml(text), re, text.slice(0, 30));
  }
});

/* ── normalise ───────────────────────────────────────────────────────────── */

test("normalise: step kind from shape; both or neither is refused; retry bounded", () => {
  const w = normalizeWorkflow(parseWorkflowYaml(YAML), undefined, 1000);
  assert.match(w.id, /^wf_/);
  assert.equal(w.steps.length, 4);
  assert.equal(w.steps[0].kind, "agent");
  assert.equal(w.steps[1].kind, "check");
  assert.deepEqual(w.steps[1], { kind: "check", command: "npm test", retry: 2, feedback: "Do not weaken or delete tests to make them pass." });
  assert.deepEqual(w.steps[3], { kind: "check", command: "npm run lint", retry: 0 });
  assert.equal(w.createdAt, 1000);
  for (const [steps, re] of [
    [[{ prompt: "a", command: "b" }], /EITHER/],
    [[{ title: "x" }], /needs a prompt/],
    [[{ command: "npm test" }], /at least one prompt/],
    [[{ command: "a\nb", retry: 1 }, { prompt: "p" }], /one line/],
    [[{ command: "a", retry: 9 }, { prompt: "p" }], /0\.\.3/],
    [[{ command: "a", retry: "2" }, { prompt: "p" }], /whole number/],
    [[{ prompt: "p", retry: 1 }], /belong to a command/],
    [[{ command: "a", skill: "s" }, { prompt: "p" }], /no skill/],
    [[{ prompt: "p", skill: "bad name!" }], /plain name/],
    [[], /at least one step/],
    [Array.from({ length: 13 }, () => ({ prompt: "p" })), /At most 12/],
  ] as const) {
    assert.throws(() => normalizeWorkflow({ name: "n", steps }), re, JSON.stringify(steps).slice(0, 60));
  }
  assert.throws(() => normalizeWorkflow({ steps: [{ prompt: "p" }] }), /needs a name/);
});

test("normalise: an update keeps id, createdAt and origin", () => {
  const a = normalizeWorkflow({ name: "a", steps: [{ prompt: "p" }], origin: { kind: "repo", repo: "o/r", path: ".agent-sandbox/workflows/a.yaml" } }, undefined, 1);
  const b = normalizeWorkflow({ name: "b", steps: [{ prompt: "q" }], id: "wf_other" }, a, 2);
  assert.equal(b.id, a.id);
  assert.equal(b.createdAt, 1);
  assert.equal(b.updatedAt, 2);
  assert.deepEqual(b.origin, a.origin);
  assert.equal(b.name, "b");
});

test("yaml round-trip: toYaml(fromYaml(x)) parses to the same steps", () => {
  const w = workflowFromYaml(YAML, undefined, undefined, 5);
  const again = workflowFromYaml(workflowToYaml(w), undefined, undefined, 5);
  assert.deepEqual(again.steps, w.steps);
  assert.equal(again.name, w.name);
  assert.equal(again.description, w.description);
  const filename = workflowFromYaml("steps:\n  - prompt: hi\n", "from-file");
  assert.equal(filename.name, "from-file");
});

/* ── rendering ───────────────────────────────────────────────────────────── */

function def(steps: WorkflowDef["steps"], name = "wf"): WorkflowDef {
  return { id: "wf_test123456", name, steps, createdAt: 0, updatedAt: 0 };
}

test("first task: step 1 renders {{task}} and becomes the delegate task; a leading check keeps the typed task", () => {
  const w = normalizeWorkflow(parseWorkflowYaml(YAML));
  const f = firstTask(w, "  dark mode  ");
  assert.equal(f.cursor, 1);
  assert.match(f.task, /^Workflow step 1 of 4 — Implement\.\n\nImplement dark mode\.\nWrite tests alongside the code\./);
  const g = firstTask(def([{ kind: "check", command: "npm ci", retry: 0 }, { kind: "agent", prompt: "p" }]), "fix it");
  assert.deepEqual(g, { task: "fix it", cursor: 0 });
  const one = firstTask(def([{ kind: "agent", prompt: "Do {{task}} carefully" }]), "x");
  assert.equal(one.task, "Do x carefully");
  const sk = firstTask(def([{ kind: "agent", prompt: "p", skill: "tdd" }]), "x");
  assert.equal(sk.task, "Use the /tdd skill for this step.\n\np");
});

test("step message and check feedback are plain prose with the step position", () => {
  const m = stepMessage({ kind: "agent", prompt: "Review {{task}}", skill: "code-review", title: "Review" }, 3, 4, "dark mode");
  assert.equal(m, "Workflow step 3 of 4 — Review.\nUse the /code-review skill for this step.\n\nReview dark mode");
  const r: VerifyResult = { mode: "command", pass: false, command: "npm test", code: 1, detail: "exit 1", output: "FAIL a.test.ts\n  expected 2 got 3" };
  const f = checkFeedback({ kind: "check", command: "npm test", retry: 2, feedback: "Never delete tests." }, r, 2, 4, 1);
  assert.match(f, /^Workflow step 2 of 4 — check failed \(attempt 1 of 3\): `npm test` exited 1\./);
  assert.match(f, /expected 2 got 3\n\nNever delete tests\.\n\nFix it, re-run `npm test` yourself/);
});

/* ── state machine ───────────────────────────────────────────────────────── */

const pass: VerifyResult = { mode: "command", pass: true, detail: "exit 0", code: 0 };
const fail: VerifyResult = { mode: "command", pass: false, detail: "exit 1", code: 1, output: "boom" };

test("advance: implement → check passes → review → check passes → done", () => {
  const w = normalizeWorkflow(parseWorkflowYaml(YAML));
  let run = startRun(w, "dark mode", 1);
  assert.equal(runLine(run), "ship-feature · step 1/4 · Implement");

  let s = advance(run, { kind: "finish", runState: "done", exitCode: 0 });
  assert.deepEqual(s.action, { type: "check", command: "npm test" });
  assert.equal(s.run.history.length, 1);
  assert.equal(runLine(s.run), "ship-feature · step 2/4 · npm test");

  s = advance(s.run, { kind: "checked", result: pass });
  assert.equal(s.action.type, "resume");
  assert.match((s.action as { message: string }).message, /^Workflow step 3 of 4\.\nUse the \/code-review skill/);
  assert.equal(runLine(s.run), "ship-feature · step 3/4 · /code-review");
  assert.equal(s.run.cursor, 3);

  s = advance(s.run, { kind: "finish", runState: "done", exitCode: 0 });
  assert.deepEqual(s.action, { type: "check", command: "npm run lint" });
  s = advance(s.run, { kind: "checked", result: pass });
  assert.deepEqual(s.action, { type: "end", state: "done" });
  assert.equal(s.run.state, "done");
  assert.deepEqual(
    s.run.history.map((h) => [h.n, h.kind, h.state, h.attempts]),
    [
      [1, "agent", "done", undefined],
      [2, "check", "done", 1],
      [3, "agent", "done", undefined],
      [4, "check", "done", 1],
    ]
  );
  assert.equal(runLine(s.run), "ship-feature · 4/4 steps done");
  assert.equal(viewOf(s.run).step, 4);
  // Ended runs are inert.
  assert.deepEqual(advance(s.run, { kind: "finish", runState: "done" }).action, { type: "end", state: "done" });
});

test("advance: a failed check is handed back `retry` times, then the workflow fails honestly", () => {
  const w = normalizeWorkflow(parseWorkflowYaml(YAML));
  let s = advance(startRun(w, "t", 1), { kind: "finish", runState: "done", exitCode: 0 });
  s = advance(s.run, { kind: "checked", result: fail });
  assert.equal(s.action.type, "resume");
  assert.match((s.action as { message: string }).message, /attempt 1 of 3.*\n\nboom\n\nDo not weaken/s);
  assert.equal(s.run.retriesUsed, 1);
  assert.equal(s.run.cursor, 1, "the cursor stays on the check so the next finish re-runs it");
  // The retry turn finishes: the check runs again (no new agent history row for a retry turn).
  s = advance(s.run, { kind: "finish", runState: "done", exitCode: 0 });
  assert.deepEqual(s.action, { type: "check", command: "npm test" });
  assert.equal(s.run.history.length, 1);
  s = advance(s.run, { kind: "checked", result: fail });
  assert.match((s.action as { message: string }).message, /attempt 2 of 3/);
  s = advance(s.run, { kind: "finish", runState: "done", exitCode: 0 });
  s = advance(s.run, { kind: "checked", result: fail });
  assert.deepEqual(s.action, { type: "end", state: "failed" });
  assert.equal(s.run.state, "failed");
  assert.match(s.run.failure!, /`npm test` failed 3×/);
  assert.deepEqual(s.run.history.at(-1), { n: 2, kind: "check", title: "npm test", state: "failed", attempts: 3, detail: "exit 1" });
  assert.match(runLine(s.run), /^ship-feature · failed: check/);
  // A check passing on its second attempt records attempts=2.
  let t = advance(startRun(w, "t", 1), { kind: "finish", runState: "done", exitCode: 0 });
  t = advance(t.run, { kind: "checked", result: fail });
  t = advance(t.run, { kind: "finish", runState: "done", exitCode: 0 });
  t = advance(t.run, { kind: "checked", result: pass });
  assert.equal(t.run.history.at(-1)?.attempts, 2);
});

test("advance: a question holds; a failed turn ends the workflow; a leading check runs before any turn", () => {
  const w = normalizeWorkflow(parseWorkflowYaml(YAML));
  const run = startRun(w, "t", 1);
  const held = advance(run, { kind: "finish", runState: "waiting" });
  assert.deepEqual(held.action, { type: "hold" });
  assert.equal(held.run, run);
  const dead = advance(run, { kind: "finish", runState: "done", exitCode: 254 });
  assert.deepEqual(dead.action, { type: "end", state: "failed" });
  assert.match(dead.run.failure!, /step 1 ended with exit 254/);
  const lead = startRun(def([{ kind: "check", command: "npm ci", retry: 0 }, { kind: "agent", prompt: "p" }]), "t", 0);
  const a = advance(lead, { kind: "finish", runState: "done", exitCode: 0 });
  assert.deepEqual(a.action, { type: "check", command: "npm ci" });
  assert.equal(a.run.history.length, 0);
  const b = advance(a.run, { kind: "checked", result: pass });
  assert.equal(b.action.type, "resume");
  assert.equal(b.run.cursor, 2);
});

/* ── engine ──────────────────────────────────────────────────────────────── */

test("engine: chains checks in-process, resumes agent steps, consumes intermediate finishes only", async () => {
  const sent: string[] = [];
  const checked: string[] = [];
  const results: Record<string, VerifyResult[]> = { "npm test": [fail, pass], "npm run lint": [pass] };
  const eng = makeWorkflowEngine({
    resume: async (_b, m) => void sent.push(m),
    check: async (_b, c) => {
      checked.push(c);
      return results[c].shift()!;
    },
  });
  const w = normalizeWorkflow(parseWorkflowYaml(YAML));
  assert.equal(await eng.onFinish("other", "done", 0), false, "not a workflow box");
  eng.arm("box", w, "dark mode", 1);
  assert.equal(eng.viewOf("box")?.line, "ship-feature · step 1/4 · Implement");

  assert.equal(await eng.onFinish("box", "waiting"), false, "a question is the operator's finish to hear about");
  assert.equal(await eng.onFinish("box", "done", 0), true, "check failed → retry turn sent");
  assert.deepEqual(checked, ["npm test"]);
  assert.match(sent[0], /check failed \(attempt 1 of 3\)/);
  assert.equal(await eng.onFinish("box", "done", 0), true, "check passed → review step sent");
  assert.deepEqual(checked, ["npm test", "npm test"]);
  assert.match(sent[1], /Workflow step 3 of 4/);
  assert.equal(await eng.onFinish("box", "done", 0), false, "lint passes in-process → the workflow ends on THIS finish");
  assert.deepEqual(checked, ["npm test", "npm test", "npm run lint"]);
  assert.equal(eng.viewOf("box")?.state, "done");
  assert.equal(eng.viewOf("box")?.history.length, 4);
  assert.equal(await eng.onFinish("box", "done", 0), false, "an ended run never consumes a later finish");
  eng.forget("box");
  assert.equal(eng.viewOf("box"), undefined);
});

test("engine: an undeliverable step fails the workflow instead of leaving it armed; a check that cannot run counts as a failure", async () => {
  const eng = makeWorkflowEngine({
    resume: async () => {
      throw new Error("box is gone");
    },
    check: async () => {
      throw new Error("ssh refused");
    },
    log: () => {},
  });
  eng.arm("a", def([{ kind: "agent", prompt: "p" }, { kind: "agent", prompt: "q" }]), "t", 1);
  assert.equal(await eng.onFinish("a", "done", 0), false);
  assert.equal(eng.viewOf("a")?.state, "failed");
  assert.equal(eng.viewOf("a")?.failure, "could not send the next step");
  eng.arm("b", def([{ kind: "agent", prompt: "p" }, { kind: "check", command: "npm test", retry: 0 }]), "t", 1);
  assert.equal(await eng.onFinish("b", "done", 0), false);
  assert.equal(eng.viewOf("b")?.state, "failed");
  assert.match(eng.viewOf("b")?.failure ?? "", /could not run: ssh refused/);
});

test("triggers carry a workflow id through validation and the store", async () => {
  const crypto = await import("node:crypto");
  const { normalizeTrigger } = await import("../src/triggers.ts");
  const { openMemoryDb } = await import("../src/db.ts");
  const { makeSecretBox } = await import("../src/secretbox.ts");
  const { createTrigger, getTrigger, updateTrigger } = await import("../src/trigger-store.ts");
  const base = { name: "Nightly", kind: "schedule", taskTemplate: "tidy up", spec: { cron: "0 2 * * *" } };
  const ok = normalizeTrigger({ ...base, workflowId: "wf_abcdef123" });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.ok && ok.trigger.workflowId, "wf_abcdef123");
  assert.equal(normalizeTrigger({ ...base, workflowId: "nope" }).ok, false);
  const none = normalizeTrigger(base);
  assert.ok(none.ok && none.trigger.workflowId === undefined);

  const db = openMemoryDb();
  const box = makeSecretBox(crypto.randomBytes(32));
  const { row } = createTrigger(db, box, "u1", ok.ok ? ok.trigger : (null as never));
  assert.equal(getTrigger(db, "u1", row.id)?.workflowId, "wf_abcdef123");
  updateTrigger(db, "u1", row.id, none.ok ? none.trigger : (null as never));
  assert.equal(getTrigger(db, "u1", row.id)?.workflowId, undefined);
});
