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
  const cfg = { idleTimeout: "15m", poolIdleTimeout: "6h", maxDuration: "1h", maxBoxes: 5, poolSize: 1 } as Config;
  const read = makeFleetReader(cfg, async () => (sweeps++, [running("a")]), { ttlMs: 1000, now: () => t });
  const [a, b] = await Promise.all([read(), read()]);
  assert.equal(sweeps, 1);
  assert.equal(a, b);
  assert.deepEqual(a.lifecycle, { idleTimeoutSec: 900, poolIdleTimeoutSec: 21600, maxDurationSec: 3600, capacity: 5, poolSize: 1 });
  t = 500;
  await read();
  assert.equal(sweeps, 1, "served from cache inside ttl");
  t = 1600;
  await read();
  assert.equal(sweeps, 2, "re-swept after ttl");
  assert.deepEqual(lifecycleOf(cfg).capacity, 5);
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
