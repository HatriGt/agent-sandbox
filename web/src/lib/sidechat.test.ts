// Reducer and composition contract for the side chat's attached quote.
// Run from web/:  npx --yes tsx --tsconfig tsconfig.json --test src/lib/sidechat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, QUOTE_MAX, composeQuestion, questionBody, reduce, type PendingTurn, type TurnId } from "./sidechat";

const turn = (question: string, quote?: string): PendingTurn => ({ id: "t1" as TurnId, question, askedAt: 1, ...(quote ? { quote } : {}) });

test("quote attaches the trimmed text and opens the chat", () => {
  const chat = reduce(EMPTY, { type: "quote", text: "  six 10-second buckets  " });
  assert.equal(chat.quote, "six 10-second buckets");
  assert.equal(chat.open, true);
});

test("a blank quote changes nothing", () => {
  assert.equal(reduce(EMPTY, { type: "quote", text: " \n " }), EMPTY);
});

test("a long quote is capped with an ellipsis", () => {
  const chat = reduce(EMPTY, { type: "quote", text: "x".repeat(QUOTE_MAX + 400) });
  assert.equal(chat.quote?.length, QUOTE_MAX + 1);
  assert.ok(chat.quote?.endsWith("…"));
});

test("unquote clears the quote and keeps the draft", () => {
  const withBoth = reduce(reduce(EMPTY, { type: "quote", text: "q" }), { type: "draft", text: "why?" });
  const chat = reduce(withBoth, { type: "unquote" });
  assert.equal(chat.quote, null);
  assert.equal(chat.draft, "why?");
});

test("asking clears both the draft and the quote", () => {
  const withBoth = reduce(reduce(EMPTY, { type: "quote", text: "q" }), { type: "draft", text: "why?" });
  const chat = reduce(withBoth, { type: "asked", turn: turn("> q\n\nwhy?", "q") });
  assert.equal(chat.draft, "");
  assert.equal(chat.quote, null);
  assert.equal(chat.pending?.quote, "q");
});

test("the wire question quotes every line, then a blank line, then the text", () => {
  assert.equal(composeQuestion("a\nb", "Why?"), "> a\n> b\n\nWhy?");
  assert.equal(composeQuestion(null, "Why?"), "Why?");
});

test("questionBody returns the typed part of a quoted question", () => {
  const q = composeQuestion("a\nb", "Why?");
  assert.equal(questionBody(turn(q, "a\nb")), "Why?");
  assert.equal(questionBody(turn("plain")), "plain");
});
