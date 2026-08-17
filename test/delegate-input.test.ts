/**
 * Phase 1 / Step 3 — delegate input validation + ask-if-missing (TDD).
 * Pure: given partial args, either return a ready plan or a plain-text question. No side effects.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDelegateInput } from "../src/delegate-input.ts";

test("remote: missing repo -> ask (not error)", () => {
  const r = validateDelegateInput({ source: "git", task: "fix the bug" });
  assert.equal(r.ok, false);
  assert.match(r.question!, /repo/i);
});

test("remote: missing task -> ask", () => {
  const r = validateDelegateInput({ source: "git", repo: "o/n" });
  assert.equal(r.ok, false);
  assert.match(r.question!, /task/i);
});

test("remote: missing both -> ask lists both", () => {
  const r = validateDelegateInput({ source: "git" });
  assert.equal(r.ok, false);
  assert.match(r.question!, /repo/i);
  assert.match(r.question!, /task/i);
});

test("remote: repo + task -> ok, ref optional", () => {
  const r = validateDelegateInput({ source: "git", repo: "o/n", task: "do it" });
  assert.equal(r.ok, true);
  assert.equal(r.plan!.repo, "o/n");
  assert.equal(r.plan!.task, "do it");
  assert.equal(r.plan!.ref, undefined);
});

test("remote: ref carried through when given", () => {
  const r = validateDelegateInput({ source: "git", repo: "o/n", task: "t", ref: "main" });
  assert.equal(r.ok, true);
  assert.equal(r.plan!.ref, "main");
});

test("local: missing repo path -> ask", () => {
  const r = validateDelegateInput({ source: "local", task: "t" });
  assert.equal(r.ok, false);
  assert.match(r.question!, /repo|path/i);
});

test("local: repo path + task -> ok", () => {
  const r = validateDelegateInput({ source: "local", repo: "/Users/me/proj", task: "t" });
  assert.equal(r.ok, true);
  assert.equal(r.plan!.repo, "/Users/me/proj");
});

test("blank strings are treated as missing", () => {
  const r = validateDelegateInput({ source: "git", repo: "   ", task: "t" });
  assert.equal(r.ok, false);
  assert.match(r.question!, /repo/i);
});

test("question is plain guidance to re-call, not a thrown error", () => {
  const r = validateDelegateInput({ source: "git" });
  assert.equal(r.ok, false);
  assert.match(r.question!, /re-call|call delegate|provide/i);
});
