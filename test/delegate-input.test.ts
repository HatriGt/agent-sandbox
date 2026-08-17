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

// ---- multi-repo (repos[]) --------------------------------------------------------------

test("single repo is normalized into plan.repos (list of one)", () => {
  const r = validateDelegateInput({ source: "git", repo: "o/n", task: "t" });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.plan!.repos.map((x) => x.repo),
    ["o/n"]
  );
  assert.equal(r.plan!.repo, "o/n"); // back-compat accessor = first repo
});

test("repos[] accepted; task once; each repo carries optional ref", () => {
  const r = validateDelegateInput({
    source: "git",
    repos: [{ repo: "o/frontend" }, { repo: "o/backend", ref: "develop" }],
    task: "wire the new API",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.plan!.repos.map((x) => x.repo),
    ["o/frontend", "o/backend"]
  );
  assert.equal(r.plan!.repos[1].ref, "develop");
});

test("repos[] with a blank repo entry -> ask", () => {
  const r = validateDelegateInput({
    source: "git",
    repos: [{ repo: "o/a" }, { repo: "   " }],
    task: "t",
  });
  assert.equal(r.ok, false);
  assert.match(r.question!, /repo/i);
});

test("repos[] present but task missing -> ask for task", () => {
  const r = validateDelegateInput({ source: "git", repos: [{ repo: "o/a" }] });
  assert.equal(r.ok, false);
  assert.match(r.question!, /task/i);
});

test("empty repos[] AND no repo -> ask for repo", () => {
  const r = validateDelegateInput({ source: "git", repos: [], task: "t" });
  assert.equal(r.ok, false);
  assert.match(r.question!, /repo/i);
});

test("workspaceName is derived from the repo (basename / owner-name)", () => {
  const r = validateDelegateInput({
    source: "local",
    repos: [{ repo: "/Users/me/frontend" }, { repo: "/Users/me/backend" }],
    task: "t",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.plan!.repos.map((x) => x.name),
    ["frontend", "backend"]
  );
});

test("git repo names derive from owner/name -> name segment", () => {
  const r = validateDelegateInput({
    source: "git",
    repos: [{ repo: "acme/web-app" }, { repo: "acme/api" }],
    task: "t",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.plan!.repos.map((x) => x.name),
    ["web-app", "api"]
  );
});

test("duplicate repo names are disambiguated (no /workspace collision)", () => {
  const r = validateDelegateInput({
    source: "git",
    repos: [{ repo: "teamA/api" }, { repo: "teamB/api" }],
    task: "t",
  });
  assert.equal(r.ok, true);
  const names = r.plan!.repos.map((x) => x.name);
  assert.equal(new Set(names).size, 2, "names must be unique");
});
