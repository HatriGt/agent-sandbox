/**
 * Repo-LAYOUT hint (pure). It states ONLY where each repo is checked out — nothing about the goal.
 * A task can be anything (analysis, root-cause, fix, refactor, run tests, open a PR, ...); the task
 * alone defines the outcome, exactly like local Claude Code. The hint must therefore carry ZERO
 * outcome language: no "commit", no "PR", no "if you make changes".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reposPromptHint } from "../src/agent-prompt.ts";

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
