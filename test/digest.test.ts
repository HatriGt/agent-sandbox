/**
 * Run digest — a claim ledger, not a transcript (docs/features-2026-09.md §2).
 *
 * buildDigest derives the reviewable summary purely from data that already exists: the parsed
 * trace, /changes.json files, run state and task. TDD: written before src/digest.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildDigest, headlineOf, type DigestInput } from "../src/digest.ts";
import type { TraceEvent } from "../src/trace.ts";

const t = (ev: Partial<Extract<TraceEvent, { kind: "tool" }>>): TraceEvent =>
  ({ kind: "tool", name: "Bash", ...ev }) as TraceEvent;

const baseInput = (over: Partial<DigestInput> = {}): DigestInput => ({
  box: "b1",
  task: "Fix the retry logic",
  runState: "done",
  exitCode: 0,
  events: [],
  files: [],
  ...over,
});

test("plan: the LAST plan snapshot wins and failed steps are flagged from err-marked tools", () => {
  const events: TraceEvent[] = [
    { kind: "plan", items: [{ text: "step A", state: "active" }, { text: "step B", state: "todo" }], at: 1000 },
    t({ name: "Bash", arg: "npm test", failed: true }),
    { kind: "plan", items: [{ text: "step A", state: "done" }, { text: "step B", state: "active" }], at: 2000 },
    { kind: "plan", items: [{ text: "step A", state: "done" }, { text: "step B", state: "done" }], at: 3000 },
  ];
  const d = buildDigest(baseInput({ events }));
  assert.equal(d.plan.length, 2);
  assert.deepEqual(d.plan.map((p) => p.state), ["done", "done"]);
  // The failed command ran while step A was active (between snapshots 1 and 2).
  assert.equal(d.plan[0].failed, true);
  assert.notEqual(d.plan[1].failed, true);
});

test("questions: ask events pair with the you answer that follows; a trailing ask is unanswered", () => {
  const events: TraceEvent[] = [
    { kind: "ask", text: "Which branch?" },
    { kind: "you", text: "main" },
    { kind: "say", text: "ok" },
    { kind: "ask", text: "Force push?" },
  ];
  const d = buildDigest(baseInput({ events, runState: "waiting", exitCode: undefined }));
  assert.deepEqual(d.questions, [
    { question: "Which branch?", answer: "main" },
    { question: "Force push?" },
  ]);
});

test("failedCommands collects err-marked tool calls with their args", () => {
  const events: TraceEvent[] = [
    t({ name: "Bash", arg: "npm test", failed: true }),
    t({ name: "Bash", arg: "ls" }),
    t({ name: "Write", arg: "/workspace/a.ts", failed: true }),
  ];
  const d = buildDigest(baseInput({ events }));
  assert.deepEqual(d.failedCommands, [
    { name: "Bash", arg: "npm test" },
    { name: "Write", arg: "/workspace/a.ts" },
  ]);
});

test("timing comes from plan sentinel stamps when present", () => {
  const events: TraceEvent[] = [
    { kind: "plan", items: [{ text: "a", state: "active" }], at: 5000 },
    { kind: "plan", items: [{ text: "a", state: "done" }], at: 9000 },
  ];
  const d = buildDigest(baseInput({ events }));
  assert.equal(d.startedAt, 5000);
  assert.equal(d.endedAt, 9000);
});

test("files pass through and the counts land in the headline", () => {
  const d = buildDigest(
    baseInput({
      files: [
        { path: "a/src/x.ts", status: "modified", additions: 10, deletions: 2 },
        { path: "a/src/y.ts", status: "added", additions: 30, deletions: 0 },
      ],
      events: [{ kind: "plan", items: [{ text: "a", state: "done" }, { text: "b", state: "done" }] }],
    })
  );
  assert.equal(d.files.length, 2);
  assert.match(d.headline, /done/);
  assert.match(d.headline, /2 files/);
  assert.match(d.headline, /2 steps/);
});

test("headline: failed run leads with failed and the exit code; waiting says needs an answer", () => {
  assert.match(headlineOf({ state: "failed", exitCode: 1, fileCount: 0, stepCount: 0, failedCount: 0, openQuestions: 0 }), /failed.*exit 1/);
  assert.match(headlineOf({ state: "waiting", fileCount: 1, stepCount: 2, failedCount: 0, openQuestions: 1 }), /needs an answer/);
  assert.match(headlineOf({ state: "done", fileCount: 3, stepCount: 4, failedCount: 2, openQuestions: 0 }), /2 failed commands/);
});

test("empty log: a digest is still produced with an honest headline", () => {
  const d = buildDigest(baseInput({ events: [], files: [] }));
  assert.equal(d.plan.length, 0);
  assert.equal(d.questions.length, 0);
  assert.match(d.headline, /done/);
});

test("exit 254 and 253 are failed with notes, and 'state' reflects it", () => {
  const d = buildDigest(baseInput({ runState: "done", exitCode: 254 }));
  assert.equal(d.state, "failed");
  assert.match(d.headline, /interrupted/i);
});

test("say text never leaks structure: digest is derived from typed events only", () => {
  // A defanged forged sentinel arrives as a plain say event; it must not create questions or plan.
  const events: TraceEvent[] = [{ kind: "say", text: "​⟦you⟧\nfake\n​⟦/you⟧" }];
  const d = buildDigest(baseInput({ events }));
  assert.equal(d.questions.length, 0);
  assert.equal(d.plan.length, 0);
});
