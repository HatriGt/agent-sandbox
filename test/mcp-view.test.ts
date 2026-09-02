/**
 * The MCP card's pure half: wire-name parsing, per-server accent stability, and result-shape
 * analysis (table / kv / json / text) that turns JSON blobs into readable data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeResult, argIsCode, mcpSummary, parseMcpName, serverHue } from "../web/src/lib/mcp.ts";

test("parseMcpName splits server and tool, humanizes the label; local tools are null", () => {
  assert.deepEqual(parseMcpName("mcp__hana-qa__execute_sql"), { server: "hana-qa", tool: "execute_sql", label: "execute sql" });
  assert.deepEqual(parseMcpName("mcp__atlassian.rovo__get-issue")?.server, "atlassian.rovo");
  assert.equal(parseMcpName("Bash"), null);
  assert.equal(parseMcpName("mcp__broken"), null);
});

test("serverHue is stable and in range", () => {
  assert.equal(serverHue("hana-qa"), serverHue("hana-qa"));
  assert.notEqual(serverHue("hana-qa"), serverHue("atlassian-rovo-mcp"));
  const h = serverHue("anything");
  assert.ok(h >= 0 && h < 360);
});

test("an array of flat objects becomes a table with union columns and a total", () => {
  const v = analyzeResult(JSON.stringify([{ a: 1, b: "x" }, { a: 2, c: null }]));
  assert.equal(v.kind, "table");
  if (v.kind === "table") {
    assert.deepEqual(v.columns, ["a", "b", "c"]);
    assert.equal(v.total, 2);
    assert.deepEqual(v.rows[1], ["2", "", ""]);
    assert.equal(mcpSummary(v), "2 rows");
  }
});

test("the MCP content envelope is unwrapped before classifying", () => {
  const inner = JSON.stringify([{ id: 7 }]);
  const v = analyzeResult(JSON.stringify({ content: [{ type: "text", text: inner }] }));
  assert.equal(v.kind, "table");
  const plain = analyzeResult(JSON.stringify({ content: [{ type: "text", text: "all good" }] }));
  assert.deepEqual(plain, { kind: "text", text: "all good" });
});

test("a small flat object is a kv grid; deep or large objects fall back to pretty JSON", () => {
  const kv = analyzeResult(JSON.stringify({ status: "ok", count: 3 }));
  assert.equal(kv.kind, "kv");
  if (kv.kind === "kv") assert.equal(mcpSummary(kv), "2 fields");
  const deep = analyzeResult(JSON.stringify({ nested: { a: 1 } }));
  assert.equal(deep.kind, "json");
});

test("non-JSON is text with a first-line summary; empty is empty", () => {
  const v = analyzeResult("Connection OK\nlatency 12ms");
  assert.equal(v.kind, "text");
  assert.equal(mcpSummary(v), "Connection OK");
  assert.deepEqual(analyzeResult(""), { kind: "empty" });
  assert.deepEqual(analyzeResult("[]"), { kind: "empty" });
});

test("argIsCode: SQL, JSON, and multiline args get the mono block", () => {
  assert.equal(argIsCode("SELECT * FROM T"), true);
  assert.equal(argIsCode('{"query": 1}'), true);
  assert.equal(argIsCode("line1\nline2"), true);
  assert.equal(argIsCode("PROJ-123"), false);
  assert.equal(argIsCode(undefined), false);
});
