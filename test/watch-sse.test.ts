import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLog, metaOf, isTerminal, sseFrame, meaningfulStateKey } from "../src/watch-sse.ts";
import type { WatchSnapshot } from "../src/monitor.ts";
import type { SnapshotMeta } from "../src/watch-sse.ts";

const baseMeta: SnapshotMeta = {
  name: "box-1",
  boxStatus: "running",
  runState: "running",
  task: "do a thing",
};

test("diffLog: unchanged log yields none", () => {
  const d = diffLog(10, "0123456789");
  assert.equal(d.kind, "none");
  assert.equal(d.chunk, "");
  assert.equal(d.offset, 10);
});

test("diffLog: grown log yields only the new tail as append", () => {
  const d = diffLog(5, "hello world");
  assert.equal(d.kind, "append");
  assert.equal(d.chunk, " world");
  assert.equal(d.offset, "hello world".length);
});

test("diffLog: from zero appends the whole log", () => {
  const d = diffLog(0, "abc");
  assert.equal(d.kind, "append");
  assert.equal(d.chunk, "abc");
  assert.equal(d.offset, 3);
});

test("diffLog: shrunk log resets wholesale (client replaces buffer)", () => {
  const d = diffLog(20, "short");
  assert.equal(d.kind, "reset");
  assert.equal(d.chunk, "short");
  assert.equal(d.offset, 5);
});

test("metaOf strips the log body but keeps state fields", () => {
  const snap: WatchSnapshot = {
    name: "box-1",
    boxStatus: "running",
    runState: "running",
    exitCode: undefined,
    task: "do a thing",
    question: undefined,
    uptime: "1m",
    cpu: "0.01 / 1c",
    mem: "80 MiB",
    log: "a very long log body",
  };
  const m = metaOf(snap);
  assert.equal("log" in m, false);
  assert.equal(m.name, "box-1");
  assert.equal(m.task, "do a thing");
  assert.equal(m.runState, "running");
});

test("isTerminal: done and idle are terminal; running/waiting are not", () => {
  assert.equal(isTerminal("done"), true);
  assert.equal(isTerminal("idle"), true);
  assert.equal(isTerminal("running"), false);
  assert.equal(isTerminal("waiting"), false);
});

test("sseFrame serialises event/id/data as a valid SSE frame", () => {
  const frame = sseFrame("append", { chunk: "hi" }, 42);
  assert.equal(frame, 'event: append\nid: 42\ndata: {"chunk":"hi"}\n\n');
});

test("sseFrame omits id when not provided", () => {
  const frame = sseFrame("snapshot", { a: 1 });
  assert.equal(frame, 'event: snapshot\ndata: {"a":1}\n\n');
});

test("meaningfulStateKey ignores uptime/cpu/mem churn (debounce)", () => {
  const a = meaningfulStateKey({ ...baseMeta, uptime: "1m", cpu: "0.01 / 1c", mem: "80 MiB" });
  const b = meaningfulStateKey({ ...baseMeta, uptime: "2m", cpu: "0.42 / 1c", mem: "120 MiB" });
  // Same run, only vitals ticked → identical key → no state frame emitted.
  assert.equal(a, b);
});

test("meaningfulStateKey changes when runState changes", () => {
  const running = meaningfulStateKey({ ...baseMeta, runState: "running" });
  const done = meaningfulStateKey({ ...baseMeta, runState: "done", exitCode: 0 });
  assert.notEqual(running, done);
});

test("meaningfulStateKey changes when the agent starts waiting on a question", () => {
  const running = meaningfulStateKey({ ...baseMeta, runState: "running" });
  const waiting = meaningfulStateKey({ ...baseMeta, runState: "waiting", question: "which env?" });
  assert.notEqual(running, waiting);
});

test("meaningfulStateKey changes when exit code changes", () => {
  const ok = meaningfulStateKey({ ...baseMeta, runState: "done", exitCode: 0 });
  const fail = meaningfulStateKey({ ...baseMeta, runState: "done", exitCode: 1 });
  assert.notEqual(ok, fail);
});

test("meaningfulStateKey changes when boxStatus changes", () => {
  const running = meaningfulStateKey({ ...baseMeta, boxStatus: "running" });
  const stopped = meaningfulStateKey({ ...baseMeta, boxStatus: "stopped" });
  assert.notEqual(running, stopped);
});

test("diffLog: a same-length or longer log that is not a prefix extension is a reset, not an append", async () => {
  
  // Sliding tail window: the first line fell off, a new one arrived; length is unchanged.
  const prev = "line1\nline2\nline3\n";
  const latest = "line2\nline3\nline4\n";
  assert.equal(diffLog(prev.length, latest, prev).kind, "reset");
  // Longer but divergent: still a reset.
  assert.equal(diffLog(prev.length, "zzz" + latest, prev).kind, "reset");
  // A true extension is still an append of only the new tail.
  const d = diffLog(prev.length, prev + "line4\n", prev);
  assert.equal(d.kind, "append");
  assert.equal(d.chunk, "line4\n");
  // Without prevLog the legacy length-only behaviour is unchanged.
  assert.equal(diffLog(prev.length, latest).kind, "none");
});
