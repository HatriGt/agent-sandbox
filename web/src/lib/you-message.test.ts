// The sent bubble folds a message's `> ` paragraphs back into quote pills.
// Run from web/:  npx --yes tsx --tsconfig tsconfig.json --test src/lib/you-message.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitQuotes } from "./you-message";

test("a quote paragraph between prose becomes one quote part, framing blank lines dropped", () => {
  assert.deepEqual(splitQuotes("Look at this:\n\n> the limiter keeps six\n> buckets\n\nwhy six?"), [
    { text: "Look at this:" },
    { quote: "the limiter keeps six\nbuckets" },
    { text: "why six?" },
  ]);
});

test("a message that is only a quote", () => {
  assert.deepEqual(splitQuotes("> alone"), [{ quote: "alone" }]);
});

test("prose keeps its own line breaks; a bare `>` line is an empty quote line", () => {
  assert.deepEqual(splitQuotes("a\nb\n\n> q1\n>\n> q3"), [{ text: "a\nb" }, { quote: "q1\n\nq3" }]);
});

test("no quotes: the body is one text part", () => {
  assert.deepEqual(splitQuotes("plain\n\ntext"), [{ text: "plain\n\ntext" }]);
});

test("two quotes back to back stay two pills", () => {
  assert.deepEqual(splitQuotes("> one\n\n> two\n\nthen"), [{ quote: "one" }, { quote: "two" }, { text: "then" }]);
});
