import { test } from "node:test";
import assert from "node:assert/strict";
import { progressFromItems, tableWorthRich, toolOutputLanguage } from "../web/src/lib/viz-tool-output";

test("toolOutputLanguage: json, bare, and raw gates", () => {
  assert.equal(toolOutputLanguage('{"a":1}'), "json");
  assert.equal(toolOutputLanguage("[1,2]\n"), "json");
  assert.equal(toolOutputLanguage("{not json"), "");
  assert.equal(toolOutputLanguage("a,b\n1,2"), "");
  assert.equal(toolOutputLanguage("a,b\n1,2", { live: true }), null);
  assert.equal(toolOutputLanguage(""), null);
  assert.equal(toolOutputLanguage(undefined), null);
  assert.equal(toolOutputLanguage("x\n".repeat(201)), null);
  assert.equal(toolOutputLanguage("x".repeat(20_001)), null);
});

test("progressFromItems: every item a percent or ratio", () => {
  const rows = progressFromItems(["**Auth**: 80%", "Billing: 3/4"]);
  assert.equal(rows?.length, 2);
  assert.equal(rows?.[0].label, "Auth");
  assert.equal(rows?.[1].frac, 0.75);
  assert.equal(progressFromItems(["Auth: 80%"]), null);
  assert.equal(progressFromItems(["Auth: 80%", "Billing: soon"]), null);
  assert.equal(progressFromItems(null), null);
});

test("tableWorthRich: two rows need a numeric column", () => {
  assert.equal(tableWorthRich([["a", "1"], ["b", "2.5%"]]), true);
  assert.equal(tableWorthRich([["a", "x"], ["b", "y"]]), false);
  assert.equal(tableWorthRich([["a"]]), false);
  assert.equal(tableWorthRich([["a"], ["b"], ["c"]]), true);
});
