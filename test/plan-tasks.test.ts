/**
 * Per-step evidence: joining the agent's declared plan to the work it actually did between snapshots.
 * Same rationale as trace.test.ts — the code is pure and lives in web/src, so it is covered here.
 *
 * The log shapes below are what `stream-fmt.js` really appends, including the `⟦plan⟧ <ms>` stamp.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrace } from "../src/trace.ts";
import { deriveTaskBoard, describeChanges, diffPlan, shortDuration, shortPath, stepSimilarity } from "../web/src/lib/planTasks.ts";

const T0 = 1756713600000;

/** Two steps: the first worked and finished, the second is in progress. */
const LOG = [
  `⟦plan⟧ ${T0}`,
  "[>] Wire the parser",
  "[ ] Render the board",
  "⟦/plan⟧",
  "→ Read: /workspace/src/trace.ts",
  "  export type TraceEvent = …",
  "→ Edit: /workspace/src/trace.ts",
  "  Applied 1 edit",
  "→ Bash: npm test",
  "  ok 12 passed",
  `⟦plan⟧ ${T0 + 9000}`,
  "[x] Wire the parser",
  "[>] Render the board",
  "⟦/plan⟧",
  "→ Write: /workspace/src/Board.tsx",
  "  File created successfully",
].join("\n");

test("attributes tool work to the step that was in progress", () => {
  const board = deriveTaskBoard(parseTrace(LOG));
  assert.ok(board);
  assert.equal(board.tasks.length, 2);

  const [wire, render] = board.tasks;
  assert.equal(wire.state, "done");
  // Read counts as a step but not as a file touched; Edit is the only write here.
  assert.equal(wire.evidence.steps, 3);
  assert.deepEqual(wire.evidence.files, ["/workspace/src/trace.ts"]);
  assert.deepEqual(wire.evidence.commands, ["npm test"]);
  // The Read is named rather than folded into a bare number.
  assert.deepEqual(wire.evidence.others, [{ name: "Read", n: 1 }]);
  assert.equal(wire.evidence.ms, 9000);

  assert.equal(render.state, "active");
  assert.deepEqual(render.evidence.files, ["/workspace/src/Board.tsx"]);
  // The window is still open — no second snapshot has closed it, so there is no duration yet.
  assert.equal(render.evidence.ms, undefined);
  assert.deepEqual(render.evidence.latest, { name: "Write", arg: "/workspace/src/Board.tsx" });
});

test("reports progress, revisions and total time from the latest snapshot", () => {
  const board = deriveTaskBoard(parseTrace(LOG));
  assert.ok(board);
  assert.equal(board.done, 1);
  assert.equal(board.complete, false);
  assert.equal(board.revisions, 2);
  assert.equal(board.ms, 9000);
});

test("a failed call marks its step, not the whole board", () => {
  const log = [`⟦plan⟧ ${T0}`, "[>] Run the suite", "⟦/plan⟧", "→ Bash: npm test", "  ⟦err⟧ 1 failing"].join("\n");
  const board = deriveTaskBoard(parseTrace(log));
  assert.ok(board);
  assert.equal(board.tasks[0].evidence.failed, true);
  assert.equal(board.tasks[0].evidence.steps, 1);
});

test("a step re-entered later accumulates into one bucket", () => {
  const log = [
    `⟦plan⟧ ${T0}`,
    "[>] Fix the flake",
    "[ ] Ship",
    "⟦/plan⟧",
    "→ Bash: npm test",
    `⟦plan⟧ ${T0 + 4000}`,
    "[ ] Fix the flake",
    "[>] Ship",
    "⟦/plan⟧",
    "→ Bash: git push",
    // The agent goes back to the first step.
    `⟦plan⟧ ${T0 + 10000}`,
    "[>] Fix the flake",
    "[ ] Ship",
    "⟦/plan⟧",
    "→ Bash: npm test -- --retry",
    `⟦plan⟧ ${T0 + 16000}`,
    "[x] Fix the flake",
    "[x] Ship",
    "⟦/plan⟧",
  ].join("\n");
  const board = deriveTaskBoard(parseTrace(log));
  assert.ok(board);
  const fix = board.tasks[0];
  assert.equal(fix.evidence.steps, 2);
  assert.deepEqual(fix.evidence.commands, ["npm test", "npm test -- --retry"]);
  // 4s in the first window + 6s in the second.
  assert.equal(fix.evidence.ms, 10000);
  assert.equal(board.complete, true);
});

test("a log from the older formatter parses without stamps and shows no duration", () => {
  const log = ["⟦plan⟧", "[>] Do the thing", "⟦/plan⟧", "→ Write: /workspace/a.md", "⟦plan⟧", "[x] Do the thing", "⟦/plan⟧"].join("\n");
  const board = deriveTaskBoard(parseTrace(log));
  assert.ok(board);
  assert.equal(board.tasks[0].state, "done");
  assert.deepEqual(board.tasks[0].evidence.files, ["/workspace/a.md"]);
  assert.equal(board.tasks[0].evidence.ms, undefined);
  assert.equal(board.ms, undefined);
});

test("no plan in the log means no board at all", () => {
  assert.equal(deriveTaskBoard(parseTrace("→ Bash: ls\n  a.md")), null);
});

test("work before the first snapshot belongs to no step", () => {
  const log = ["→ Bash: ls", `⟦plan⟧ ${T0}`, "[>] Start", "⟦/plan⟧"].join("\n");
  const board = deriveTaskBoard(parseTrace(log));
  assert.ok(board);
  assert.equal(board.tasks[0].evidence.steps, 0);
});

test("durations read in the console's voice", () => {
  assert.equal(shortDuration(9000), "9s");
  assert.equal(shortDuration(60000), "1m");
  assert.equal(shortDuration(160000), "2m 40s");
  assert.equal(shortDuration(3840000), "1h 04m");
});

test("paths lose the workspace prefix", () => {
  assert.equal(shortPath("/workspace/src/a.ts"), "src/a.ts");
  assert.equal(shortPath("src/a.ts"), "src/a.ts");
});

/* ── Plan rewrites: what changed between the previous and the latest snapshot ───────────────────── */

const item = (text: string, state: "done" | "active" | "todo" = "todo") => ({ text, state });

test("a status-only revision reports no changes", () => {
  const board = deriveTaskBoard(parseTrace(LOG));
  assert.ok(board);
  assert.equal(board.changes, undefined);
  assert.equal(diffPlan([item("a", "active"), item("b")], [item("a", "done"), item("b", "active")]), null);
});

test("added and removed steps are reported for the last revision only", () => {
  const log = [
    `⟦plan⟧ ${T0}`,
    "[>] Read the code",
    "[ ] Write the fix",
    "⟦/plan⟧",
    `⟦plan⟧ ${T0 + 5000}`,
    "[x] Read the code",
    "[>] Write the fix",
    "[ ] Ship it",
    "⟦/plan⟧",
    `⟦plan⟧ ${T0 + 9000}`,
    "[x] Read the code",
    "[x] Write the fix",
    "[ ] Add a changelog entry",
    "⟦/plan⟧",
  ].join("\n");
  const board = deriveTaskBoard(parseTrace(log));
  assert.ok(board);
  assert.equal(board.revisions, 3);
  assert.deepEqual(board.changes, { added: ["Add a changelog entry"], removed: ["Ship it"], reworded: [], at: T0 + 9000 });
  assert.equal(describeChanges(board.changes!), "1 step added, 1 removed");
});

test("a similar step at the same position is a rewording, and keeps its evidence", () => {
  const log = [
    `⟦plan⟧ ${T0}`,
    "[>] Add tests",
    "[ ] Open a pull request",
    "⟦/plan⟧",
    "→ Write: /workspace/test/burst.test.ts",
    `⟦plan⟧ ${T0 + 5000}`,
    "[>] Add burst tests",
    "[ ] Open a pull request",
    "⟦/plan⟧",
    "→ Bash: npm test",
  ].join("\n");
  const board = deriveTaskBoard(parseTrace(log));
  assert.ok(board);
  assert.deepEqual(board.changes, { added: [], removed: [], reworded: [{ from: "Add tests", to: "Add burst tests" }], at: T0 + 5000 });
  assert.equal(describeChanges(board.changes!), "reworded 'Add tests' → 'Add burst tests'");
  // Work done under the old wording carries forward; the window keeps accumulating under the new one.
  const t = board.tasks[0];
  assert.equal(t.text, "Add burst tests");
  assert.deepEqual(t.evidence.files, ["/workspace/test/burst.test.ts"]);
  assert.deepEqual(t.evidence.commands, ["npm test"]);
  assert.equal(t.evidence.ms, 5000);
});

test("an unrelated step at the same position is a removal plus an addition", () => {
  const d = diffPlan([item("Add tests"), item("Ship")], [item("Rewrite the README"), item("Ship")]);
  assert.deepEqual(d, { added: ["Rewrite the README"], removed: ["Add tests"], reworded: [] });
});

test("reordering survivors is reported without inventing adds or removes", () => {
  const d = diffPlan([item("a"), item("b"), item("c")], [item("c"), item("a"), item("b")]);
  assert.deepEqual(d, { added: [], removed: [], reworded: [], reordered: true });
  assert.equal(describeChanges(d!), "steps reordered");
});

test("similarity is a word-overlap score", () => {
  assert.equal(stepSimilarity("Add tests", "Add tests"), 1);
  assert.ok(stepSimilarity("Add tests", "Add burst tests") >= 0.5);
  assert.ok(stepSimilarity("Add tests", "Open a pull request") < 0.5);
});

test("long rewordings are clipped in the note", () => {
  const long = "Implement the sliding-window limiter on Redis with bucketed hashes";
  const d = diffPlan([item(long)], [item(long + " and expiry")]);
  const note = describeChanges(d!);
  assert.ok(note.startsWith("reworded 'Implement the sliding-window"));
  assert.ok(note.includes("…"));
});

test("a failed call is remembered on the step as the reason", () => {
  const log = [`⟦plan⟧ ${T0}`, "[>] Deploy", "⟦/plan⟧", "→ Bash: npm test", "  ok", "→ Bash: ./deploy.sh", "  ⟦err⟧ exit 1", "→ Bash: echo done"].join("\n");
  const board = deriveTaskBoard(parseTrace(log));
  assert.ok(board);
  assert.deepEqual(board.tasks[0].evidence.failedCall, { name: "Bash", arg: "./deploy.sh" });
  assert.deepEqual(board.tasks[0].evidence.latest, { name: "Bash", arg: "echo done" });
});
