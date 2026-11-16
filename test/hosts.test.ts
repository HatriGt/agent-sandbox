import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.js";
import type { Config } from "../src/config.js";
import {
  PRIMARY_HOST_ID,
  addAwakeMs,
  allBoxHosts,
  allowanceLeft,
  awakeMsOf,
  billingMonth,
  boxHostOf,
  configForHost,
  forgetBoxHost,
  getHostSpec,
  listHostSpecs,
  normalizeHostSpec,
  publicHostSpec,
  redactSshTarget,
  rememberBoxHost,
  removeHostSpec,
  saveHostSpec,
  seedPrimaryHost,
} from "../src/hosts.ts";

const cfg = {
  vpsSsh: "root@vps",
  sshExtraOpts: ["-i", "/key"],
  msb: "/root/.local/bin/msb",
  msbHome: "/root/.microsandbox",
  vpsStagingDir: "/root/staging",
  maxBoxes: 5,
  hostSleepAfterMs: 0,
  poolSize: 1,
  ompPoolSize: 1,
  snapshot: "agent-claude",
} as unknown as Config;

test("seedPrimaryHost: the .env host is the primary; its connection follows .env, its knobs survive", () => {
  const db = openMemoryDb();
  const first = seedPrimaryHost(db, cfg);
  assert.equal(first.id, PRIMARY_HOST_ID);
  assert.equal(first.ssh, "root@vps");
  assert.equal(first.warm, true);
  assert.equal(first.priority, 0);
  // The operator tunes it from the dashboard…
  saveHostSpec(db, { ...first, name: "Hetzner box", priority: 3, warm: false, allowance: { vcpuHours: 100, vcpu: 4, resetDay: 1 } });
  // …then the .env switches hosts: the connection follows, the knobs stay.
  const moved = seedPrimaryHost(db, { ...cfg, vpsSsh: "asb-host+root:tok@beta-ssh.freestyle.sh", hostSleepAfterMs: 300_000 });
  assert.equal(moved.ssh, "asb-host+root:tok@beta-ssh.freestyle.sh");
  assert.equal(moved.name, "Hetzner box");
  assert.equal(moved.priority, 3);
  assert.equal(moved.warm, false);
  assert.equal(moved.sleepAfterMs, 300_000, "HOST_SLEEP_AFTER_MS wins when set");
  assert.deepEqual(moved.allowance, { vcpuHours: 100, vcpu: 4, resetDay: 1 });
  assert.equal(listHostSpecs(db).length, 1);
  assert.throws(() => removeHostSpec(db, PRIMARY_HOST_ID), /cannot be removed/);
});

test("configForHost: the primary keeps the base config; another host swaps the connection and the pool size", () => {
  const p = configForHost(cfg, seedPrimaryHost(openMemoryDb(), cfg));
  assert.equal(p.hostId, PRIMARY_HOST_ID);
  assert.equal(p.vpsSsh, "root@vps");
  const vm = configForHost(cfg, normalizeHostSpec({ id: "fs-1", name: "Freestyle 1", provider: "freestyle", ssh: "asb+root:t@beta-ssh.freestyle.sh", freestyle: { vmId: "vm-1", apiKey: "k" }, warm: false, snapshot: "" }));
  assert.equal(vm.hostId, "fs-1");
  assert.equal(vm.vpsSsh, "asb+root:t@beta-ssh.freestyle.sh");
  assert.deepEqual(vm.sshExtraOpts, ["-i", "/key"], "no extra opts of its own: the base's apply");
  assert.equal(vm.msb, "/root/.local/bin/msb", "unset paths fall back to the primary's");
  assert.equal(vm.poolSize, 0, "a host that keeps no warm boxes has a zero pool");
  assert.equal(vm.ompPoolSize, 0);
  assert.equal(vm.snapshot, "", "an empty snapshot override means cold boot on this host");
  assert.equal(vm.hostSleepAfterMs, 300_000, "a Freestyle host sleeps after five minutes unless told otherwise");
  assert.equal(vm.maxBoxes, 5);
  const noopts = configForHost(cfg, normalizeHostSpec({ id: "b", name: "b", ssh: "root@b", sshExtraOpts: "-o StrictHostKeyChecking=accept-new" as never, maxBoxes: 2 }));
  assert.deepEqual(noopts.sshExtraOpts, ["-o", "StrictHostKeyChecking=accept-new"]);
  assert.equal(noopts.maxBoxes, 2);
});

test("normalizeHostSpec: validates, keeps a stored key on an edit, redacts for the dashboard", () => {
  assert.throws(() => normalizeHostSpec({ name: "", ssh: "root@x" }), /slug/);
  assert.throws(() => normalizeHostSpec({ name: "x", ssh: "" }), /ssh target/);
  assert.throws(() => normalizeHostSpec({ name: "x", ssh: "-oProxyCommand=evil" }), /dash/);
  assert.throws(() => normalizeHostSpec({ name: "x", ssh: "root@x", provider: "aws" as never }), /unknown provider/);
  assert.throws(() => normalizeHostSpec({ name: "x", ssh: "root@x", provider: "freestyle" }), /VM id/);
  const a = normalizeHostSpec({ name: "Freestyle account A", ssh: "a+root:t@beta-ssh.freestyle.sh", provider: "freestyle", freestyle: { vmId: "vm-a", apiKey: "secret" }, allowance: { vcpuHours: 200, vcpu: 4, resetDay: 1 }, priority: "7" as never });
  assert.equal(a.id, "freestyle-account-a");
  assert.equal(a.priority, 7);
  assert.equal(a.warm, false, "a metered host keeps no warm boxes by default");
  const edited = normalizeHostSpec({ id: a.id, name: "Account A", freestyle: { vmId: "vm-a", apiKey: "" } }, a);
  assert.equal(edited.freestyle?.apiKey, "secret", "a blank key on an edit keeps the stored one");
  assert.equal(edited.ssh, a.ssh);
  const pub = publicHostSpec(edited);
  assert.equal(pub.ssh, "a+root:…@beta-ssh.freestyle.sh");
  assert.deepEqual(pub.freestyle, { vmId: "vm-a", hasApiKey: true });
  assert.ok(!("apiKey" in (pub.freestyle as object)));
  assert.equal(redactSshTarget("root@vps"), "root@vps");
  const off = normalizeHostSpec({ id: a.id, allowance: null as never, enabled: false }, a);
  assert.equal(off.allowance, undefined);
  assert.equal(off.enabled, false);
});

test("box → host memory and awake-time accounting", () => {
  const db = openMemoryDb();
  rememberBoxHost(db, "sess-1", "fs-1", 10);
  rememberBoxHost(db, "sess-2", "primary", 11);
  rememberBoxHost(db, "sess-1", "fs-2", 12);
  assert.equal(boxHostOf(db, "sess-1"), "fs-2");
  assert.deepEqual([...allBoxHosts(db)].sort(), [
    ["sess-1", "fs-2"],
    ["sess-2", "primary"],
  ]);
  forgetBoxHost(db, "sess-1");
  assert.equal(boxHostOf(db, "sess-1"), undefined);

  addAwakeMs(db, "fs-1", "2026-11", 60_000);
  addAwakeMs(db, "fs-1", "2026-11", 30_000);
  addAwakeMs(db, "fs-1", "2026-11", -5);
  assert.equal(awakeMsOf(db, "fs-1", "2026-11"), 90_000);
  assert.equal(awakeMsOf(db, "fs-1", "2026-10"), 0);
  const spec = normalizeHostSpec({ name: "a", ssh: "root@a", allowance: { vcpuHours: 200, vcpu: 4, resetDay: 1 } });
  // 10 awake hours on 4 vCPU = 40 vCPU-hours.
  assert.deepEqual(allowanceLeft(spec, 10 * 3600_000), { usedHours: 40, leftHours: 160, pct: 20 });
  assert.equal(allowanceLeft(normalizeHostSpec({ name: "b", ssh: "root@b" }), 1), undefined);
});

test("billingMonth follows the reset day", () => {
  assert.equal(billingMonth(Date.UTC(2026, 10, 16), 1), "2026-11");
  assert.equal(billingMonth(Date.UTC(2026, 10, 16), 20), "2026-10", "before the 20th it is still October's allowance");
  assert.equal(billingMonth(Date.UTC(2026, 0, 3), 5), "2025-12");
});

test("getHostSpec tolerates a corrupt row", () => {
  const db = openMemoryDb();
  db.prepare(`INSERT INTO hosts (id, spec_json, created_at, updated_at) VALUES ('bad', '{nope', 1, 1)`).run();
  assert.equal(getHostSpec(db, "bad"), undefined);
  assert.deepEqual(listHostSpecs(db), []);
});
