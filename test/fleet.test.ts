import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeWithMemory, makeFleetReader, lifecycleOf } from "../src/fleet.ts";
import { parseDurationSec, parseUptimeSec, type BoxView } from "../src/monitor.ts";
import type { Config } from "../src/config.ts";

const running = (name: string, extra: Partial<BoxView> = {}): BoxView => ({
  name,
  role: "session",
  boxStatus: "Running",
  runState: "running",
  task: "do a thing",
  ...extra,
});

test("parseDurationSec: msb flag grammar", () => {
  assert.equal(parseDurationSec("15m"), 900);
  assert.equal(parseDurationSec("1h"), 3600);
  assert.equal(parseDurationSec("1h30m"), 5400);
  assert.equal(parseDurationSec("90s"), 90);
  assert.equal(parseDurationSec("2d"), 172800);
  assert.equal(parseDurationSec("42"), 42);
  assert.equal(parseDurationSec("soon"), undefined);
  assert.equal(parseDurationSec(""), undefined);
});

test("parseUptimeSec: metrics uptime strings including the stopped-box 'ran' prefix", () => {
  assert.equal(parseUptimeSec("43m18s"), 2598);
  assert.equal(parseUptimeSec("1h02m03s"), 3723);
  assert.equal(parseUptimeSec("ran 59m59s"), 3599);
});

test("mergeWithMemory: a running box is remembered and passed through", () => {
  const mem = new Map<string, BoxView>();
  const out = mergeWithMemory([running("a")], mem);
  assert.equal(out.length, 1);
  assert.equal(mem.get("a")?.task, "do a thing");
});

test("mergeWithMemory: a stopped session box keeps its last-known task/question as Stopped", () => {
  const mem = new Map<string, BoxView>();
  mergeWithMemory([running("a", { runState: "waiting", question: "which db?", cpu: "0.5 / 1c", uptime: "4m" })], mem);
  const out = mergeWithMemory([{ name: "a", role: "session", boxStatus: "Stopped", runState: "idle" }], mem);
  assert.equal(out.length, 1);
  assert.equal(out[0].boxStatus, "Stopped");
  assert.equal(out[0].runState, "waiting");
  assert.equal(out[0].question, "which db?");
  assert.equal(out[0].task, "do a thing");
  assert.equal(out[0].cpu, undefined, "live vitals are dropped for a stopped box");
  assert.equal(out[0].uptime, "4m", "last-seen uptime is kept as 'ran for'");
});

test("mergeWithMemory: a never-claimed pool box that died is dropped; a vanished box is forgotten", () => {
  const mem = new Map<string, BoxView>();
  mergeWithMemory([running("gone")], mem);
  const out = mergeWithMemory([{ name: "pool-1-x", role: "pool-free", boxStatus: "Stopped", runState: "idle" }], mem);
  assert.equal(out.length, 0);
  assert.equal(mem.has("gone"), false);
});

test("makeFleetReader: caches within ttl and dedupes concurrent sweeps", async () => {
  let sweeps = 0;
  let t = 0;
  const cfg = { idleTimeout: "15m", poolIdleTimeout: "6h", maxDuration: "1h", maxBoxes: 5, poolSize: 1, sleepTtl: "1h" } as Config;
  const read = makeFleetReader(cfg, async () => (sweeps++, [running("a")]), { ttlMs: 1000, now: () => t });
  const [a, b] = await Promise.all([read(), read()]);
  assert.equal(sweeps, 1);
  assert.equal(a, b);
  assert.deepEqual(a.lifecycle, {
    idleTimeoutSec: 900,
    poolIdleTimeoutSec: 21600,
    maxDurationSec: 3600,
    capacity: 5,
    poolSize: 1,
    sleepTtlSec: 3600,
    memoryTiers: ["1G", "2G", "4G"],
    memoryDefault: undefined,
    diskTiers: ["1G", "2G", "4G", "8G", "16G", "32G"],
  });
  t = 500;
  await read();
  assert.equal(sweeps, 1, "served from cache inside ttl");
  t = 1600;
  await read();
  assert.equal(sweeps, 2, "re-swept after ttl");
  assert.deepEqual(lifecycleOf(cfg).capacity, 5);
});

test("makeFleetReader: stops sharing a sweep that never settles", async () => {
  // The outage: one `msb exec` into a box caught mid-shutdown never returned, so the memoised
  // in-flight sweep was handed to every later reader forever and the dashboard showed skeletons
  // until the controller was restarted. A stale in-flight sweep must be abandoned, not shared.
  let sweeps = 0;
  let t = 0;
  const cfg = { idleTimeout: "15m", poolIdleTimeout: "6h", maxDuration: "1h", maxBoxes: 5, poolSize: 1 } as Config;
  let settle: ((b: BoxView[]) => void) | null = null;
  const read = makeFleetReader(
    cfg,
    () => {
      sweeps++;
      // The first sweep hangs; later ones resolve at once.
      if (sweeps === 1) return new Promise<BoxView[]>((r) => (settle = r));
      return Promise.resolve([running("a")]);
    },
    { ttlMs: 1000, sweepTtlMs: 20_000, now: () => t },
  );

  const hung = read();
  read();
  assert.equal(sweeps, 1, "concurrent callers still share one sweep");

  t = 19_000;
  read();
  assert.equal(sweeps, 1, "still shared inside the sweep ttl");

  t = 21_000;
  const fresh = await read();
  assert.equal(sweeps, 2, "a sweep older than the sweep ttl is abandoned, not shared");
  assert.equal(fresh.boxes[0]?.name, "a");

  // The abandoned sweep settling late must not clear the slot out from under its replacement.
  settle?.([running("a")]);
  await hung;
  t = 21_100;
  await read();
  assert.equal(sweeps, 2, "the late sweep did not invalidate the fresh cache");
});

test("makeFleetReader: hydrates sleeping runs from the durable store and persists running ones", async () => {
  const saved: Array<{ name: string }> = [];
  const forgotten: string[] = [];
  const store = {
    load: async () => new Map([["pool-old", { name: "pool-old", role: "pool-claimed" as const, runState: "done" as const, task: "yesterday's run" }]]),
    save: async (m: { name: string }) => void saved.push(m),
    forget: async (b: string) => void forgotten.push(b),
  };
  const cfg = { idleTimeout: "15m", poolIdleTimeout: "6h", maxDuration: "1h", maxBoxes: 5, poolSize: 1 } as Config;
  let t = 0;
  const read = makeFleetReader(
    cfg,
    async () => [
      { name: "pool-old", role: "pool-free", boxStatus: "Stopped", runState: "idle" }, // stopped: role unreadable
      running("live", { role: "pool-claimed" }),
    ],
    { ttlMs: 1, now: () => (t += 10), store }
  );
  const snap = await read();
  await new Promise((r) => setImmediate(r));
  const old = snap.boxes.find((b) => b.name === "pool-old")!;
  assert.equal(old.boxStatus, "Stopped");
  assert.equal(old.task, "yesterday's run", "a sleeping run survives a controller restart");
  assert.equal(old.runState, "done");
  assert.deepEqual(saved.map((s) => s.name), ["live"], "running claimed boxes are persisted once");
  await read();
  await new Promise((r) => setImmediate(r));
  assert.equal(saved.length, 1, "unchanged description is not re-written");
  assert.deepEqual(forgotten, []);
});

test("makeFleetReader: asleep serves the last snapshot flagged hostAsleep and never sweeps; awake sweeps and reports", async () => {
  let t = 0;
  let sweeps = 0;
  let asleep = false;
  const seen: number[] = [];
  const cfg = { idleTimeout: "15m", maxDuration: "1h", maxBoxes: 5, poolSize: 1 } as unknown as Config;
  const read = makeFleetReader(cfg, async () => (sweeps++, [running("a")]), {
    ttlMs: 1000,
    now: () => t,
    sleep: { asleep: () => asleep, noteFleet: (boxes) => seen.push(boxes.length) },
  });
  const first = await read();
  assert.equal(sweeps, 1);
  assert.equal(first.hostAsleep, undefined);
  assert.deepEqual(seen, [1]);

  asleep = true;
  t += 60_000; // far past the ttl
  const stale = await read();
  assert.equal(sweeps, 1, "no sweep while asleep");
  assert.equal(stale.hostAsleep, true);
  assert.equal(stale.at, first.at);
  assert.equal(stale.boxes[0].name, "a");

  asleep = false;
  const fresh = await read();
  assert.equal(sweeps, 2);
  assert.equal(fresh.hostAsleep, undefined);
  assert.deepEqual(seen, [1, 1]);
});

test("makeFleetReader: stale-while-revalidate answers from the last snapshot while a sweep runs behind it; forget drops a box at once", async () => {
  let sweeps = 0;
  let t = 0;
  let boxes = [running("a"), running("b")];
  const cfg = { idleTimeout: "15m", poolIdleTimeout: "6h", maxDuration: "1h", maxBoxes: 5, poolSize: 1, sleepTtl: "1h" } as Config;
  let release: (() => void) | null = null;
  const read = makeFleetReader(
    cfg,
    () => {
      sweeps++;
      return new Promise<BoxView[]>((resolve) => {
        release = () => resolve(boxes);
      });
    },
    { ttlMs: 1000, staleMs: 10_000, now: () => t }
  );
  const first = read();
  release!();
  assert.equal((await first).boxes.length, 2);
  // Past ttl, inside the stale window: the old snapshot comes back at once and a sweep starts.
  t = 3000;
  const second = await read();
  assert.equal(second.boxes.length, 2);
  assert.equal(sweeps, 2, "a sweep started behind the stale answer");
  // The sweep is still running; another read shares it without waiting.
  assert.equal((await read()).at, 0);
  // Forgotten: gone from the snapshot before the sweep lands.
  read.forget("b");
  assert.deepEqual((await read()).boxes.map((b) => b.name), ["a"]);
  boxes = [running("a")];
  release!();
  await new Promise((r) => setTimeout(r, 0));
  t = 3500;
  assert.equal((await read()).at, 3000, "the sweep's answer is the snapshot now");
  // Past the stale window: a read waits for the sweep.
  t = 20_000;
  const third = read();
  assert.equal(sweeps, 3);
  release!();
  assert.equal((await third).at, 20_000);
});
