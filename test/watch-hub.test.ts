import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchHub } from "../src/watch-hub.ts";
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
