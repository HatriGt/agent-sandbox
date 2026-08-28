import test from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, titlePrompt } from "../src/titles.ts";

test("cleanTitle: strips quotes, prefixes, markdown and trailing punctuation; caps length", () => {
  assert.equal(cleanTitle('"Review PR and improve reviewer workflow."'), "Review PR and improve reviewer workflow");
  assert.equal(cleanTitle("Title: Fix flaky retry test"), "Fix flaky retry test");
  assert.equal(cleanTitle("Sure! Here is a title:\n**Audit auth middleware**"), "Audit auth middleware");
  assert.equal(cleanTitle("- Print numbers with delays"), "Print numbers with delays");
  const long = cleanTitle("A very long title that keeps going well past the sixty character limit we set");
  assert.ok(long.length <= 60 && long.endsWith("…"), long);
  assert.equal(cleanTitle(""), "");
});

test("titlePrompt asks for a short sidebar title and includes the task", () => {
  const p = titlePrompt("review latest pr in this and give me points");
  assert.match(p, /3 to 6 words/);
  assert.match(p, /review latest pr/);
});
