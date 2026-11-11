/**
 * Optimistic echoes against the durable log. Each case here was a visible bug: the same words sent
 * twice showed nothing the second time; an old line scrolling out of the bounded tail brought a
 * message from hours ago back as if just sent; a message the log stores slightly differently left a
 * duplicate bubble behind for the life of the tab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADOPT_AFTER_MS, matchReplies, replyKey, stampReply } from "../web/src/lib/replies.ts";

const NOW = 1_800_000_000_000;

test("an echo with no line yet is pending", () => {
  const r = stampReply("fix the tests", [], undefined, NOW);
  assert.deepEqual(matchReplies([r], [], NOW), { pending: [r], settled: [] });
});

test("an echo is retired by the line that lands after it was sent", () => {
  const before = [{ text: "first", at: 100 }];
  const r = stampReply("fix the tests", before, 150, NOW);
  const m = matchReplies([r], [...before, { text: "fix the tests", at: 200 }], NOW);
  assert.deepEqual(m.pending, []);
  assert.deepEqual(m.settled, [{ id: r.id, line: 1 }]);
});

test("the same words sent again are echoed, not swallowed by the earlier message", () => {
  const log = [{ text: "continue", at: 100 }];
  const r = stampReply("continue", log, 180, NOW);
  assert.equal(r.seen, 1);
  assert.deepEqual(matchReplies([r], log, NOW).pending, [r], "the older line is not this echo's copy");
  const m = matchReplies([r], [...log, { text: "continue", at: 220 }], NOW);
  assert.deepEqual(m.settled, [{ id: r.id, line: 1 }]);
});

test("two identical echoes in flight consume one line each, in order", () => {
  const a = stampReply("go", [], 10, NOW);
  const b = stampReply("go", [], 10, NOW + 1);
  const one = matchReplies([a, b], [{ text: "go", at: 20 }], NOW);
  assert.deepEqual(one.settled, [{ id: a.id, line: 0 }]);
  assert.deepEqual(one.pending, [b]);
  const two = matchReplies([a, b], [{ text: "go", at: 20 }, { text: "go", at: 30 }], NOW);
  assert.deepEqual(two.settled.map((s) => s.id), [a.id, b.id]);
});

test("unstamped logs fall back to counting past the lines that were already there", () => {
  const log = [{ text: "continue" }];
  const r = stampReply("continue", log, undefined, NOW);
  assert.deepEqual(matchReplies([r], log, NOW).pending, [r]);
  assert.deepEqual(matchReplies([r], [...log, { text: "continue" }], NOW).settled, [{ id: r.id, line: 1 }]);
});

test("the log's defang marks and line endings do not keep an echo alive", () => {
  assert.equal(replyKey("  see ​⟦x⟧\r\nnext \n"), "see ⟦x⟧\nnext");
  const r = stampReply("look at ⟦this⟧\r\nplease", [], 5, NOW);
  const m = matchReplies([r], [{ text: "look at ​⟦this⟧\nplease", at: 9 }], NOW);
  assert.deepEqual(m.pending, []);
});

test("a line stored differently is adopted once the echo has waited long enough, never before", () => {
  const r = stampReply("ship it", [], 50, NOW);
  const log = [{ text: "ship it\n\n(expanded by the server)", at: 90 }];
  assert.deepEqual(matchReplies([r], log, NOW + 1000).pending, [r]);
  assert.deepEqual(matchReplies([r], log, NOW + ADOPT_AFTER_MS).settled, [{ id: r.id, line: 0 }]);
});

test("adoption never takes a line older than the send, or one another echo matched", () => {
  const a = stampReply("alpha", [], 50, NOW);
  const b = stampReply("beta", [], 50, NOW);
  const log = [
    { text: "ancient", at: 10 },
    { text: "alpha", at: 60 },
  ];
  const m = matchReplies([a, b], log, NOW + ADOPT_AFTER_MS * 2);
  assert.deepEqual(m.settled, [{ id: a.id, line: 1 }]);
  assert.deepEqual(m.pending, [b]);
});
