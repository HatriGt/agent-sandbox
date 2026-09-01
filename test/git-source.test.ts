/**
 * Phase 1 / Step 2 — git-source pure helpers (TDD).
 * These test URL normalization + clone argv building WITHOUT touching the network or a VPS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRepo,
  buildCloneUrl,
  buildCloneArgs,
  buildApplyArgs,
  MAX_PATCH_BYTES,
  isValidRef,
} from "../src/git-source.ts";

test("normalizeRepo: owner/name shorthand -> canonical", () => {
  assert.equal(normalizeRepo("HatriGt/agent-sandbox"), "HatriGt/agent-sandbox");
});

test("normalizeRepo: full https URL -> owner/name", () => {
  assert.equal(
    normalizeRepo("https://github.com/HatriGt/agent-sandbox"),
    "HatriGt/agent-sandbox"
  );
  assert.equal(
    normalizeRepo("https://github.com/HatriGt/agent-sandbox.git"),
    "HatriGt/agent-sandbox"
  );
});

test("normalizeRepo: rejects garbage", () => {
  assert.throws(() => normalizeRepo(""));
  assert.throws(() => normalizeRepo("not a repo"));
  assert.throws(() => normalizeRepo("only-one-part"));
});

test("buildCloneUrl: no token -> plain https", () => {
  assert.equal(
    buildCloneUrl("HatriGt/agent-sandbox"),
    "https://github.com/HatriGt/agent-sandbox.git"
  );
});

test("buildCloneUrl: with token -> token embedded for private clone", () => {
  assert.equal(
    buildCloneUrl("HatriGt/agent-sandbox", "gho_ABC"),
    "https://x-access-token:gho_ABC@github.com/HatriGt/agent-sandbox.git"
  );
});

test("buildCloneArgs: fresh shallow clone into target dir, with ref", () => {
  const args = buildCloneArgs("https://github.com/o/r.git", "main", "/stage/s1");
  assert.deepEqual(args, [
    "clone",
    "--depth",
    "1",
    "--branch",
    "main",
    "https://github.com/o/r.git",
    "/stage/s1",
  ]);
});

test("buildCloneArgs: no ref -> default branch (omit --branch)", () => {
  const args = buildCloneArgs("https://github.com/o/r.git", undefined, "/stage/s1");
  assert.deepEqual(args, ["clone", "--depth", "1", "https://github.com/o/r.git", "/stage/s1"]);
});

test("isValidRef: accepts normal refs, rejects injection-y ones", () => {
  assert.ok(isValidRef("main"));
  assert.ok(isValidRef("release/v1.2.3"));
  assert.ok(isValidRef("a1b2c3d"));
  assert.ok(!isValidRef("main; rm -rf /"));
  assert.ok(!isValidRef("$(whoami)"));
  assert.ok(!isValidRef("--upload-pack=evil"));
});

test("buildApplyArgs: applies staged (--index) from stdin at the checkout dir", () => {
  assert.deepEqual(buildApplyArgs("/stage/s1/api"), ["-C", "/stage/s1/api", "apply", "--index", "--whitespace=nowarn"]);
});

test("MAX_PATCH_BYTES bounds the caller diff to 8 MB", () => {
  assert.equal(MAX_PATCH_BYTES, 8 * 1024 * 1024);
});
