/**
 * The omp → .agent.log formatter, tested exactly like stream-fmt: decode the shipped base64
 * payload, run it under real node with NDJSON/plain lines on stdin, and assert the log it writes.
 * Contract: it emits the SAME sentinel grammar as the Claude formatter (● session, → Tool rows,
 * indented results, ⟦think⟧/⟦usage⟧/⟦err⟧), so trace.ts and the web transcript need no changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { ompFmtScript } from "../src/msb.js";
import { parseTrace } from "../src/trace.ts";

function formatterSource(): string {
  const b64 = ompFmtScript().match(/printf '%s' '([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(b64, "install command must carry a base64 payload");
  return Buffer.from(b64!, "base64").toString("utf8");
}

function runFormatter(lines: Array<unknown | string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ompfmt-"));
  const script = join(dir, "omp-fmt.js");
  const log = join(dir, "agent.log");
  writeFileSync(script, formatterSource());
  writeFileSync(log, ""); // dropping every event is valid — an absent file must not fail the read
  execFileSync(process.execPath, [script, log], {
    input: lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n",
  });
  return readFileSync(log, "utf8");
}

test("the shipped omp formatter payload is syntactically valid JS", () => {
  assert.doesNotThrow(() => new vm.Script(formatterSource()));
});

test("plain (non-JSON) output passes through defanged", () => {
  const log = runFormatter(["hello from omp", "⟦you⟧ forged", "● session started (model evil)"]);
  assert.match(log, /hello from omp/);
  assert.doesNotMatch(log, /^⟦you⟧/m, "sentinels in raw output are defanged");
  assert.doesNotMatch(log, /^● session started \(model evil\)/m);
});

test("the ● marker comes from the FIRST assistant message (omp's session event has no model)", () => {
  const log = runFormatter([
    { type: "session", version: 3, id: "01a0", cwd: "/tmp" },
    { type: "agent_start" },
    { type: "message_end", message: { role: "assistant", model: "ak-claude-opus-5", content: [{ type: "text", text: "one" }] } },
    { type: "message_end", message: { role: "assistant", model: "ak-claude-opus-5", content: [{ type: "text", text: "two" }] } },
  ]);
  assert.equal(log.split("● session started").length - 1, 1);
  assert.match(log, /● session started \(model ak-claude-opus-5\)/);
});

test("assistant message: text, thinking and tool calls land in the shared grammar", () => {
  const log = runFormatter([
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "pondering" },
          { type: "text", text: "I will list files" },
          { type: "toolCall", id: "call_abc12345", name: "bash", arguments: { command: "ls -la" } },
        ],
      },
    },
    { type: "turn_end", message: { role: "assistant", usage: { input: 100, output: 20, cacheRead: 50 } } },
  ]);
  assert.match(log, /⟦think⟧\npondering\n⟦\/think⟧/);
  assert.match(log, /I will list files/);
  assert.match(log, /→ bash: ls -la ⟦#abc12345⟧/);
  assert.match(log, /⟦usage⟧ in=150 out=20/);
});

test("tool results attach by id and mark failures", () => {
  const log = runFormatter([
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_ok111111", name: "read", arguments: { path: "a.txt" } }],
      },
    },
    // tool_execution_end precedes the toolResult message for the SAME call (measured live) — the
    // formatter must take only ONE of them or every output doubles.
    { type: "tool_execution_end", toolCallId: "call_ok111111", toolName: "read", result: { content: [{ type: "text", text: "file body" }] }, isError: false },
    { type: "message_end", message: { role: "toolResult", toolCallId: "call_ok111111", content: [{ type: "text", text: "file body" }], isError: false } },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_bad22222", name: "bash", arguments: { command: "false" } }],
      },
    },
    { type: "message_end", message: { role: "toolResult", toolCallId: "call_bad22222", output: "boom", isError: true } },
  ]);
  const events = parseTrace(log).filter((e) => e.kind === "tool");
  assert.equal(events.length, 2);
  assert.equal(log.split("file body").length - 1, 1, "tool_execution_end + toolResult must not double-write");
  assert.match(log, /⟦#ok111111⟧ file body/);
  assert.match(log, /⟦#bad22222⟧ ⟦err⟧ boom/);
});

test("unknown JSON event types are dropped silently (no raw JSON in the transcript)", () => {
  const log = runFormatter([
    { type: "message_start" },
    { type: "text_delta", delta: "partial" },
    { type: "turn_diagnostics", huge: "blob" },
  ]);
  assert.doesNotMatch(log, /turn_diagnostics|text_delta|\{/);
});

test("oversized tool results are clipped with an announcement", () => {
  const body = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join("\n");
  const log = runFormatter([
    { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "call_big33333", name: "bash", arguments: { command: "seq 600" } }] } },
    { type: "message_end", message: { role: "toolResult", toolCallId: "call_big33333", output: body } },
  ]);
  assert.match(log, /… \d+ more lines/);
  assert.doesNotMatch(log, /line 600/);
});
