/**
 * The memory/disk resize as one smooth sequence (src/http.ts resizeBox): a live turn is paused
 * (exit 252, a lifecycle row), /tmp survives the reboot, and the continuation the controller sends
 * is drawn as a lifecycle row rather than as the operator's words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResizeContinue, resizeContinueMessage, parseTrace } from "../src/trace.ts";
import { RESIZE_PAUSE_EXIT, RESTORE_TMP_SH, STASH_TMP_SH, TMP_STASH_DIR, AGENT_SYS_PROMPT } from "../src/msb.ts";
import { doneLabel, isFailedExit } from "../web/src/lib/format.ts";
import { nextSteps } from "../web/src/lib/next-steps.ts";

test("resizeContinueMessage round-trips through parseResizeContinue", () => {
  for (const what of ["memory", "storage"] as const) {
    for (const tier of ["2G", "4G", "16G"]) {
      assert.deepEqual(parseResizeContinue(resizeContinueMessage(what, tier)), { what, tier });
    }
  }
  // Ordinary follow-ups, including ones that mention the same words, stay ordinary.
  assert.equal(parseResizeContinue("The machine ran low on memory and was given more. Continue the task from where you left off."), null);
  assert.equal(parseResizeContinue("please continue the task"), null);
  assert.equal(parseResizeContinue(""), null);
});

test("the continuation is a real `you` turn in the log (the agent reads it; numbering counts it)", () => {
  const log = ["● paused to add memory (2G)", "⟦you⟧", resizeContinueMessage("memory", "2G"), "⟦/you⟧", "● session started (model x)", "hello"].join("\n");
  const events = parseTrace(log);
  assert.deepEqual(events[0], { kind: "lifecycle", label: "paused to add memory", detail: "2G" });
  const you = events.find((e) => e.kind === "you");
  assert.ok(you && you.kind === "you" && parseResizeContinue(you.text), "the follow-up is a you event the thread can recognise");
});

test("exit 252 is a pause, not a failure, and offers no next step", () => {
  assert.equal(RESIZE_PAUSE_EXIT, 252);
  assert.equal(doneLabel(252), "paused");
  // isFailedExit stays strict (non-zero): the thread's pill decides the label, next-steps the remedy.
  assert.equal(isFailedExit(252), true);
  const outcome = { state: "failed", trust: {}, result: { prs: [], diff: { files: 2, additions: 1, deletions: 1 } }, cost: { durationMs: 1 } } as unknown as Parameters<typeof nextSteps>[0];
  assert.deepEqual(nextSteps(outcome, 252), []);
});

test("/tmp stash only runs when the root disk has room, and restores from the same dir", () => {
  assert.match(STASH_TMP_SH, /du -sk \/tmp/);
  assert.match(STASH_TMP_SH, /df -Pk \/root/);
  assert.match(STASH_TMP_SH, /-gt \$\(\( \$\{u:-0\} \+ 65536 \)\)/, "needs the tmpfs size plus a margin free");
  assert.ok(STASH_TMP_SH.includes(`cp -a /tmp/. ${TMP_STASH_DIR}/`));
  assert.ok(RESTORE_TMP_SH.includes(`cp -a ${TMP_STASH_DIR}/. /tmp/`));
  assert.ok(RESTORE_TMP_SH.includes(`rm -rf ${TMP_STASH_DIR}`), "the stash does not linger on disk");
  // The shell never sees a leftover TypeScript interpolation.
  assert.doesNotMatch(STASH_TMP_SH + RESTORE_TMP_SH, /\$\{[a-zA-Z_]+\}/);
});

test("the agent is told /tmp is memory", () => {
  assert.match(AGENT_SYS_PROMPT, /\/tmp lives in memory and is emptied whenever the machine restarts/);
});
