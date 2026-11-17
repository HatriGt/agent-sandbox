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
    // Paused at the provider while the clock reads awake (the operator's button, the provider's own
    // idle timer): a launch path's wake starts it all the same.
    calls.length = 0;
    await pool.pause("fs-1");
    assert.equal(pool.get("fs-1")!.sleep.asleep(), false);
    assert.equal(pool.dormant("fs-1"), true);
    sleepFor(pool.cfgFor("fs-1")).wake("message box");
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["pause", "start"]);
    // The wake button on a host asleep by its clock: one start, not one from the clock and one from the button.
    calls.length = 0;
    pool.noteSweep("fs-1", []);
    t += 6 * 60_000;
    pool.noteSweep("fs-1", []);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["pause"]);
    await pool.start("fs-1");
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["pause", "start"]);
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

test("pick: exclude skips the hosts a boot already failed on", () => {
  const pool = makeHostPool(cfg, openMemoryDb());
  pool.upsert({ id: "b", name: "b", ssh: "root@b", priority: -1 });
  assert.equal(pool.pick().host?.spec.id, "b");
  assert.equal(pool.pick({ exclude: ["b"] }).host?.spec.id, "primary");
  assert.match(pool.pick({ exclude: ["b", "primary"] }).reason ?? "", /no box host/);
  registerSleepResolver(null);
});

test("pick: awakeOnly (the canary) never chooses a dormant host; usage is not counted while the VM is paused", async () => {
  setProviderForTest("freestyle", {
    metered: true,
    state: async (): Promise<ProviderState> => ({ state: "paused", at: 1_000_000 }),
    pause: async (): Promise<ProviderState> => ({ state: "paused", at: 1_000_000 }),
    start: async (): Promise<ProviderState> => ({ state: "running", at: 1_000_000 }),
  });
  try {
    let t = 1_000_000;
    const pool = makeHostPool(cfg, openMemoryDb(), { now: () => t });
    pool.upsert({ ...vmSpec, priority: -1, allowance: { vcpuHours: 100, vcpu: 4, resetDay: 1 } });
    await pool.refreshProvider("fs-1");
    assert.equal(pool.dormant("fs-1"), true);
    assert.equal(pool.pick().host?.spec.id, "fs-1", "a run still goes there (and starts it)");
    assert.equal(pool.pick({ awakeOnly: true }).host?.spec.id, "primary", "the canary takes what is awake");
    // Ten minutes pass with the VM paused at the provider and the clock awake: nothing is billed.
    pool.tickUsage();
    t += 10 * 60_000;
    pool.tickUsage();
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.allowance?.usedHours, 0);
  } finally {
    setProviderForTest("freestyle", null);
    registerSleepResolver(null);
  }
});

test("ready: a paused VM is started and waited for, then probed until it answers; a VM that never comes up throws", async () => {
  // The pause issued when the host fell asleep is still landing when the run arrives.
  const states: string[] = ["pausing", "paused", "starting", "starting", "running"];
  const calls: string[] = [];
  let probes = 0;
  setProviderForTest("freestyle", {
    metered: true,
    state: async (): Promise<ProviderState> => ({ state: states.length > 1 ? states.shift()! : states[0], at: 0 }),
    pause: async (): Promise<ProviderState> => ({ state: "paused", at: 0 }),
    start: async (): Promise<ProviderState> => {
      calls.push("start");
      return { state: "starting", at: 0 };
    },
  });
  try {
    let t = 1_000_000;
    const pool = makeHostPool(cfg, openMemoryDb(), {
      now: () => t,
      readyPollMs: 1,
      answerTimeoutMs: 50,
      probe: async (c) => {
        if (c.hostId !== "fs-1") return "ok";
        probes++;
        if (probes < 3) throw new Error("Connection closed by remote host");
        return "0 live box(es)";
      },
    });
    pool.upsert(vmSpec);
    pool.noteSweep("fs-1", []);
    t += 6 * 60_000;
    pool.noteSweep("fs-1", []);
    assert.equal(pool.get("fs-1")!.sleep.asleep(), true);
    await pool.ready("fs-1", "run x");
    assert.deepEqual(calls, ["start"], "started once through the provider");
    assert.equal(probes, 3, "two SSH failures while the VM crawls, then an answer");
    assert.equal(pool.get("fs-1")!.sleep.asleep(), false);
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.providerState?.state, "running");
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.unreachable, false);
    // Awake and answering: ready is a no-op apart from the state read.
    probes = 0;
    await pool.ready("fs-1");
    assert.equal(probes, 0);
    // The primary (static): nothing to start, nothing to probe while it is awake.
    await pool.ready("primary");

    // A VM that never answers its probes: unreachable, and the caller is told.
    states.splice(0, states.length, "running");
    probes = -100;
    await pool.ready("fs-1");
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.unreachable, false, "probes were skipped: it was awake and reachable");
    // Marked unreachable by a sweep: it has to answer a probe again, and here it never does.
    pool.noteSweepError("fs-1", "x");
    await assert.rejects(() => pool.ready("fs-1"), /did not answer: Connection closed/);
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.unreachable, true);
  } finally {
    setProviderForTest("freestyle", null);
    registerSleepResolver(null);
  }
});

test("ready: a start call that fails is tried again; an unanswerable provider hands over to the probe; a host ready gave up on sits out", async () => {
  const { READY_COOLDOWN_MS } = await import("../src/host-pool.ts");
  let vm = "paused";
  let startsLeftToFail = 1;
  let stuck = false;
  let t = 1_000_000;
  const calls: string[] = [];
  setProviderForTest("freestyle", {
    metered: true,
    state: async (): Promise<ProviderState> => {
      // A stuck VM: every read costs a minute and the state never changes.
      if (stuck) t += 60_000;
      return { state: vm, at: 0 };
    },
    pause: async (): Promise<ProviderState> => ({ state: (vm = "paused"), at: 0 }),
    start: async (): Promise<ProviderState> => {
      calls.push("start");
      if (startsLeftToFail-- > 0) return { state: "unknown", detail: "POST /start → 409: vm is pausing", at: 0 };
      if (stuck) return { state: "starting", at: 0 };
      vm = "running";
      return { state: "running", at: 0 };
    },
  });
  let probeOk = true;
  let probes = 0;
  try {
    const pool = makeHostPool(cfg, openMemoryDb(), {
      now: () => t,
      readyPollMs: 1,
      answerTimeoutMs: 50,
      probe: async (c) => {
        if (c.hostId !== "fs-1") return "ok";
        probes++;
        if (!probeOk) throw new Error("Connection closed by remote host");
        return "0 live box(es)";
      },
    });
    pool.upsert({ ...vmSpec, priority: -1 });
    await pool.refreshProvider("fs-1");
    // The first start is refused (the pause is still landing); the next one, a few polls later, takes.
    await pool.ready("fs-1", "run");
    assert.deepEqual(calls, ["start", "start"]);
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.providerState?.state, "running");

    // The provider cannot be asked at all: no wait for "running", the probe decides.
    vm = "unknown";
    calls.length = 0;
    probes = 0;
    await pool.ready("fs-1", "run");
    assert.deepEqual(calls, []);
    assert.equal(probes, 1, "one probe answered, so the host is ready");

    // The probe never answers an awake VM: unreachable, as before.
    probeOk = false;
    await assert.rejects(() => pool.ready("fs-1", "run"), /did not answer/);
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.unreachable, true);
    pool.noteSweep("fs-1", []);

    // The VM never leaves "paused" within the patience (the start says "starting", the next read says
    // "paused" again, so it is started once more, and so on): ready gives up. "Paused" is dormant, which
    // would keep the host pickable, so the next run would pay the same wait; it sits out for a while instead.
    vm = "paused";
    stuck = true;
    startsLeftToFail = 0;
    await assert.rejects(() => pool.ready("fs-1", "run", { patienceMs: 150_000 }), /is (paused|starting) after/);
    assert.equal(pool.dormant("fs-1"), true);
    assert.equal(pool.pick().host?.spec.id, "primary", "fs-1 sits out");
    t += READY_COOLDOWN_MS + 1;
    assert.equal(pool.pick().host?.spec.id, "fs-1", "and is back after the cooldown");
    // A successful sweep ends the cooldown early.
    await assert.rejects(() => pool.ready("fs-1", "run", { patienceMs: 150_000 }));
    assert.equal(pool.pick().host?.spec.id, "primary");
    pool.noteSweep("fs-1", []);
    assert.equal(pool.pick().host?.spec.id, "fs-1");
  } finally {
    setProviderForTest("freestyle", null);
    registerSleepResolver(null);
  }
});

test("placeRun: the slot is given back the moment the box exists, and the box counts until the next sweep lists it", async () => {
  const { placeRun } = await import("../src/host-pool.ts");
  const pool = makeHostPool(cfg, openMemoryDb(), { probe: async () => "ok" });
  pool.upsert({ id: "b", name: "b", ssh: "root@b", priority: -1, maxBoxes: 2 });
  let seen: { reserved: number; running: number } | undefined;
  await placeRun(pool, cfg, "run t", async (hostCfg, onAcquired) => {
    assert.equal(hostCfg.hostId, "b");
    assert.equal(pool.get("b")!.reserved, 1, "reserved while the box boots");
    onAcquired("box-1");
    const v = pool.state().find((h) => h.id === "b")!;
    seen = { reserved: v.reserved, running: v.running };
    // Bootstrap is still running here; a second pick must see one slot taken, not two.
    const again = pool.pick();
    assert.equal(again.host?.spec.id, "b");
    again.release();
    return "ok";
  });
  assert.deepEqual(seen, { reserved: 0, running: 1 });
  assert.equal(pool.hostOfBox("box-1"), "b");
  assert.equal(pool.get("b")!.reserved, 0);
  // The sweep that lists the box replaces the placeholder.
  pool.noteSweep("b", [box("box-1")]);
  assert.equal(pool.state().find((h) => h.id === "b")!.running, 1);
  registerSleepResolver(null);
});

test("usage: a VM that runs at its provider while the clock says asleep is billed and paused again", async () => {
  let vm = "running";
  let pausesToFail = 0;
  const calls: string[] = [];
  setProviderForTest("freestyle", {
    metered: true,
    state: async (): Promise<ProviderState> => ({ state: vm, at: t }),
    pause: async (): Promise<ProviderState> => {
      calls.push("pause");
      if (pausesToFail-- > 0) return { state: "unknown", detail: "POST /pause → 500", at: t };
      return { state: (vm = "paused"), at: t };
    },
    start: async (): Promise<ProviderState> => ({ state: (vm = "running"), at: t }),
  });
  let t = 1_000_000;
  try {
    const pool = makeHostPool(cfg, openMemoryDb(), { now: () => t });
    pool.upsert(vmSpec);
    pool.tickUsage();
    pool.noteSweep("fs-1", []);
    t += 6 * 60_000;
    pool.noteSweep("fs-1", []);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["pause"], "paused when it fell asleep");
    // Six minutes awake were billed; from here nothing, while it is paused.
    pool.tickUsage();
    const used = () => pool.state().find((h) => h.id === "fs-1")!.allowance!.usedHours;
    assert.ok(Math.abs(used() - (6 / 60) * 4) < 1e-9);
    t += 60_000;
    pool.tickUsage();
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(Math.abs(used() - (6 / 60) * 4) < 1e-9, "paused: not billed");
    // Someone starts the VM by hand. The minute refresh notices and pauses it again; that first pause
    // call fails, so the VM keeps running: a failed call does not overwrite the "running" reading, the
    // minutes are billed, and the next tick pauses it for real.
    vm = "running";
    pausesToFail = 1;
    t += 60_000;
    pool.tickUsage();
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ["pause", "pause"], "paused again, nothing was working on it");
    assert.equal(pool.state().find((h) => h.id === "fs-1")!.providerState?.state, "running", "the failed call kept the reading");
    assert.match(pool.state().find((h) => h.id === "fs-1")!.providerState?.detail ?? "", /500/);
    const before = used();
    t += 2 * 60_000;
    pool.tickUsage();
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(Math.abs(used() - before - (2 / 60) * 4) < 1e-9, "the two minutes it ran anyway were billed");
    assert.deepEqual(calls, ["pause", "pause", "pause"]);
    assert.equal(pool.state().find((h) => h.id === "fs-1")!.providerState?.state, "paused");
    assert.equal(pool.get("fs-1")!.sleep.asleep(), true, "the clock still reads asleep");
    const after = used();
    t += 60_000;
    pool.tickUsage();
    assert.equal(used(), after, "paused again: nothing more");
  } finally {
    setProviderForTest("freestyle", null);
    registerSleepResolver(null);
  }
});

test("placeRun: a boot that fails before the box exists moves to the next host; after the box exists the error is the run's", async () => {
  const { placeRun } = await import("../src/host-pool.ts");
  const said: string[] = [];
  const pool = makeHostPool(cfg, openMemoryDb(), { probe: async () => "ok" });
  pool.upsert({ id: "b", name: "b", ssh: "root@b", priority: -1, maxBoxes: 2 });
  const attempts: string[] = [];
  const out = await placeRun(pool, cfg, "run t", async (hostCfg, onAcquired) => {
    attempts.push(hostCfg.hostId!);
    if (hostCfg.hostId === "b") throw new Error("ssh: Connection closed by remote host");
    onAcquired();
    return { box: "box-1", host: hostCfg.hostId };
  }, (m) => said.push(m));
  assert.deepEqual(attempts, ["b", "primary"]);
  assert.deepEqual(out, { box: "box-1", host: "primary" });
  assert.equal(pool.state().find((h) => h.id === "b")?.unreachable, true, "the host that failed is out until a sweep gets through");
  assert.match(pool.state().find((h) => h.id === "b")?.lastError ?? "", /boot failed: ssh/);
  assert.ok(said.some((m) => /boot on b failed/.test(m)));
  assert.equal(pool.get("primary")!.reserved, 0, "every slot released");
  assert.equal(pool.get("b")!.reserved, 0);

  // Once the box exists the run stays: no second host, the error comes back as is.
  pool.noteSweep("b", []);
  attempts.length = 0;
  await assert.rejects(
    () =>
      placeRun(pool, cfg, "run u", async (hostCfg, onAcquired) => {
        attempts.push(hostCfg.hostId!);
        onAcquired();
        throw new Error("agent exited 1");
      }, () => {}),
    /agent exited 1/
  );
  assert.deepEqual(attempts, ["b"]);

  // Every host failing before the box: the last error with the hosts named.
  attempts.length = 0;
  await assert.rejects(
    () =>
      placeRun(pool, cfg, "run v", async (hostCfg) => {
        attempts.push(hostCfg.hostId!);
        throw new Error(`${hostCfg.hostId} is down`);
      }, () => {}),
    /primary is down/
  );
  assert.deepEqual(attempts, ["b", "primary"]);

  // Without a pool the attempt runs once on the given config.
  assert.equal(await placeRun(null, cfg, "run w", async (c) => c.vpsSsh), "root@vps");
  registerSleepResolver(null);
});

test("a VM paused at its provider is dormant, not dead: no SSH from sweeps or checks, ranked as asleep, still picked and started", async () => {
  let vm = "paused";
  const calls: string[] = [];
  setProviderForTest("freestyle", {
    metered: true,
    state: async (): Promise<ProviderState> => ({ state: vm, at: 5 }),
    pause: async (): Promise<ProviderState> => ({ state: (vm = "paused"), at: 5 }),
    start: async (): Promise<ProviderState> => {
      calls.push("start");
      vm = "running";
      return { state: "running", at: 5 };
    },
  });
  const { sweepHosts, setSweepForTest } = await import("../src/host-sweep.ts");
  let probes = 0;
  let reads = 0;
  try {
    const pool = makeHostPool(cfg, openMemoryDb(), { readyPollMs: 1, answerTimeoutMs: 50, probe: async (c) => (c.hostId === "fs-1" ? (probes++, "0 live") : "ok") });
    pool.upsert({ ...vmSpec, priority: -1 });
    // The first sweep after a controller restart finds the VM paused: SSH fails, the provider is asked, and the host is dormant.
    setSweepForTest(async (c, id) => {
      reads++;
      if (id === "fs-1") throw new Error("Connection closed by remote host");
      return { boxes: [], kept: new Set<string>(), claims: new Map<string, number>(), titles: {} };
    }, 50);
    let r = await sweepHosts(cfg, pool);
    assert.deepEqual(r.stale, ["fs-1"]);
    await new Promise((res) => setTimeout(res, 5));
    let v = pool.state().find((h) => h.id === "fs-1")!;
    assert.equal(v.providerState?.state, "paused");
    assert.equal(v.unreachable, false, "paused is not unreachable");
    assert.equal(v.asleep, true, "paused is dormant");
    assert.equal(pool.dormant("fs-1"), true);
    assert.equal(sleepFor(pool.cfgFor("fs-1")).asleep(), true, "the launch paths see it asleep too");
    // The next round does not SSH to it.
    reads = 0;
    r = await sweepHosts(cfg, pool);
    assert.equal(reads, 1, "only the primary was read");
    assert.deepEqual(r.stale, ["fs-1"]);
    // A check does not SSH either and is a fine answer.
    const c = await pool.check("fs-1");
    assert.equal(c.ok, true);
    assert.match(c.detail, /paused at the provider/);
    assert.equal(probes, 0);
    // Still picked (order -1 beats the awake primary) and started on the way in.
    const p = pool.pick();
    assert.equal(p.host?.spec.id, "fs-1");
    p.release();
    await pool.ready("fs-1", "run");
    assert.deepEqual(calls, ["start"]);
    assert.equal(probes, 1, "one probe once it came up");
    assert.equal(pool.dormant("fs-1"), false);
    assert.equal(pool.state().find((h) => h.id === "fs-1")?.providerState?.state, "running");
  } finally {
    setSweepForTest(null);
    setProviderForTest("freestyle", null);
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

test("readyForBox: a reply to a box on a paused VM waits for the start; callers in flight share it; an awake host answers at once", async () => {
  let vm = "paused";
  let reads = 0;
  const calls: string[] = [];
  setProviderForTest("freestyle", {
    metered: true,
    state: async (): Promise<ProviderState> => {
      // A VM resuming on its own (the proxy started it): running on the second read.
      if (vm === "starting" && ++reads >= 2) vm = "running";
      return { state: vm, at: 0 };
    },
    pause: async (): Promise<ProviderState> => ({ state: (vm = "paused"), at: 0 }),
    start: async (): Promise<ProviderState> => {
      calls.push("start");
      vm = "running";
      return { state: "running", at: 0 };
    },
  });
  let probes = 0;
  try {
    const pool = makeHostPool(cfg, openMemoryDb(), {
      readyPollMs: 1,
      probe: async (c) => {
        if (c.hostId === "fs-1") probes++;
        return "ok";
      },
    });
    pool.upsert(vmSpec);
    await pool.refreshProvider("fs-1");
    assert.equal(pool.dormant("fs-1"), true);
    pool.rememberBox("box-q", "fs-1");
    // Two replies land at once: one start, one probe, both get the VM's config.
    const [a, b] = await Promise.all([pool.readyForBox("box-q", "message box-q"), pool.readyForBox("box-q", "message box-q")]);
    assert.equal(a.hostId, "fs-1");
    assert.equal(b.vpsSsh, vmSpec.ssh);
    assert.deepEqual(calls, ["start"]);
    assert.equal(probes, 1);
    // Awake now: no provider call, no probe.
    await pool.readyForBox("box-q");
    assert.deepEqual(calls, ["start"]);
    assert.equal(probes, 1);
    // A box nobody mapped is the primary's, which never waits.
    assert.equal((await pool.readyForBox("old-box")).hostId, "primary");
    assert.equal(probes, 1);
    // The VM is resuming (the provider's proxy started it on an SSH that reached it): dormant, so the
    // loops leave it alone, and a reply waits for "running" and one probe instead of dying on SSH.
    vm = "starting";
    reads = 0;
    await pool.refreshProvider("fs-1");
    assert.equal(pool.dormant("fs-1"), true);
    await pool.readyForBox("box-q", "message box-q");
    assert.deepEqual(calls, ["start"], "no start issued for a VM already starting");
    assert.equal(probes, 2);
    assert.equal(pool.dormant("fs-1"), false);
  } finally {
    setProviderForTest("freestyle", null);
    registerSleepResolver(null);
  }
});

test("a disabled host with boxes on it is still swept until they are gone; a box two sweeps miss loses its mapping", async () => {
  const { sweepHosts, setSweepForTest } = await import("../src/host-sweep.ts");
  const db = openMemoryDb();
  const pool = makeHostPool(cfg, db);
  pool.upsert({ id: "d", name: "d", ssh: "root@d", priority: -1 });
  pool.noteSweep("d", [box("b1")]);
  let onD: BoxView[] = [box("b1")];
  const reads: string[] = [];
  setSweepForTest(async (_c, id) => {
    reads.push(id);
    return { boxes: id === "d" ? onD : [], kept: new Set<string>(), claims: new Map<string, number>(), titles: {} };
  }, 1000);
  try {
    pool.upsert({ id: "d", name: "d", ssh: "root@d", priority: -1, enabled: false });
    assert.equal(pool.draining("d"), true);
    assert.equal(pool.state().find((h) => h.id === "d")?.draining, true);
    assert.equal(pool.pick().host?.spec.id, "primary", "never picked");
    assert.equal(pool.capacity(), 5, "its slots are not capacity");
    let r = await sweepHosts(cfg, pool);
    assert.deepEqual(r.swept.sort(), ["d", "primary"], "still read while b1 runs there");
    assert.ok(r.boxes.some((b) => b.name === "b1" && b.host === "d"));
    // b1 finishes and is reaped: one sweep without it keeps the mapping (a listing can skip a box once), the second drops it.
    onD = [];
    r = await sweepHosts(cfg, pool);
    assert.equal(pool.hostOfBox("b1"), "d");
    assert.equal(pool.draining("d"), true);
    r = await sweepHosts(cfg, pool);
    assert.equal(pool.hostOfBox("b1"), undefined);
    assert.equal(pool.draining("d"), false);
    reads.length = 0;
    r = await sweepHosts(cfg, pool);
    assert.deepEqual(reads, ["primary"], "nothing left on it: not read any more");
    assert.deepEqual(r.swept, ["primary"]);
  } finally {
    setSweepForTest(null);
    registerSleepResolver(null);
  }
});

test("notePlaced: a sweep that began before the box existed does not drop it, and its exec still goes to its host", () => {
  let t = 1_000_000;
  const pool = makeHostPool(cfg, openMemoryDb(), { now: () => t });
  pool.upsert({ id: "b", name: "b", ssh: "root@b", priority: -1, maxBoxes: 2 });
  pool.notePlaced("b", "box-new");
  pool.noteSweep("b", []);
  assert.equal(pool.state().find((h) => h.id === "b")!.running, 1, "still counted");
  assert.equal(pool.cfgForBox("box-new").hostId, "b");
  t += 91_000;
  pool.noteSweep("b", []);
  assert.equal(pool.state().find((h) => h.id === "b")!.running, 0, "a box the sweep has not listed for 90 s is not counted");
  assert.equal(pool.hostOfBox("box-new"), "b", "one miss keeps the mapping");
  pool.noteSweep("b", []);
  assert.equal(pool.hostOfBox("box-new"), undefined);
  registerSleepResolver(null);
});

test("placeRun: a failure that is the task's own neither marks the host unreachable nor moves the run; the patience follows what the picker has standing by", async () => {
  const { placeRun } = await import("../src/host-pool.ts");
  const pool = makeHostPool(cfg, openMemoryDb(), { probe: async () => "ok" });
  pool.upsert({ id: "b", name: "b", ssh: "root@b", priority: -1, maxBoxes: 2 });
  const attempts: string[] = [];
  await assert.rejects(
    () =>
      placeRun(pool, cfg, "run t", async (hostCfg) => {
        attempts.push(hostCfg.hostId!);
        throw new Error("Could not check out acme/app@main: not found. Nothing was started.");
      }, () => {}),
    /Could not check out/
  );
  assert.deepEqual(attempts, ["b"], "a bad ref is not retried on the next host");
  assert.equal(pool.state().find((h) => h.id === "b")?.unreachable, false);
  assert.equal(pool.get("b")!.reserved, 0);
  registerSleepResolver(null);

  // The patience: a VM stuck in "starting" gets 75 s when the picker has an awake host with room,
  // 150 s when it has not (the primary is sitting out a failed ready here).
  let t = 1_000_000;
  const said: string[] = [];
  setProviderForTest("freestyle", {
    metered: true,
    state: async (): Promise<ProviderState> => {
      t += 60_000;
      return { state: "starting", at: t };
    },
    pause: async (): Promise<ProviderState> => ({ state: "paused", at: t }),
    start: async (): Promise<ProviderState> => ({ state: "starting", at: t }),
  });
  try {
    const p2 = makeHostPool(cfg, openMemoryDb(), { now: () => t, readyPollMs: 1, probe: async () => "ok" });
    p2.upsert({ ...vmSpec, priority: -1 });
    const out = await placeRun(p2, cfg, "run u", async (hostCfg, onAcquired) => {
      onAcquired("box-1");
      return hostCfg.hostId;
    }, (m) => said.push(m));
    assert.equal(out, "primary", "the run went to the host standing by");
    assert.ok(said.some((m) => /is starting after 120s/.test(m)), said.join("\n"));
    // The primary gave up on a ready of its own: not standing by, so the VM gets the long wait.
    p2.noteSweep("fs-1", []); // the VM is back in the ranking (its own cooldown is over)
    p2.get("primary")!.readyFailedAt = t;
    said.length = 0;
    await assert.rejects(() => placeRun(p2, cfg, "run v", async () => "never", (m) => said.push(m)), /No other box host can take this run/);
    assert.ok(said.some((m) => /is starting after 180s/.test(m)), said.join("\n"));
  } finally {
    setProviderForTest("freestyle", null);
    registerSleepResolver(null);
  }
});

test("pick: awakeOnly with every host asleep says so, and a paused VM is dormant from construction on", async () => {
  let t = 1_000_000;
  let vm = "paused";
  setProviderForTest("freestyle", {
    metered: true,
    state: async (): Promise<ProviderState> => ({ state: vm, at: t }),
    pause: async (): Promise<ProviderState> => ({ state: (vm = "paused"), at: t }),
    start: async (): Promise<ProviderState> => ({ state: (vm = "running"), at: t }),
  });
  try {
    const db = openMemoryDb();
    makeHostPool(cfg, db, { now: () => t }).upsert({ ...vmSpec, priority: -1 });
    registerSleepResolver(null);
    // A restart: the stored VM host is asked for its state before any sweep could SSH it.
    const pool = makeHostPool(cfg, db, { now: () => t });
    await pool.init();
    assert.equal(pool.dormant("fs-1"), true);
    const since = pool.state().find((h) => h.id === "fs-1")!.sleepSince;
    assert.equal(since, t);
    // The minute refresh does not move "asleep since".
    t += 60_000;
    await pool.refreshProvider("fs-1");
    assert.equal(pool.state().find((h) => h.id === "fs-1")!.sleepSince, since);
    // Only the VM is enabled and the canary asks for an awake host: the refusal names the sleep.
    pool.upsert({ id: "primary", enabled: false } as Parameters<typeof pool.upsert>[0]);
    const r = pool.pick({ awakeOnly: true });
    assert.equal(r.host, undefined);
    assert.match(r.reason ?? "", /every box host is asleep/);
    assert.equal(pool.pick().host?.spec.id, "fs-1", "a run that wakes gets it");
  } finally {
    setProviderForTest("freestyle", null);
    registerSleepResolver(null);
  }
});
