import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDag, parseFindings, parseSequence, parseSteps } from "../web/src/lib/viz-extra.ts";
import { parseMermaidFlow, procedureFromItems } from "../web/src/lib/viz-auto.ts";
import { tidyFence } from "../web/src/lib/viz.ts";

test("graph: edge labels and node shapes", () => {
  const d = parseDag("(Start) -> {Has BPs?} -|yes|-> Select docs -> ((End))\n{Has BPs?} -> ((End)): no")!;
  assert.deepEqual(d.nodes, ["Start", "Has BPs?", "Select docs", "End"]);
  assert.deepEqual(d.kinds, ["terminal", "decision", "step", "terminal"]);
  assert.deepEqual(d.labels, [undefined, "yes", undefined, "no"]);
  assert.deepEqual(d.layers, [0, 1, 2, 3]);
  assert.equal(parseDag("A -> B -> A"), null);
  // the plain form carries neither labels nor kinds
  const plain = parseDag("A -> B\nB -> C")!;
  assert.equal(plain.labels, undefined);
  assert.equal(plain.kinds, undefined);
});

test("mermaid flowchart keeps -->|label| and {decision} / ((terminal)) shapes", () => {
  const f = parseMermaidFlow("graph LR\n  A[Checkout] --> B{Decision}\n  B -->|yes| C((Deploy))\n  B -->|no| A")!;
  assert.deepEqual(f.edges, [["Checkout", "Decision"], ["Decision", "Deploy"], ["Decision", "Checkout"]]);
  assert.deepEqual(f.labels, [undefined, "yes", "no"]);
  assert.deepEqual(f.kinds, { Decision: "decision", Deploy: "terminal" });
  assert.equal(parseMermaidFlow("sequenceDiagram\n  A->>B: hi"), null);
});

test("sequence: participants, replies, notes, loop blocks, actor cap", () => {
  const s = parseSequence(
    [
      "participant UI",
      "participant API",
      "UI -> API: GET /items",
      "note over API: checks cache",
      "loop per page",
      "API ->> DB: select batch",
      "DB -->> API: rows",
      "end",
      "API --> UI: 200 OK",
    ].join("\n")
  )!;
  assert.deepEqual(s.actors, ["UI", "API", "DB"]);
  assert.deepEqual(s.items, [
    { kind: "msg", from: 0, to: 1, text: "GET /items", reply: false },
    { kind: "note", actor: 1, text: "checks cache" },
    { kind: "msg", from: 1, to: 2, text: "select batch", reply: false },
    { kind: "msg", from: 2, to: 1, text: "rows", reply: true },
    { kind: "block", label: "per page", start: 2, end: 3 },
    { kind: "msg", from: 1, to: 0, text: "200 OK", reply: true },
  ]);
  const many = Array.from({ length: 9 }, (_, i) => `A${i} -> A${(i + 1) % 9}: m`).join("\n");
  assert.equal(parseSequence(many), null);
  assert.equal(parseSequence("A -> B: x\nnot a message"), null);
  assert.equal(parseSequence("loop x\nA -> B: y"), null, "unclosed block");
});

test("findings: three line shapes; a line without a severity rejects the fence", () => {
  const f = parseFindings("high | zcl_x.abap:120 | unbounded SELECT\n[medium] GET_OPEN_ITEMS — N+1 reads\nlow: naming")!;
  assert.deepEqual(f, [
    { severity: "high", where: "zcl_x.abap:120", text: "unbounded SELECT" },
    { severity: "medium", where: "GET_OPEN_ITEMS", text: "N+1 reads" },
    { severity: "low", text: "naming" },
  ]);
  assert.equal(parseFindings("high: a\nsomething else entirely"), null);
  assert.equal(parseFindings("critical | x")?.[0].severity, "high");
});

test("steps: marked lists keep todo, unmarked lists are plain procedures with nested sub-steps", () => {
  assert.deepEqual(parseSteps("1. Clone ✓\n2. Build …\n3. Deploy")!.map((s) => s.state), ["done", "active", "todo"]);
  const plain = parseSteps("1. Exit early when no BPs\n2. Select documents\n  - open items only\n  - in batches of 500\n3. Group by contract")!;
  assert.deepEqual(plain.map((s) => s.state), ["plain", "plain", "plain"]);
  assert.equal(plain[1].detail, "open items only\nin batches of 500");
  // the lenient tidier must not promote indented bullets to top-level steps
  assert.deepEqual(parseSteps(tidyFence("steps", "- Exit early\n  - when no BPs\n- Select docs"))!.map((s) => [s.title, s.detail]), [["Exit early", "when no BPs"], ["Select docs", undefined]]);
});

test("procedureFromItems: imperative walkthroughs upgrade, noun lists and short lists do not", () => {
  const abap = [
    "Exits early when no business partners are supplied",
    "Selects the premium documents for those partners",
    "Reads open items in batches via GET_OPEN_ITEMS",
    "Groups the items by contract",
    "Computes the receivable per group",
    "Filters out groups below the threshold",
  ];
  assert.deepEqual(procedureFromItems(abap)!.map((s) => s.state), ["plain", "plain", "plain", "plain", "plain", "plain"]);
  assert.equal(procedureFromItems(["Apples", "Oranges", "Bananas", "Pears"]), null);
  assert.equal(procedureFromItems(["Read a", "Check b", "Run c"]), null);
});
