// Outline extraction over CodeMirror syntax trees, per language, plus the "@" filter.
// Run from web/:  npx --yes tsx --tsconfig tsconfig.json --test src/lib/symbols.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, type Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { matchSymbols, symbolsIn, type CodeSymbol } from "./symbols";

const outline = (doc: string, ext: Extension) => symbolsIn(EditorState.create({ doc, extensions: ext }));
const brief = (s: CodeSymbol) => `${"  ".repeat(s.depth)}${s.kind} ${s.name}@${s.line}`;

test("typescript: functions, classes, members, types and bindings, nested by declaration", () => {
  const src = [
    "export const BUCKETS = 6;",
    "const { a, b: [c] } = read();",
    "export type Window = { size: number };",
    "interface Options {",
    "  limit: number;",
    "  take(n: number): void;",
    "}",
    "enum Mode { Fast }",
    "export function rateLimit(limit: number) {",
    "  const slice = limit / BUCKETS;",
    "  return slice;",
    "}",
    "class TokenBucket {",
    "  private hits = 0;",
    "  take(n = 1): boolean { return this.hits++ < n; }",
    "}",
    "export const parseKey = (ip: string) => `rl:${ip}`;",
  ].join("\n");
  const got = outline(src, javascript({ typescript: true })).map(brief);
  assert.deepEqual(got, [
    "variable BUCKETS@1",
    "variable a@2",
    "variable c@2",
    "type Window@3",
    "  property size@3",
    "interface Options@4",
    "  property limit@5",
    "  method take@6",
    "enum Mode@8",
    "function rateLimit@9",
    "  variable slice@10",
    "class TokenBucket@13",
    "  property hits@14",
    "  method take@15",
    "function parseKey@17",
  ]);
  const take = symbolsIn(EditorState.create({ doc: src, extensions: javascript({ typescript: true }) })).find((s) => s.kind === "method" && s.line === 15)!;
  assert.equal(src.slice(take.from, take.to), "take", "from/to span exactly the name");
});

test("python: defs and classes, a def inside a class is a method", () => {
  const src = ["def limit(n):", "    def inner():", "        pass", "    return n", "", "class Bucket:", "    def take(self):", "        pass", ""].join("\n");
  assert.deepEqual(outline(src, python()).map(brief), ["function limit@1", "  function inner@2", "class Bucket@6", "  method take@7"]);
});

test("markdown: headings nest by level and names drop the marks", () => {
  const src = ["Title", "=====", "", "## Install ##", "", "### Steps", "", "# Usage"].join("\n");
  assert.deepEqual(outline(src, markdown()).map(brief), ["heading Title@1", "  heading Install@4", "    heading Steps@6", "heading Usage@8"]);
});

test("json: keys without their quotes, nested by object", () => {
  assert.deepEqual(outline('{ "name": "x", "scripts": { "build": "tsc" } }', json()).map(brief), ["key name@1", "key scripts@1", "  key build@1"]);
});

test("a grammar without a tree yields nothing", () => {
  assert.deepEqual(outline("foo() { echo hi; }", StreamLanguage.define(shell)), []);
});

test("matching: prefix, then substring, then subsequence, ties in document order", () => {
  const syms = outline("function parseKey() {}\nfunction keyOf() {}\nfunction poke() {}\nfunction other() {}", javascript()).map((s) => s);
  assert.deepEqual(matchSymbols(syms, "key").map((s) => s.name), ["keyOf", "parseKey"]);
  assert.deepEqual(matchSymbols(syms, "pk").map((s) => s.name), ["parseKey", "poke"]);
  assert.deepEqual(matchSymbols(syms, "").map((s) => s.name), ["parseKey", "keyOf", "poke", "other"]);
  assert.deepEqual(matchSymbols(syms, "zzz"), []);
});
