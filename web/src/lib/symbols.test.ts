// Outline extraction over CodeMirror syntax trees, per language, plus the "@" filter and "@:" grouping.
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
import { groupSymbols, matchSymbols, symbolAt, symbolsIn, type CodeSymbol } from "./symbols";

const outline = (doc: string, ext: Extension) => symbolsIn(EditorState.create({ doc, extensions: ext }));
const brief = (s: CodeSymbol) => `${"  ".repeat(s.depth)}${s.kind} ${s.name}@${s.line}`;
const names = (ms: ReturnType<typeof matchSymbols>) => ms.map((m) => m.symbol.name);

const TS = [
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

test("typescript: functions, classes, members, types and bindings, nested by declaration", () => {
  const got = outline(TS, javascript({ typescript: true })).map(brief);
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
  const take = outline(TS, javascript({ typescript: true })).find((s) => s.kind === "method" && s.line === 15)!;
  assert.equal(TS.slice(take.from, take.to), "take", "from/to span exactly the name");
});

test("container names: a member names its class or function, a top-level symbol none", () => {
  const syms = outline(TS, javascript({ typescript: true }));
  const container = (name: string, line: number) => syms.find((s) => s.name === name && s.line === line)?.containerName;
  assert.equal(container("take", 15), "TokenBucket");
  assert.equal(container("hits", 14), "TokenBucket");
  assert.equal(container("slice", 10), "rateLimit");
  assert.equal(container("limit", 5), "Options");
  assert.equal(container("size", 3), "Window");
  assert.equal(container("rateLimit", 9), undefined);
  assert.equal(container("BUCKETS", 1), undefined);
});

test("range spans the whole declaration and symbolAt picks the innermost one under the caret", () => {
  const syms = outline(TS, javascript({ typescript: true }));
  const rateLimit = syms.find((s) => s.name === "rateLimit")!;
  assert.equal(rateLimit.line, 9);
  assert.equal(rateLimit.endLine, 12, "a function's range ends at its closing brace");
  assert.equal(TS.slice(rateLimit.range.from, rateLimit.range.to).startsWith("function rateLimit"), true);
  const insideReturn = TS.indexOf("return slice");
  assert.equal(syms[symbolAt(syms, insideReturn)].name, "rateLimit", "the body line belongs to the function");
  const insideSlice = TS.indexOf("limit / BUCKETS");
  assert.equal(syms[symbolAt(syms, insideSlice)].name, "slice", "a local's initializer belongs to the local, the innermost");
  const insideTake = TS.indexOf("this.hits++");
  assert.equal(syms[symbolAt(syms, insideTake)].name, "take");
  const gap = "const a = 1;\n\n// between\nconst b = 2;";
  assert.equal(symbolAt(outline(gap, javascript()), gap.indexOf("between")), -1, "a comment between declarations is in no symbol");
});

test("python: defs and classes, a def inside a class is a method", () => {
  const src = ["def limit(n):", "    def inner():", "        pass", "    return n", "", "class Bucket:", "    def take(self):", "        pass", ""].join("\n");
  const syms = outline(src, python());
  assert.deepEqual(syms.map(brief), ["function limit@1", "  function inner@2", "class Bucket@6", "  method take@7"]);
  assert.equal(syms[3].containerName, "Bucket");
  assert.equal(syms[1].containerName, "limit");
});

test("markdown: headings nest by level, names drop the marks, and no heading has a container", () => {
  const src = ["Title", "=====", "", "## Install ##", "", "### Steps", "", "# Usage"].join("\n");
  const syms = outline(src, markdown());
  assert.deepEqual(syms.map(brief), ["heading Title@1", "  heading Install@4", "    heading Steps@6", "heading Usage@8"]);
  assert.ok(syms.every((s) => s.containerName === undefined));
});

test("json: keys without their quotes, nested by object, a nested key names its parent", () => {
  const syms = outline('{ "name": "x", "scripts": { "build": "tsc" } }', json());
  assert.deepEqual(syms.map(brief), ["key name@1", "key scripts@1", "  key build@1"]);
  assert.equal(syms[2].containerName, "scripts");
});

test("a grammar without a tree yields nothing", () => {
  assert.deepEqual(outline("foo() { echo hi; }", StreamLanguage.define(shell)), []);
});

test("matching: prefix, then substring, then subsequence, ties in document order", () => {
  const syms = outline("function parseKey() {}\nfunction keyOf() {}\nfunction poke() {}\nfunction other() {}", javascript());
  assert.deepEqual(names(matchSymbols(syms, "key")), ["keyOf", "parseKey"]);
  assert.deepEqual(names(matchSymbols(syms, "pk")), ["parseKey", "poke"]);
  assert.deepEqual(names(matchSymbols(syms, "")), ["parseKey", "keyOf", "poke", "other"]);
  assert.deepEqual(matchSymbols(syms, "zzz"), []);
});

test("matching: positions mark the matched characters of each name", () => {
  const syms = outline("function parseKey() {}\nfunction keyOf() {}\nfunction poke() {}", javascript());
  const lit = (m: { symbol: CodeSymbol; positions: number[] }) => m.positions.map((p) => m.symbol.name[p]).join("");
  const key = matchSymbols(syms, "Key");
  assert.deepEqual(key.map((m) => [m.symbol.name, m.positions]), [
    ["keyOf", [0, 1, 2]],
    ["parseKey", [5, 6, 7]],
  ]);
  assert.deepEqual(key.map(lit), ["key", "Key"], "positions index the original name, case kept");
  const pk = matchSymbols(syms, "pk");
  assert.deepEqual(pk.map((m) => [m.symbol.name, m.positions]), [
    ["parseKey", [0, 5]],
    ["poke", [0, 2]],
  ]);
  assert.ok(matchSymbols(syms, "").every((m) => m.positions.length === 0), "an empty query highlights nothing");
});

test("@: groups by kind in VS Code's order, labels carry counts, members keep their order", () => {
  const all = matchSymbols(outline(TS, javascript({ typescript: true })), "");
  const groups = groupSymbols(all);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["classes (1)", "interfaces (1)", "functions (2)", "methods (2)", "variables (4)", "properties (3)", "enums (1)", "types (1)"]
  );
  assert.deepEqual(names(groups.find((g) => g.kind === "function")!.items), ["rateLimit", "parseKey"]);
  assert.deepEqual(names(groups.find((g) => g.kind === "variable")!.items), ["BUCKETS", "a", "c", "slice"]);
  const filtered = groupSymbols(matchSymbols(outline(TS, javascript({ typescript: true })), "take"));
  assert.deepEqual(filtered.map((g) => g.label), ["methods (2)"], "a query inside @: filters, empty groups drop out");
  assert.deepEqual(groupSymbols([]), []);
});
