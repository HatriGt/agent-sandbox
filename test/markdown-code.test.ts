/**
 * The dashboard's markdown code-node classification. It lives in web/src (it renders in the browser)
 * but is pure, so it is covered here rather than adding a second test runner.
 *
 * Regression: multi-line fenced blocks were misclassified as inline and rendered as a proportional-
 * font blob (code / JSON / ASCII art collapsed, whitespace normalized). A block must be detected by
 * a `language-*` class OR a newline in its content; only true single-line inline code stays inline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCodeBlock } from "../web/src/lib/markdown-code.ts";

test("isCodeBlock: single-line inline code stays inline", () => {
  assert.equal(isCodeBlock(undefined, "npm test"), false);
  assert.equal(isCodeBlock("", "const x = 1"), false);
});

test("isCodeBlock: a language-* class marks a block (even single line)", () => {
  assert.equal(isCodeBlock("language-bash", "ls -la"), true);
  assert.equal(isCodeBlock("language-json", "{}"), true);
});

test("isCodeBlock: multi-line content is a block even with no language", () => {
  // Plain ASCII art / box-drawing in a bare ``` fence — must render monospace, whitespace preserved.
  const ascii = "┌───┬───┐\n│ a │ b │\n└───┴───┘";
  assert.equal(isCodeBlock(undefined, ascii), true);
});

test("isCodeBlock: multi-line fenced code with a language is a block", () => {
  const bash = "cd /workspace\nnpm ci\nnpm test";
  assert.equal(isCodeBlock("language-bash", bash), true);
});
