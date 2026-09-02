/**
 * `/skill` token detection anywhere in the message (not only at the start), plus the helpers that
 * strip a picked token and detect a hand-typed complete one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { slashAt, stripSlashToken, typedSkillToken } from "../web/src/lib/slash.ts";

test("slash at the start of the message opens with the typed query", () => {
  assert.deepEqual(slashAt("/dep", 4), { start: 0, query: "dep" });
  assert.deepEqual(slashAt("/", 1), { start: 0, query: "" });
});

test("slash mid-message after whitespace opens", () => {
  const v = "please run /dep";
  assert.deepEqual(slashAt(v, v.length), { start: 11, query: "dep" });
  const nl = "line one\n/rev";
  assert.deepEqual(slashAt(nl, nl.length), { start: 9, query: "rev" });
});

test("mid-word and URL slashes never open", () => {
  assert.equal(slashAt("a/b", 3), null);
  const url = "see https://x.dev/mcp";
  assert.equal(slashAt(url, url.length), null);
});

test("a path's second segment never opens (query stops at the next slash)", () => {
  const v = "open /workspace/src";
  assert.equal(slashAt(v, v.length), null);
});

test("caret before the slash or after the token closes the menu", () => {
  const v = "run /deploy now";
  assert.equal(slashAt(v, 3), null); // caret in "run"
  assert.equal(slashAt(v, v.length), null); // caret in "now" — token ended
  assert.deepEqual(slashAt(v, 11), { start: 4, query: "deploy" }); // caret at token end
});

test("stripSlashToken removes the token and one joining space wherever it is", () => {
  assert.deepEqual(stripSlashToken("/dep fix the tests", 0), { value: "fix the tests", caret: 0 });
  assert.deepEqual(stripSlashToken("please /dep fix", 7), { value: "please fix", caret: 7 });
  assert.deepEqual(stripSlashToken("tail /dep", 5), { value: "tail ", caret: 5 });
});

test("typedSkillToken finds a completed /name token at start or mid-message", () => {
  assert.deepEqual(typedSkillToken("/deploy now"), { name: "deploy", start: 0, length: 8 });
  assert.deepEqual(typedSkillToken("please /rev this"), { name: "rev", start: 7, length: 5 });
  assert.equal(typedSkillToken("/deploy"), null); // not completed with whitespace yet
  assert.equal(typedSkillToken("a/b c"), null);
});
