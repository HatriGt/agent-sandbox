/**
 * Repo-LAYOUT hint (pure). It states ONLY where each repo is checked out — nothing about the goal.
 * A task can be anything (analysis, root-cause, fix, refactor, run tests, open a PR, ...); the task
 * alone defines the outcome, exactly like local Claude Code. The hint must therefore carry ZERO
 * outcome language: no "commit", no "PR", no "if you make changes".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reposPromptHint } from "../src/agent-prompt.ts";
import { AGENT_SYS_PROMPT } from "../src/msb.ts";

test("single repo: states only the location", () => {
  const h = reposPromptHint([{ name: "web" }]);
  assert.match(h, /\/workspace\/web/);
});

test("multi-repo: lists every location", () => {
  const h = reposPromptHint([{ name: "deal-service" }, { name: "claims-service" }]);
  assert.match(h, /\/workspace\/deal-service/);
  assert.match(h, /\/workspace\/claims-service/);
});

test("hint carries NO outcome language (goal comes only from the task)", () => {
  for (const repos of [[{ name: "web" }], [{ name: "a" }, { name: "b" }]]) {
    const h = reposPromptHint(repos);
    assert.doesNotMatch(h, /commit/i);
    assert.doesNotMatch(h, /pull request|\bPR\b/i);
    assert.doesNotMatch(h, /if you (make )?change|when changing/i);
    assert.doesNotMatch(h, /you must|you should/i);
  }
});

// --- the standing policy: planning must be DEFAULT behaviour ------------------------------------
// The plan is the caller's only view of progress mid-run, so it cannot depend on the task text
// asking for it. These lock the instruction's teeth in — an edit that softens them fails here.

test("the prompt makes planning unprompted and step-by-step", () => {
  const p = AGENT_SYS_PROMPT;
  // Told to plan without being asked, and to do it FIRST rather than as a closing summary.
  assert.match(p, /without being asked/i);
  assert.match(p, /TodoWrite/);
  assert.match(p, /BEFORE the work/i);
  assert.match(p, /never as a summary afterwards/i);
  // The discipline that makes the live checklist truthful.
  assert.match(p, /ONE step in_progress at a time/i);
  assert.match(p, /in_progress BEFORE you begin/i);
  assert.match(p, /rather than batched at the end/i);
  // And it must not leak the mechanism into the transcript.
  assert.match(p, /do not repeat the list in/i);
});

test("the prompt still forbids AI attribution and reading the controller's channel", () => {
  assert.match(AGENT_SYS_PROMPT, /Co-Authored-By: Claude/);
  assert.match(AGENT_SYS_PROMPT, /Never read or print \/workspace\/\.agent\./);
});

test("a patched repo warns the agent the dirty tree is intentional", () => {
  const hint = reposPromptHint([{ name: "api", patch: "diff...\n" }]);
  assert.match(hint, /\/workspace\/api/);
  assert.match(hint, /uncommitted changes/i);
  assert.match(hint, /Do not stash, reset, or discard/);
  // And a plain checkout gets no such warning — the agent should trust `git status` there.
  assert.doesNotMatch(reposPromptHint([{ name: "api" }]), /uncommitted/i);
});
