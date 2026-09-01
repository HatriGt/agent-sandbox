/**
 * Per-step evidence: joining the agent's declared plan to the work it actually did between snapshots.
 * Same rationale as trace.test.ts — the code is pure and lives in web/src, so it is covered here.
 *
 * The log shapes below are what `stream-fmt.js` really appends, including the `⟦plan⟧ <ms>` stamp.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrace } from "../web/src/lib/trace.ts";
import { deriveTaskBoard, shortDuration, shortPath } from "../web/src/lib/planTasks.ts";

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
