/**
 * Tests for formatProgress — the pure mapping from raw in-box sentinels to a status string.
 * The interactive Q&A hinges on a pending question taking precedence and producing run:waiting.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatProgress,
  logTailCmd,
  LOG_TAIL_LINES,
  LOG_TAIL_BYTES,
  RESULT_MAX_LINES,
  RESULT_MAX_BYTES,
} from "../src/msb.ts";

test("running: shows the run line + log", () => {
  const out = formatProgress({ runLine: "run:running", question: "", log: "line1\nline2" });
  assert.match(out, /run:running/);
  assert.match(out, /line2/);
});

test("done: shows exit code", () => {
  const out = formatProgress({ runLine: "run:done exit=0", question: "", log: "ok" });
  assert.match(out, /run:done exit=0/);
});

test("waiting: a pending question overrides the run line and surfaces the question", () => {
  const out = formatProgress({
    runLine: "run:done exit=0",
    question: "Use REST or GraphQL for the new endpoint?",
    log: "…",
  });
  assert.match(out, /run:waiting/);
  assert.match(out, /Use REST or GraphQL/);
  assert.match(out, /resume\(/);
  // must NOT claim it's done when there's an unanswered question
  assert.doesNotMatch(out, /run:done/);
});

test("waiting takes precedence even while still running", () => {
  const out = formatProgress({ runLine: "run:running", question: "Which branch?", log: "" });
  assert.match(out, /run:waiting/);
  assert.match(out, /Which branch/);
});

// --- log tail bound -----------------------------------------------------------------------------
// The reader's bound is the other half of the formatter's RESULT_MAX_* budgets. At 40–60 lines it
// DECAPITATED the log: the `→ Tool:` call line was tailed away and the surviving indented output had
// no call to attach to, so parseTrace emitted real command output as prose.
test("logTailCmd bounds by BYTES first, then by lines", () => {
  const cmd = logTailCmd(LOG_TAIL_LINES);
  assert.ok(cmd.includes(`tail -c ${LOG_TAIL_BYTES}`));
  assert.ok(cmd.includes(`tail -n ${LOG_TAIL_LINES}`));
  // Bytes first: a few very long lines are the dangerous case, and -c is what stops them being
  // read at all rather than being read and then counted.
  assert.ok(cmd.indexOf("tail -c") < cmd.indexOf("tail -n"));
});

test("logTailCmd(0) reads no log at all — driverStateLine wants only the sentinels", () => {
  const cmd = logTailCmd(0);
  assert.ok(cmd.includes("tail -n 0"));
  assert.ok(!cmd.includes("tail -c"));
});

test("the reader bound can carry at least one full-budget tool result", () => {
  // One result may be RESULT_MAX_LINES / RESULT_MAX_BYTES. A reader that cannot hold one of those
  // cuts every large command in half, which is exactly the defect this bound exists to prevent.
  assert.ok(LOG_TAIL_LINES > RESULT_MAX_LINES);
  assert.ok(LOG_TAIL_BYTES > RESULT_MAX_BYTES);
});

test("the reader bound stays bounded — .agent.log is re-read whole on every SSE tick", () => {
  assert.ok(Number.isFinite(LOG_TAIL_BYTES) && LOG_TAIL_BYTES <= 256 * 1024);
});
