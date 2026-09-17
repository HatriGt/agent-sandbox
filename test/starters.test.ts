/**
 * Composer starters as pure data (web/src/lib/starters.ts), so the set and the compose-merge rule
 * are testable — the Hub only maps them to chips. TDD: written before extracting the module.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { STARTERS, mergeStarterText } from "../web/src/lib/starters.ts";

test("the starter set carries the workflow starters alongside the originals", () => {
  const labels = STARTERS.map((s) => s.label);
  for (const expected of [
    "Explain a codebase",
    "Fix a bug, open a PR",
    "Run the tests",
    "Review a diff",
    "Review a PR",
    "Plan first, then build",
    "TDD a feature",
    "Research, no repo",
  ]) {
    assert.ok(labels.includes(expected), `missing starter: ${expected}`);
  }
});

test("every starter is well-formed", () => {
  for (const s of STARTERS) {
    assert.ok(s.label.length > 0 && s.label.length <= 40, `${s.label}: chip-sized label`);
    assert.ok(s.task.trim().length > 20, `${s.label}: task must be a real brief`);
    assert.ok(!s.task.startsWith(" "), `${s.label}: no leading space`);
  }
});

test("the plan-first starter routes through the ask-and-stop gate", () => {
  const s = STARTERS.find((x) => x.label === "Plan first, then build")!;
  assert.ok(s.needsRepo, "planning a build needs a repo");
  // The brief must instruct the agent to ask for approval BEFORE changing files — the pause is the
  // product's magic moment, so the starter must reach it deterministically.
  assert.match(s.task, /plan/i);
  assert.match(s.task, /ask/i);
  assert.match(s.task, /(before|until).*(chang|edit|writ|implement)/is);
});

test("the TDD starter demands failing tests before implementation", () => {
  const s = STARTERS.find((x) => x.label === "TDD a feature")!;
  assert.ok(s.needsRepo);
  assert.match(s.task, /test/i);
  assert.match(s.task, /fail/i);
});

test("mergeStarterText: replaces an untouched other starter, appends under a typed brief", () => {
  const a = STARTERS[0];
  const b = STARTERS[1];
  // Empty composer: the starter text verbatim.
  assert.equal(mergeStarterText("", a.task), a.task);
  // Exactly another starter's text (untouched chip click): replace, don't stack.
  assert.equal(mergeStarterText(b.task, a.task), a.task);
  assert.equal(mergeStarterText(b.task + "\n", a.task), a.task, "trailing whitespace still counts as untouched");
  // A typed brief: keep it, append the starter under it.
  assert.equal(mergeStarterText("Fix the login bug", a.task), "Fix the login bug\n\n" + a.task);
});
