import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnnotate, parseCompare, parseLayers } from "../web/src/lib/viz-extra.ts";

test("compare: options, pick marker stripped from the name, pro/con/note tones", () => {
  const c = parseCompare("## Postgres (recommended)\n+ mature, transactional\n- ops overhead\n## SQLite\n+ zero ops\n~ fine for one box\nsingle file");
  assert.deepEqual(
    c?.map((o) => [o.name, o.picked]),
    [
      ["Postgres", true],
      ["SQLite", false],
    ]
  );
  assert.deepEqual(c?.[0].items, [
    { tone: "pro", text: "mature, transactional" },
    { tone: "con", text: "ops overhead" },
  ]);
  assert.deepEqual(c?.[1].items.map((i) => i.tone), ["pro", "note", "note"]);
  assert.deepEqual(parseCompare("## A ★\n## B")?.map((o) => [o.name, o.picked]), [["A", true], ["B", false]]);
});

test("compare: 2 and 6 options accepted; 1, 7, preamble text, or two picks rejected", () => {
  const opts = (n: number) => Array.from({ length: n }, (_, i) => `## O${i}\n+ x`).join("\n");
  assert.equal(parseCompare(opts(2))?.length, 2);
  assert.equal(parseCompare(opts(6))?.length, 6);
  assert.equal(parseCompare(opts(1)), null);
  assert.equal(parseCompare(opts(7)), null);
  assert.equal(parseCompare("intro\n## A\n## B"), null);
  assert.equal(parseCompare("## A (recommended)\n## B ★"), null);
  // A markdown list with `+`/`-` bullets but no option headings is not a comparison.
  assert.equal(parseCompare("+ fast\n- costly"), null);
});

test("annotate: file header sets path + numbering; ranges; out-of-range notes dropped, ends clamped", () => {
  const a = parseAnnotate("file: src/x.ts:40\nif (!user) return;\nconst id = user.id;\nsave(id);\n---\nL40: guard\n41-42: persist\n43: past the end\nL39: before the start\n42-99: clamped");
  assert.equal(a?.file, "src/x.ts");
  assert.equal(a?.startLine, 40);
  assert.equal(a?.code, "if (!user) return;\nconst id = user.id;\nsave(id);");
  assert.deepEqual(a?.notes, [
    { from: 40, to: 40, text: "guard" },
    { from: 41, to: 42, text: "persist" },
    { from: 42, to: 42, text: "clamped" },
  ]);
});

test("annotate: no header → 1-based; the LAST `---` splits so code may contain its own", () => {
  const a = parseAnnotate("a\n---\nb\n---\nL3: third line");
  assert.equal(a?.file, undefined);
  assert.equal(a?.startLine, 1);
  assert.equal(a?.code, "a\n---\nb");
  assert.deepEqual(a?.notes, [{ from: 3, to: 3, text: "third line" }]);
  assert.equal(parseAnnotate("file: x.ts\nfoo()\n---\n1: call")?.startLine, 1);
});

test("annotate: rejects no `---`, no code, prose after the split, or no surviving note", () => {
  assert.equal(parseAnnotate("const x = 1;\nL1: note"), null);
  assert.equal(parseAnnotate("---\nL1: note"), null);
  assert.equal(parseAnnotate("x\n---\nthis is just prose"), null);
  assert.equal(parseAnnotate("x\n---\nL5: outside"), null);
  assert.equal(parseAnnotate("x\n---\n4-2: backwards"), null);
});

test("layers: `name: items` per line, empty layer allowed; one line or a non-layer line rejected", () => {
  assert.deepEqual(parseLayers("UI: Thread, WorkspacePane\nAPI: /tree.json, /artifact\nStorage: sqlite\nKernel:"), [
    { name: "UI", items: ["Thread", "WorkspacePane"] },
    { name: "API", items: ["/tree.json", "/artifact"] },
    { name: "Storage", items: ["sqlite"] },
    { name: "Kernel", items: [] },
  ]);
  assert.equal(parseLayers("UI: Thread"), null);
  assert.equal(parseLayers("UI: Thread\njust a sentence"), null);
  assert.equal(parseLayers(Array.from({ length: 11 }, (_, i) => `L${i}: x`).join("\n")), null);
});
