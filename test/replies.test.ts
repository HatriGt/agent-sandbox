/**
 * The ghost-message bug: the log is a bounded tail, so a ⟦you⟧ line eventually scrolls out of the
 * window. The old filter (`replies.filter(r => !persisted.has(r))`) then RESURRECTED the optimistic
 * echo — a message sent hours ago reappeared at the bottom of the thread as if just sent. An echo
 * must be retired the first time its persisted copy is seen, permanently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitReplies } from "../web/src/lib/replies.ts";

test("an unpersisted echo is pending", () => {
  const r = splitReplies(["fix the tests"], new Set(), new Set());
  assert.deepEqual(r.pending, ["fix the tests"]);
  assert.deepEqual(r.nowSettled, []);
});

test("an echo seen in the log settles and stops being pending", () => {
  const r = splitReplies(["fix the tests"], new Set(["fix the tests"]), new Set());
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.nowSettled, ["fix the tests"]);
});

test("a settled echo NEVER comes back when the log tail scrolls past it", () => {
  // The persisted set no longer contains the message (tail window moved on) — but it settled before.
  const r = splitReplies(["old message"], new Set(), new Set(["old message"]));
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.nowSettled, []);
});

test("whitespace differences between echo and log line still match", () => {
  const r = splitReplies(["  fix the tests \n"], new Set(["fix the tests"]), new Set());
  assert.deepEqual(r.pending, []);
  assert.deepEqual(r.nowSettled, ["  fix the tests \n"]);
});

test("mixed batch: settled skipped, persisted settles, new stays pending", () => {
  const r = splitReplies(["a", "b", "c"], new Set(["b"]), new Set(["a"]));
  assert.deepEqual(r.pending, ["c"]);
  assert.deepEqual(r.nowSettled, ["b"]);
});
