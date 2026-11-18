// The sent bubble folds a message's `> ` paragraphs back into quote pills.
// Run from web/:  npx --yes tsx --tsconfig tsconfig.json --test src/lib/you-message.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYouMessage, splitQuotes } from "./you-message";

test("the attachments tail is machinery, whether it says image, images, file or files", () => {
  assert.equal(parseYouMessage("why 429?\n\nAttached image (open with the Read tool):\n- /workspace/.attachments/1-a.png").body, "why 429?");
  assert.equal(parseYouMessage("why 429?\n\nAttached files (open with the Read tool):\n- /workspace/.attachments/1-a.png\n- /workspace/.attachments/2-pasted-1.json\n  text pasted into the message, 66 lines").body, "why 429?");
  assert.equal(parseYouMessage("Attached file (open with the Read tool):\n- /workspace/.attachments/1-r.pdf").body, "");
});

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
