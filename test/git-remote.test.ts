/**
 * Tests for parseOwnerName — mapping a local repo's origin remote URL to canonical owner/name.
 * This is what lets source=local pick the access-correct GitHub account (identity + push token).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOwnerName } from "../src/git-remote.ts";

test("scp-style ssh remote", () => {
  assert.equal(parseOwnerName("git@github.com:atom-insurance/elseco-deal-service.git"), "atom-insurance/elseco-deal-service");
});

test("ssh:// remote", () => {
  assert.equal(parseOwnerName("ssh://git@github.com/owner/name.git"), "owner/name");
});

test("https remote with .git", () => {
  assert.equal(parseOwnerName("https://github.com/owner/name.git"), "owner/name");
});

test("https remote without .git", () => {
  assert.equal(parseOwnerName("https://github.com/owner/name"), "owner/name");
});

test("non-two-segment path -> undefined", () => {
  assert.equal(parseOwnerName("https://github.com/owner"), undefined);
});

test("empty / garbage -> undefined", () => {
  assert.equal(parseOwnerName(""), undefined);
  assert.equal(parseOwnerName("not a url"), undefined);
});
