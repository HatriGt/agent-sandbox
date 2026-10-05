import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSequence } from "../web/src/lib/viz-extra.ts";
import { mermaidLabel, sequenceToMermaid } from "../web/src/lib/viz-mermaid.ts";

test("sequence → mermaid: aliased participants, replies, loop wraps exactly its rows", () => {
  const seq = parseSequence(
    [
      "Client -> dealmgmt-srv: POST /statisticallyBook",
      "dealmgmt-srv --> Client: 202 accepted",
      "loop until no Pending rows",
      "Client -> dealmgmt-srv: GET booking history",
      "dealmgmt-srv --> Client: rows (Pending/Booked/Failed)",
      "end",
    ].join("\n")
  )!;
  assert.equal(
    sequenceToMermaid(seq),
    [
      "sequenceDiagram",
      "  participant p0 as Client",
      "  participant p1 as dealmgmt-srv",
      "  p0->>p1: POST /statisticallyBook",
      "  p1-->>p0: 202 accepted",
      "  loop until no Pending rows",
      "    p0->>p1: GET booking history",
      "    p1-->>p0: rows (Pending/Booked/Failed)",
      "  end",
    ].join("\n")
  );
});

test("sequence → mermaid: nested blocks close inner first, notes, bare opt keyword", () => {
  const seq = parseSequence("A -> B: x\nopt\nloop retry\nB --> A: y\nend\nnote over A: done\nend\nA -> B: z")!;
  assert.equal(
    sequenceToMermaid(seq),
    [
      "sequenceDiagram",
      "  participant p0 as A",
      "  participant p1 as B",
      "  p0->>p1: x",
      "  opt",
      "    loop retry",
      "      p1-->>p0: y",
      "    end",
      "    Note over p0: done",
      "  end",
      "  p0->>p1: z",
    ].join("\n")
  );
});

test("mermaid labels drop statement-breaking characters and cap length", () => {
  assert.equal(mermaidLabel("a; b # c: d"), "a b c d");
  assert.equal(mermaidLabel("x".repeat(100), 10), "xxxxxxxxx…");
  // an injected statement cannot escape its message line
  const seq = parseSequence("A -> B: hi;\nB -> A: ok")!;
  assert.ok(!sequenceToMermaid(seq).includes(";"));
});
