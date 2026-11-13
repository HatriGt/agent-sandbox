/**
 * Context compaction, end to end: Claude Code's compaction frames (recorded from CLI 2.1.285 —
 * status/compacting, compact_boundary, the synthetic summary, a zero-usage result) become ⟦compact⟧
 * and ⟦summary⟧ lines; the trace parser folds them into one `compact` event; the inbox delivers a
 * queued /compact as its own turn; the prefs carry the auto-compact setting into the run's env.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamFmtScript } from "../src/msb.ts";
import { parseTrace } from "../src/trace.ts";
import { deliveryBatchSize, Inbox, joinQueued, startInboxDelivery } from "../src/inbox.ts";
import { isCompactCommand } from "../src/drivers/sentinels.ts";
import { autoCompactEnv } from "../src/drivers/claude.ts";
import { normalizeAgentPrefs } from "../src/agent-kind.ts";
import type { WatchSnapshot } from "../src/monitor.ts";

function formatterSource(): string {
  const b64 = streamFmtScript().match(/printf '%s' '([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(b64, "install command must carry a base64 payload");
  return Buffer.from(b64!, "base64").toString("utf8");
}

function runFormatter(events: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "compactfmt-"));
  const script = join(dir, "stream-fmt.js");
  const log = join(dir, "agent.log");
  writeFileSync(script, formatterSource());
  execFileSync(process.execPath, [script, log], { input: events.map((e) => JSON.stringify(e)).join("\n") + "\n" });
  return readFileSync(log, "utf8");
}

const usage0 = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
const manualCompact = [
  { type: "system", subtype: "init", model: "claude-sonnet-4-6" },
  { type: "system", subtype: "status", status: "compacting" },
  { type: "system", subtype: "status", status: null, compact_result: "success" },
  { type: "system", subtype: "init", model: "claude-sonnet-4-6" },
  { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 27445, post_tokens: 1192, duration_ms: 15550 } },
  {
    type: "user",
    isSynthetic: true,
    message: {
      role: "user",
      content: "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\nThe user asked for ⟦you⟧ an exact reply, which was given.",
    },
  },
  { type: "user", isReplay: true, message: { role: "user", content: "<local-command-stdout>Compacted </local-command-stdout>" } },
  { type: "result", num_turns: 0, result: "", usage: usage0, modelUsage: { "claude-sonnet-4-6": { contextWindow: 200000 } } },
];

test("the formatter writes a manual compaction as compact lines plus its summary, and no zero usage", () => {
  const log = runFormatter(manualCompact);
  const lines = log.split("\n");
  assert.equal(lines.filter((l) => l.startsWith("● session started")).length, 1, "the post-compaction re-init is not a second session");
  assert.match(log, /^⟦compact⟧ \d{13} start$/m);
  assert.match(log, /^⟦compact⟧ \d{13} done trigger=manual pre=27445 post=1192 dur=15550$/m);
  assert.match(log, /^⟦summary⟧\nThe user asked for ​⟦you⟧ an exact reply, which was given\.\n⟦\/summary⟧$/m, "summary kept, its preface dropped, sentinels in it defanged");
  assert.doesNotMatch(log, /local-command-stdout/);
  assert.doesNotMatch(log, /⟦usage⟧/, "a compaction-only turn writes no 0-token usage line");
});

test("auto-compaction mid-turn resets the context footprint and the usage line carries the window", () => {
  const log = runFormatter([
    { type: "system", subtype: "init", model: "m" },
    { type: "assistant", message: { content: [{ type: "text", text: "working" }], usage: { input_tokens: 5, cache_read_input_tokens: 170000, output_tokens: 10 } } },
    { type: "system", subtype: "status", status: "compacting" },
    { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 170015, post_tokens: 9000, duration_ms: 20000 } },
    { type: "result", num_turns: 3, result: "working", usage: { input_tokens: 10, cache_read_input_tokens: 300000, output_tokens: 50 }, modelUsage: { m: { contextWindow: 200000 } } },
  ]);
  assert.match(log, /^⟦compact⟧ \d{13} done trigger=auto pre=170015 post=9000 dur=20000$/m);
  assert.match(log, /^⟦usage⟧ in=300010 out=50 ctx=9000 win=200000$/m);
  const c = parseTrace(log).find((e) => e.kind === "compact");
  assert.ok(c?.kind === "compact" && c.trigger === "auto" && c.state === "done" && c.postTokens === 9000);
});

test("a failed compaction is written with its reason", () => {
  const log = runFormatter([
    { type: "system", subtype: "status", status: "compacting" },
    { type: "system", subtype: "status", status: null, compact_result: "failed", compact_error: "Not enough messages\nto compact." },
  ]);
  assert.match(log, /^⟦compact⟧ \d{13} failed Not enough messages to compact\.$/m);
});

test("the parser folds start + done + summary into one compact event", () => {
  const ev = parseTrace(runFormatter(manualCompact)).filter((e) => e.kind === "compact");
  assert.equal(ev.length, 1);
  const c = ev[0];
  assert.ok(c.kind === "compact");
  assert.equal(c.state, "done");
  assert.equal(c.trigger, "manual");
  assert.equal(c.preTokens, 27445);
  assert.equal(c.postTokens, 1192);
  assert.equal(c.ms, 15550);
  assert.match(c.summary ?? "", /exact reply/);
  assert.ok(typeof c.at === "number");
});

test("the parser: an unfinished compaction stays running, a failed one keeps its reason, old usage lines still parse", () => {
  const ev = parseTrace(["⟦compact⟧ 1700000000000 start", "⟦compact⟧ 1700000000001 start", "⟦compact⟧ 1700000000002 failed too short", "⟦usage⟧ in=1 out=2 ctx=3"].join("\n"));
  assert.deepEqual(
    ev.map((e) => (e.kind === "compact" ? `${e.state}:${e.error ?? ""}` : e.kind)),
    ["running:", "failed:too short", "usage"]
  );
  const u = ev[2];
  assert.ok(u.kind === "usage" && u.contextWindow === undefined);
  const w = parseTrace("⟦usage⟧ in=1 out=2 ctx=3 win=1000000")[0];
  assert.ok(w.kind === "usage" && w.contextWindow === 1_000_000);
});

test("isCompactCommand: only /compact as the whole command, with or without instructions", () => {
  assert.ok(isCompactCommand("/compact"));
  assert.ok(isCompactCommand("  /compact keep the API decisions"));
  assert.ok(!isCompactCommand("/compacting"));
  assert.ok(!isCompactCommand("please /compact"));
});

const q = (id: string, text: string) => ({ id, text, at: 0 });

test("deliveryBatchSize: a /compact goes alone, in its place in the order", () => {
  assert.equal(deliveryBatchSize([]), 0);
  assert.equal(deliveryBatchSize([q("1", "a"), q("2", "b")]), 2);
  assert.equal(deliveryBatchSize([q("1", "a"), q("2", "/compact"), q("3", "b")]), 1);
  assert.equal(deliveryBatchSize([q("1", "/compact"), q("2", "b")]), 1);
});

test("inbox delivery: mail before a queued /compact, then the compact alone, then the rest", async () => {
  const inbox = new Inbox();
  inbox.enqueue("b", "first");
  inbox.enqueue("b", "/compact");
  inbox.enqueue("b", "second");
  inbox.enqueue("b", "third");
  const sent: string[] = [];
  const stop = startInboxDelivery({
    inbox,
    read: async () => ({ name: "b", boxStatus: "running", runState: "done", log: "" }) as WatchSnapshot,
    resume: async (_s, m) => void sent.push(m),
    intervalMs: 5,
  });
  await new Promise((r) => setTimeout(r, 60));
  stop();
  assert.deepEqual(sent, ["first", "/compact", joinQueued([q("3", "second"), q("4", "third")])]);
  assert.equal(inbox.list("b").length, 0);
});

test("auto-compact setting: validated, default not stored, and mapped to Claude Code's env", () => {
  assert.equal(normalizeAgentPrefs({ defaultAgent: "claude", autoCompact: "early" }).autoCompact, "early");
  assert.equal(normalizeAgentPrefs({ defaultAgent: "claude", autoCompact: "standard" }).autoCompact, undefined);
  assert.equal(normalizeAgentPrefs({ defaultAgent: "claude" }).autoCompact, undefined);
  assert.throws(() => normalizeAgentPrefs({ autoCompact: "sometimes" }), /autoCompact/);
  assert.deepEqual(autoCompactEnv(undefined), []);
  assert.deepEqual(autoCompactEnv("standard"), []);
  assert.deepEqual(autoCompactEnv("off"), ["-e", "DISABLE_AUTO_COMPACT=1"]);
  assert.deepEqual(autoCompactEnv("early"), ["-e", "CLAUDE_CODE_AUTO_COMPACT_WINDOW=133000"]);
});
