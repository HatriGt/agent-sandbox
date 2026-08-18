/**
 * Tests for formatProgress — the pure mapping from raw in-box sentinels to a status string.
 * The interactive Q&A hinges on a pending question taking precedence and producing run:waiting.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatProgress } from "../src/msb.ts";

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
