import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.js";
import type { Config } from "../src/config.js";
import type { BoxView } from "../src/monitor.js";
import { configureHostPool, makeHostPool, sessionBoxes } from "../src/host-pool.ts";
import { sleepFor, registerSleepResolver } from "../src/host-sleep.ts";
import { setProviderForTest, type ProviderState } from "../src/host-providers.ts";
import { awakeMsOf } from "../src/hosts.ts";

const cfg = {
  vpsSsh: "root@vps",
  msb: "/root/.local/bin/msb",
  msbHome: "/root/.microsandbox",
  vpsStagingDir: "/root/staging",
  maxBoxes: 5,
  hostSleepAfterMs: 0,
  poolSize: 1,
  ompPoolSize: 0,
} as unknown as Config;

const box = (name: string, runState: BoxView["runState"] = "running", role: BoxView["role"] = "session", boxStatus = "Running"): BoxView => ({ name, role, boxStatus, runState });

const vmSpec = { id: "fs-1", name: "Freestyle 1", provider: "freestyle" as const, ssh: "a+root:t@beta-ssh.freestyle.sh", freestyle: { vmId: "vm-1", apiKey: "k" }, priority: 10, sleepAfterMs: 5 * 60_000, allowance: { vcpuHours: 200, vcpu: 4, resetDay: 1 } };

test("a pool with only the .env host routes everything to it and never sleeps", () => {
  const pool = makeHostPool(cfg, openMemoryDb());
  assert.deepEqual(pool.hosts().map((h) => h.spec.id), ["primary"]);
  assert.equal(pool.cfgForBox("anything").vpsSsh, "root@vps");
  assert.equal(pool.cfgForBox("anything").hostId, "primary");
  assert.equal(pool.capacity(), 5);
  const p = pool.pick();
  assert.equal(p.host?.spec.id, "primary");
  p.release();
  assert.equal(pool.allAsleep(), false);
  assert.equal(sleepFor(pool.cfgFor("primary")).enabled, false);
  registerSleepResolver(null);
});

test("adding a host: routing by box, per-host sleep, reservations, unreachable, capacity", () => {
  let t = 1_000_000;
  const said: string[] = [];
  const db = openMemoryDb();
  const pool = makeHostPool(cfg, db, { now: () => t, log: (m) => said.push(m) });
  const spec = pool.upsert(vmSpec);
  assert.equal(spec.id, "fs-1");
  assert.equal(pool.capacity(), 10);
  assert.ok(said.some((m) => m.includes("added fs-1")));

  // The primary (priority 0) is picked first; each pick holds a slot until released.
  const picks = Array.from({ length: 6 }, () => pool.pick());
  assert.deepEqual(
    picks.map((p) => p.host?.spec.id),
    ["primary", "primary", "primary", "primary", "primary", "fs-1"],
    "five slots on the primary, then the VM"
  );
  picks.forEach((p) => p.release());
  assert.equal(pool.get("primary")!.reserved, 0);

  // A sweep on the VM: its boxes map to it, and the box-scoped config follows.
  pool.noteSweep("fs-1", [box("sess-a"), box("pool-1-x", "idle", "pool-free")]);
  assert.equal(pool.cfgForBox("sess-a").hostId, "fs-1");
  assert.equal(pool.cfgForBox("sess-a").vpsSsh, "a+root:t@beta-ssh.freestyle.sh");
  assert.equal(pool.cfgForBox("sess-a").poolSize, 0, "a metered host keeps no warm boxes");
  assert.equal(pool.cfgForBox("unknown").hostId, "primary");
  assert.equal(sessionBoxes(pool.get("fs-1")!.lastBoxes), 1);
  assert.equal(sleepFor(pool.cfgForBox("sess-a")).enabled, true, "the VM's own clock");
  assert.equal(sleepFor(pool.cfgFor("primary")).enabled, false);

  // The box map survives a fresh pool on the same database (a restart before the first sweep).
  const again = makeHostPool(cfg, db, { now: () => t });
  assert.equal(again.cfgForBox("sess-a").hostId, "fs-1");

  // Quiet for the VM's delay: its clock sleeps, the primary's never does, allAsleep is false.
  t += 6 * 60_000;
  pool.noteSweep("fs-1", [box("sess-a", "done")]);
  assert.equal(pool.get("fs-1")!.sleep.asleep(), true);
  assert.equal(pool.allAsleep(), false, "the primary is a host of our own and is never asleep");
  // Asleep hosts rank behind awake ones at equal priority; a launch wakes them.
  pool.wake("fs-1", "task sess-a");
  assert.equal(pool.get("fs-1")!.sleep.asleep(), false);

  // A failed sweep marks the host unreachable: it is skipped by the picker until a sweep succeeds.
  pool.noteSweepError("fs-1", "ssh: connect to host timed out");
  assert.equal(pool.state().find((h) => h.id === "fs-1")?.unreachable, true);
  pool.noteSweep("primary", Array.from({ length: 5 }, (_, i) => box(`s${i}`)));
  assert.equal(pool.pick().reason, "every box host is full (primary 5/5)");
  pool.noteSweep("fs-1", []);
  assert.equal(pool.pick().host?.spec.id, "fs-1");

  // Disabled hosts drop out of capacity and picking; removal clears the box map.
  pool.upsert({ id: "fs-1", enabled: false });
  assert.equal(pool.capacity(), 5);
  assert.equal(pool.pick().reason, "every box host is full (primary 5/5)");
  pool.upsert({ id: "fs-1", enabled: true });
  pool.remove("fs-1");
  assert.equal(pool.cfgForBox("sess-a").hostId, "primary");
  assert.throws(() => pool.remove("primary"), /cannot be removed/);
  registerSleepResolver(null);
});

test("awake time is counted per month against a metered host, and the picker prefers the fuller allowance", () => {
  let t = Date.UTC(2026, 10, 16, 12, 0, 0);
  const db = openMemoryDb();
  const pool = makeHostPool(cfg, db, { now: () => t });
  pool.upsert(vmSpec);
  pool.upsert({ ...vmSpec, id: "fs-2", name: "Freestyle 2", freestyle: { vmId: "vm-2", apiKey: "k2" } });
  // Two awake minutes on both.
  t += 60_000;
  pool.tickUsage();
  t += 60_000;
  pool.tickUsage();
  assert.equal(awakeMsOf(db, "fs-1", "2026-11"), 120_000);
  assert.equal(awakeMsOf(db, "primary", "2026-11"), 0, "an unmetered host is not counted");
  // fs-1 sleeps; only fs-2 keeps counting.
  pool.noteSweep("fs-1", []);
  t += 6 * 60_000;
  pool.noteSweep("fs-1", []);
  assert.equal(pool.get("fs-1")!.sleep.asleep(), true);
  t += 60_000;
  pool.tickUsage();
  assert.equal(awakeMsOf(db, "fs-1", "2026-11"), 120_000 + 6 * 60_000, "the minutes before it slept count, the one after does not");
  assert.equal(awakeMsOf(db, "fs-2", "2026-11"), 9 * 60_000);
  // Fill the primary so the VMs compete: the one with more allowance left wins (fs-1 used less).
  pool.wake("fs-1");
  pool.noteSweep("primary", Array.from({ length: 5 }, (_, i) => box(`s${i}`)));
  assert.equal(pool.pick().host?.spec.id, "fs-1");
  const view = pool.state().find((h) => h.id === "fs-2")!;
  assert.equal(view.allowance?.month, "2026-11");
  assert.ok(view.allowance!.usedHours > 0.59 && view.allowance!.usedHours < 0.61, `9 min × 4 vCPU = 0.6 vCPU-h, got ${view.allowance?.usedHours}`);
  // A new month starts the count over.
  t = Date.UTC(2026, 11, 2);
  pool.tickUsage();
  assert.equal(pool.state().find((h) => h.id === "fs-2")!.allowance?.month, "2026-12");
  registerSleepResolver(null);
});

test("a metered host is paused through its provider when it falls asleep, and started on a wake", async () => {
  const calls: string[] = [];
  const fake = {
    metered: true,
    state: async (): Promise<ProviderState> => ({ state: "running", at: 0 }),
    pause: async (): Promise<ProviderState> => {
      calls.push("pause");
      return { state: "paused", at: 0 };
    },
    start: async (): Promise<ProviderState> => {
      calls.push("start");
      return { state: "running", at: 0 };
    },
  };
  setProviderForTest("freestyle", fake);
  try {
    let t = 1_000_000;
    const pool = makeHostPool(cfg, openMemoryDb(), { now: () => t });
    pool.upsert(vmSpec);
    pool.noteSweep("fs-1", []);
    t += 6 * 60_000;
    pool.noteSweep("fs-1", []);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["pause"]);
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.providerState?.state, "paused");
    pool.wake("fs-1", "task");
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["pause", "start"]);
    // A launch path wakes through sleepFor(cfg) (msb.ts), which must reach the provider too.
    pool.noteSweep("fs-1", []);
    t += 6 * 60_000;
    pool.noteSweep("fs-1", []);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["pause", "start", "pause"]);
    sleepFor(pool.cfgFor("fs-1")).wake("create box");
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["pause", "start", "pause", "start"]);
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.asleep, false);
    // The operator's buttons.
    assert.equal((await pool.pause("fs-1")).state, "paused");
    assert.equal((await pool.start("fs-1")).state, "running");
    assert.equal((await pool.refreshProvider("fs-1")).state, "running");
    // A static host has no provider to call.
    assert.equal((await pool.pause("primary")).state, "n/a");
  } finally {
    setProviderForTest("freestyle", null);
    registerSleepResolver(null);
  }
});

test("check: the probe's answer is kept, and a failure does not throw", async () => {
  let t = 0;
  const pool = makeHostPool(cfg, openMemoryDb(), {
    now: () => (t += 100),
    probe: async (c) => {
      if (c.hostId === "primary") return "2 live box(es), disk 40% used";
      throw new Error("ssh: Connection refused");
    },
  });
  pool.upsert({ id: "b", name: "b", ssh: "root@b" });
  const ok = await pool.check("primary");
  assert.equal(ok.ok, true);
  assert.equal(ok.detail, "2 live box(es), disk 40% used");
  const bad = await pool.check("b");
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /refused/);
  assert.equal(pool.state().find((h) => h.id === "b")?.check?.ok, false);
  // A host that failed its check is unreachable, so never picked, until something gets through.
  assert.equal(pool.state().find((h) => h.id === "b")?.unreachable, true);
  assert.equal(pool.pick().host?.spec.id, "primary");
  pool.noteSweep("b", []);
  assert.equal(pool.state().find((h) => h.id === "b")?.unreachable, false);
  await assert.rejects(() => pool.check("nope"), /no host/);
  registerSleepResolver(null);
});

test("check: a probe that hangs is capped and the host is unreachable meanwhile", async () => {
  const pool = makeHostPool(cfg, openMemoryDb(), {
    probe: (c) => (c.hostId === "slow" ? new Promise(() => {}) : Promise.resolve("ok")),
    answerTimeoutMs: 30,
  });
  pool.upsert({ id: "slow", name: "slow", ssh: "root@slow", priority: -1 });
  const r = await pool.check("slow");
  assert.equal(r.ok, false);
  assert.match(r.detail, /timed out after 0s/);
  assert.equal(pool.pick().host?.spec.id, "primary");
  registerSleepResolver(null);
});

test("sweepHosts: a host that does not answer in time is served from memory and marked unreachable; the next round reuses the slow read", async () => {
  const { sweepHosts, setSweepForTest } = await import("../src/host-sweep.ts");
  const pool = makeHostPool(cfg, openMemoryDb());
  pool.upsert({ id: "dead", name: "dead", ssh: "root@dead" });
  pool.noteSweep("dead", [box("old-box")]);
  let reads = 0;
  setSweepForTest(async (c, id) => {
    reads++;
    if (id === "dead") await new Promise(() => {});
    return { boxes: [box("live-box")], kept: new Set<string>(), claims: new Map<string, number>(), titles: {} };
  }, 40);
  try {
    const t0 = Date.now();
    const r1 = await sweepHosts(cfg, pool);
    assert.ok(Date.now() - t0 < 2000, "the round does not wait for TCP");
    assert.deepEqual(r1.swept, ["primary"]);
    assert.deepEqual(r1.stale, ["dead"]);
    assert.deepEqual(r1.boxes.map((b) => `${b.name}@${b.host}`).sort(), ["live-box@primary", "old-box@dead"]);
    assert.equal(pool.state().find((h) => h.id === "dead")?.unreachable, true);
    assert.match(pool.state().find((h) => h.id === "dead")?.lastError ?? "", /sweep of dead timed out/);
    assert.equal(reads, 2);
    // The next round attaches to the read still in flight instead of starting another SSH.
    await sweepHosts(cfg, pool);
    assert.equal(reads, 3, "the primary is read again, the dead host is not");
    assert.equal(pool.pick().host?.spec.id, "primary");
  } finally {
    setSweepForTest(null);
    registerSleepResolver(null);
  }
});

test("the shared pool answers cfgForBox and warmCfgs; without one the given config is used", async () => {
  const { cfgForBox, warmCfgs, poolCapacity, hostPool } = await import("../src/host-pool.ts");
  assert.equal(hostPool(), null);
  assert.equal(cfgForBox(cfg, "x"), cfg);
  assert.deepEqual(warmCfgs(cfg), [cfg]);
  assert.equal(poolCapacity(cfg), 5);
  const pool = configureHostPool(makeHostPool(cfg, openMemoryDb()));
  pool.upsert(vmSpec);
  assert.equal(cfgForBox(cfg, "x").hostId, "primary");
  assert.deepEqual(
    warmCfgs(cfg).map((c) => c.hostId),
    ["primary"],
    "a metered host keeps no warm boxes"
  );
  assert.equal(poolCapacity(cfg), 10);
  registerSleepResolver(null);
});
