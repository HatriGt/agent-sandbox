/**
 * The trace-ground colorizers: JSON tokenizing (lossless — tokens reassemble to the input) and
 * terminal line classification.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { outputStats, termLineKind, tokenizeJson } from "../web/src/lib/highlight.ts";

test("tokenizeJson is lossless and tells keys from string values", () => {
  const src = '{\n  "name": "hana-qa",\n  "rows": 42,\n  "ok": true,\n  "note": null\n}';
  const toks = tokenizeJson(src);
  assert.equal(toks.map((t) => t.text).join(""), src);
  const kinds = new Map(toks.filter((t) => t.kind !== "ws" && t.kind !== "punct").map((t) => [t.text, t.kind]));
  assert.equal(kinds.get('"name"'), "key");
  assert.equal(kinds.get('"hana-qa"'), "string");
  assert.equal(kinds.get("42"), "number");
  assert.equal(kinds.get("true"), "bool");
  assert.equal(kinds.get("null"), "null");
});

test("tokenizeJson survives escapes and non-JSON garbage losslessly", () => {
  for (const src of ['{"a": "x \\"quoted\\" y"}', "not json at all { unbalanced", ""]) {
    assert.equal(tokenizeJson(src).map((t) => t.text).join(""), src);
  }
});

test("termLineKind classifies the obvious lines", () => {
  assert.equal(termLineKind("Error: connect ECONNREFUSED"), "error");
  assert.equal(termLineKind("npm WARN deprecated pkg@1"), "warn");
  assert.equal(termLineKind("✓ 480 tests passed"), "ok");
  assert.equal(termLineKind("+ added line"), "add");
  assert.equal(termLineKind("- removed line"), "del");
  assert.equal(termLineKind("    at Object.<anonymous> (/app/x.js:3:1)"), "path");
  assert.equal(termLineKind("src/http.ts:1325: match"), "path");
  assert.equal(termLineKind("hello world"), "plain");
});

test("outputStats counts errors and warnings for the fold label", () => {
  const out = ["ok line", "Error: boom", "npm WARN old", "fatal: nope", ""].join("\n");
  assert.deepEqual(outputStats(out), { errors: 2, warns: 1 });
  assert.deepEqual(outputStats("all clean"), { errors: 0, warns: 0 });
});

test("diff markers beat word matches; +++/--- headers are not add/del", () => {
  assert.equal(termLineKind("- warning fixed"), "del");
  assert.equal(termLineKind("+++ b/file.ts"), "plain");
  assert.equal(termLineKind("--- a/file.ts"), "plain");
});
