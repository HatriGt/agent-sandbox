/**
 * WS4 — secret redaction INSIDE the box, at log-write time.
 *
 * The controller already redacts everything it serves (src/redact.ts), but .agent.log itself sits
 * in the agent-readable workspace with secrets verbatim: a token that leaked into tool output
 * (an env dump, a verbose build log) persisted in the box's own filesystem. The stream formatter
 * now applies the same SHAPE redaction as the controller before a line is written, so the on-disk
 * log never holds a recognizable credential. Serialized from src/redact.ts SHAPES so box and
 * controller agree (the guard.ts pattern).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamFmtScript } from "../src/msb.ts";
import { redactShapes } from "../src/redact.ts";

function formatterSource(): string {
  const b64 = streamFmtScript().match(/printf '%s' '([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(b64, "install command must carry a base64 payload");
  return Buffer.from(b64!, "base64").toString("utf8");
}

function runFormatter(events: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "streamredact-"));
  const script = join(dir, "stream-fmt.js");
  const log = join(dir, "agent.log");
  writeFileSync(script, formatterSource());
  execFileSync(process.execPath, [script, log], {
    input: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  });
  return readFileSync(log, "utf8");
}

const GHP = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"; // classic-PAT shape, synthetic

test("a GitHub token in tool output never reaches the on-disk log", () => {
  const log = runFormatter([
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "env" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: `GH_TOKEN=${GHP}` }] } },
  ]);
  assert.ok(!log.includes(GHP), "raw token must not be written");
  assert.match(log, /GH_TOKEN=/, "the line itself survives, value redacted");
});

test("a token in assistant prose is redacted too", () => {
  const log = runFormatter([
    { type: "assistant", message: { content: [{ type: "text", text: `found ${GHP} in the config` }] } },
  ]);
  assert.ok(!log.includes(GHP));
});

test("in-box redaction matches the controller's shape redaction", () => {
  // Same SHAPES source ⇒ same result: what the controller would redact, the box already has.
  const sample = `Bearer abcdefghijklmnopqrstuvwx1234 and sk-ant-abcdefghijklmnop1234567890`;
  const log = runFormatter([
    { type: "assistant", message: { content: [{ type: "text", text: sample }] } },
  ]);
  const expected = redactShapes(sample);
  assert.ok(log.includes(expected.trim()), `log should contain controller-style redaction\nlog: ${log}\nexpected fragment: ${expected}`);
});

test("ordinary output is untouched", () => {
  const log = runFormatter([
    { type: "assistant", message: { content: [{ type: "text", text: "npm test passed with 42 assertions" }] } },
  ]);
  assert.match(log, /npm test passed with 42 assertions/);
});
