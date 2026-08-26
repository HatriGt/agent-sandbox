import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuestion, questionHeadline } from "../web/src/lib/question.ts";

test("question: the structured shape (title / context / Options:)", () => {
  const q = parseQuestion(
    "Which database should the migration target?\n\nThe repo has both a Postgres and a SQLite config.\n\nOptions:\n- Postgres (recommended)\n- SQLite\n- Ask me later"
  );
  assert.equal(q.title, "Which database should the migration target?");
  assert.equal(q.context, "The repo has both a Postgres and a SQLite config.");
  assert.deepEqual(q.options, ["Postgres (recommended)", "SQLite", "Ask me later"]);
});

test("question: legacy (A)/(B)/(C) list with a trailing 'Which would you like?'", () => {
  const raw =
    "To dig deeper I need GitHub auth. But it was lost:\n\n- `gh` was authenticated earlier, now unset.\n- All calls fail.\n\nPlease re-run with the credential. Options:\n  (A) Re-export GH_TOKEN, OR\n  (B) Run `gh auth login`, OR\n  (C) Tell me to proceed with only the diff.\n\nWhich would you like?";
  const q = parseQuestion(raw);
  assert.equal(q.title, "To dig deeper I need GitHub auth. But it was lost:");
  assert.deepEqual(q.options, ["Re-export GH_TOKEN", "Run `gh auth login`", "Tell me to proceed with only the diff"]);
  assert.match(q.context, /authenticated earlier/);
  assert.doesNotMatch(q.context, /Options:/);
});

test("question: numbered list without header", () => {
  const q = parseQuestion("Pick an approach:\n1) mock the clock\n2) widen the tolerance");
  assert.equal(q.title, "Pick an approach:");
  assert.deepEqual(q.options, ["mock the clock", "widen the tolerance"]);
});

test("question: inline brackets", () => {
  const q = parseQuestion("The test asserts on wall-clock timing. Should I [mock the clock] or [widen the tolerance]?");
  assert.deepEqual(q.options, ["mock the clock", "widen the tolerance"]);
});

test("question: free-form has no options; headline truncates", () => {
  const q = parseQuestion("What is the database URL I should use?");
  assert.deepEqual(q.options, []);
  assert.equal(questionHeadline("x".repeat(200)).length, 140);
  assert.equal(questionHeadline(undefined), "");
});
