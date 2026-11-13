import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchHub, stitchLog } from "../src/watch-hub.ts";
import type { WatchSnapshot } from "../src/monitor.ts";

function snap(log: string, runState: WatchSnapshot["runState"] = "running"): WatchSnapshot {
  return { name: "b", boxStatus: "running", runState, log };
}

const tickAsync = () => new Promise((r) => setImmediate(r));

test("hub: first read awaits one real read; a second reader inside freshMs is served from cache", async () => {
  let reads = 0;
  let t = 1000;
  const hub = new WatchHub({ read: async () => (reads++, snap("a")), tickMs: 10_000, freshMs: 5_000, now: () => t });
  const a = await hub.read("b");
  assert.equal(a.log, "a");
  assert.equal(reads, 1);
  t += 100;
  const b = await hub.read("b");
  assert.equal(b.log, "a");
  assert.equal(reads, 1, "cached snapshot served without a second SSH read");
  hub.close();
});

test("hub: concurrent readers share one in-flight read", async () => {
  let reads = 0;
  let release: (() => void) | null = null;
  const hub = new WatchHub({
    read: () =>
      new Promise((r) => {
        reads++;
        release = () => r(snap("x"));
      }),
    tickMs: 10_000,
  });
  const p1 = hub.read("b");
  const p2 = hub.read("b");
  await tickAsync();
  assert.equal(reads, 1);
  release!();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(a.log, "x");
  assert.equal(b.log, "x");
  hub.close();
});

test("hub: keeps tailing after the reader leaves (within grace), then goes quiet", async () => {
  let reads = 0;
  let t = 0;
  const hub = new WatchHub({ read: async () => (reads++, snap(`r${reads}`)), tickMs: 5, graceMs: 50, freshMs: 1, now: () => t });
  await hub.read("b");
  // Advance "time" a little and let a few ticks run: the loop is still alive.
  t = 20;
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(reads >= 2, `expected background ticks, got ${reads}`);
  // Past the grace window the loop stops on its own.
  t = 10_000;
  await new Promise((r) => setTimeout(r, 30));
  const settled = reads;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(reads, settled, "no more reads after grace expired");
  assert.equal(hub.active, 0);
  // The cache survives so the next open is instant.
  assert.equal(hub.peek("b")?.log, `r${settled}`);
  hub.close();
});

test("hub: a terminal run is polled on the slow cadence", async () => {
  let reads = 0;
  const hub = new WatchHub({ read: async () => (reads++, snap("done", "done")), tickMs: 5, idleTickMs: 1000, graceMs: 60_000 });
  await hub.read("b");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(reads, 1, "terminal box should not be re-read on the live cadence");
  hub.close();
});

test("hub: a failed read keeps the previous snapshot and retries", async () => {
  let n = 0;
  const hub = new WatchHub({
    read: async () => {
      n++;
      if (n === 2) throw new Error("ssh blip");
      return snap(`ok${n}`);
    },
    tickMs: 5,
    graceMs: 60_000,
    freshMs: 1,
  });
  await hub.read("b");
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(n >= 3);
  assert.match(hub.peek("b")!.log, /^ok/);
  hub.close();
});

test("hub: drop forgets the box", async () => {
  const hub = new WatchHub({ read: async () => snap("a"), tickMs: 10_000 });
  await hub.read("b");
  hub.drop("b");
  assert.equal(hub.peek("b"), null);
  assert.equal(hub.active, 0);
});

test("hub: drop() settles pending readers instead of leaving them hanging", async () => {
  let release: ((s: WatchSnapshot) => void) | null = null;
  const hub = new WatchHub({ read: () => new Promise<WatchSnapshot>((r) => (release = r)), tickMs: 10_000, freshMs: 5_000 });
  const pending = hub.read("b");
  await tickAsync();
  hub.drop("b");
  await assert.rejects(pending, /box gone/);
  release?.(snap("late"));
  await tickAsync();
  assert.equal(hub.peek("b"), null, "a dropped box does not come back from a late read");
});

test("stitchLog: a sliding tail window extends the full log by only its new text", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
  const full = lines.slice(0, 30).join("\n");
  // The window slid: it now starts mid-line 20 and carries lines up to 40.
  const win = lines.slice(20, 40).join("\n").slice(3);
  assert.equal(stitchLog(full, win, true), lines.slice(0, 40).join("\n"));
  assert.equal(stitchLog(full, lines.slice(25, 30).join("\n"), true), full, "no growth leaves it alone");
  assert.equal(stitchLog(full, "something else entirely", true), null, "no overlap asks for a re-read");
  assert.equal(stitchLog(full, "fresh run", false), "fresh run", "a whole-file window is the log");
});

test("stitchLog: repeated text picks the alignment that matches the whole overlap", () => {
  const prev = "x".repeat(600) + "\nA\nB\nA\nB";
  // The anchor (prev's last 512 chars) only counts where the whole overlap matches.
  const win = "x".repeat(300) + "\nA\nB\nA\nB\nA\nC";
  assert.equal(stitchLog(prev, win, true), prev + "\nA\nC");
});

test("hub: readFull serves the whole log once the window is truncated, and grows it by appends", async () => {
  const all = Array.from({ length: 100 }, (_, i) => `l${i}`);
  let upto = 60;
  let logReads = 0;
  const hub = new WatchHub({
    read: async () => ({ ...snap(all.slice(Math.max(0, upto - 40), upto).join("\n")), logTruncated: upto > 40 }),
    readLog: async () => (logReads++, all.slice(0, upto).join("\n")),
    tickMs: 5,
    freshMs: 0,
  });
  const a = await hub.readFull("b");
  assert.equal(a.log, all.slice(0, 60).join("\n"));
  upto = 70;
  await new Promise((r) => setTimeout(r, 30));
  const b = await hub.readFull("b");
  assert.equal(b.log, all.slice(0, 70).join("\n"), "later ticks are stitched, not re-read");
  assert.equal(logReads, 1);
  const w = await hub.read("b");
  assert.equal(w.log.split("\n").length, 40, "read() still serves the tail window");
  hub.close();
});
