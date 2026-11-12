/**
 * Tags inside a message: several `/skill` and `@file` tags, each where the person put it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineTokens, insertToken, removeToken, splitTokens, tokenEndingAt } from "../web/src/lib/inline-tokens.ts";
import { parseYouMessage } from "../web/src/lib/you-message.ts";

const skills = new Set(["review-pr", "deploy"]);

test("finds several skills and files in the order they were written", () => {
  const text = "Check /review-pr, use it on @src/app.ts and then /deploy (see @infra/app.yaml).";
  assert.deepEqual(
    inlineTokens(text, skills).map((t) => [t.kind, t.name, text.slice(t.start, t.end)]),
    [
      ["skill", "review-pr", "/review-pr"],
      ["file", "src/app.ts", "@src/app.ts"],
      ["skill", "deploy", "/deploy"],
      ["file", "infra/app.yaml", "@infra/app.yaml"],
    ]
  );
});

test("a slash word that is not a skill, a path and an email stay prose", () => {
  assert.deepEqual(inlineTokens("look in /tmp and /etc/hosts, mail a@b.co, run /deployx", skills), []);
  assert.deepEqual(inlineTokens("/deploy now", null), []);
});

test("the full stop after a path belongs to the sentence", () => {
  const t = inlineTokens("open @src/a.ts.", skills)[0];
  assert.equal(t.name, "src/a.ts");
});

test("insertToken spaces the tag from its neighbours and parks the caret after it", () => {
  assert.deepEqual(insertToken("use /rev", 4, 8, "/review-pr"), { value: "use /review-pr ", caret: 15 });
  assert.deepEqual(insertToken("use this", 3, 3, "/deploy"), { value: "use /deploy this", caret: 12 });
  assert.deepEqual(insertToken("", 0, 0, "@a.ts"), { value: "@a.ts ", caret: 6 });
  assert.deepEqual(insertToken("see (@a", 5, 7, "@a.ts"), { value: "see (@a.ts ", caret: 11 });
});

test("removeToken takes the tag and the space after it", () => {
  const text = "use /deploy this";
  const t = inlineTokens(text, skills)[0];
  assert.deepEqual(removeToken(text, t), { value: "use this", caret: 4 });
  assert.equal(tokenEndingAt(inlineTokens(text, skills), 11)?.name, "deploy");
  assert.equal(tokenEndingAt(inlineTokens(text, skills), 10), null);
});

test("splitTokens gives back the whole message", () => {
  const text = "a /deploy b @x.ts";
  const parts = splitTokens(text, inlineTokens(text, skills));
  assert.equal(parts.map((p) => p.text).join(""), text);
  assert.equal(parts.filter((p) => "token" in p).length, 2);
});

test("a delivered message keeps its inline tags in the body", () => {
  const sent = "Check /review-pr on @src/a.ts then /deploy\n\nReferenced files (under /workspace): /workspace/src/a.ts";
  assert.deepEqual(parseYouMessage(sent), { body: "Check /review-pr on @src/a.ts then /deploy", skill: null, files: [] });
});
