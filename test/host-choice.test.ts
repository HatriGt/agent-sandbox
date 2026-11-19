import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.js";
import type { Config } from "../src/config.js";
import type { BoxView } from "../src/monitor.js";
import { makeHostPool, placeRun } from "../src/host-pool.ts";
import { registerSleepResolver } from "../src/host-sleep.ts";
import { runDelegateFlow } from "../src/delegate-flow.ts";

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

test("pick({only}): that host or nothing, with the reason read as the host's own", () => {
  const pool = makeHostPool(cfg, openMemoryDb(), { probe: async () => "ok" });
  pool.upsert({ id: "b", name: "Box B", ssh: "root@b", priority: -1, maxBoxes: 1 });
  const p = pool.pick({ only: "primary" });
  assert.equal(p.host?.spec.id, "primary", "the primary is picked even though b ranks ahead");
  p.release();
  assert.equal(pool.pick({ only: "nope" }).reason, "no such box host: nope");
  pool.noteSweep("b", [box("busy")]);
  assert.equal(pool.pick({ only: "b" }).reason, "it is full (b 1/1)");
  pool.noteSweepError("b", "ssh: connect to host timed out");
  assert.equal(pool.pick({ only: "b" }).reason, "it is unreachable");
  pool.upsert({ id: "b", enabled: false });
  assert.equal(pool.pick({ only: "b" }).reason, "it is disabled");
  registerSleepResolver(null);
});

test("placeRun with a chosen host: lands there, is refused with the reason when it cannot, and never moves to another host", async () => {
  const pool = makeHostPool(cfg, openMemoryDb(), { probe: async () => "ok" });
  pool.upsert({ id: "b", name: "Box B", ssh: "root@b", priority: -1, maxBoxes: 2 });
  const where: string[] = [];
  await placeRun(pool, cfg, "run t", async (hostCfg, onAcquired) => {
    where.push(hostCfg.hostId ?? "primary");
    onAcquired("box-1");
    return "ok";
  }, () => undefined, { host: "primary" });
  assert.deepEqual(where, ["primary"], "b ranks first, the choice was the primary");
  assert.equal(pool.hostOfBox("box-1"), "primary");

  // Full: refused, named, no run started anywhere.
  pool.noteSweep("b", [box("x"), box("y")]);
  let ran = 0;
  await assert.rejects(
    placeRun(pool, cfg, "run u", async () => (ran++, "ok"), () => undefined, { host: "b" }),
    /^Error: The chosen box host Box B cannot take this run: it is full \(b 2\/2\)\.$/
  );
  assert.equal(ran, 0);

  // A boot failure on the chosen host is the answer, not a reason to try the primary.
  pool.noteSweep("b", []);
  const tried: string[] = [];
  await assert.rejects(
    placeRun(
      pool,
      cfg,
      "run v",
      async (hostCfg) => {
        tried.push(hostCfg.hostId ?? "primary");
        throw new Error("msb refused");
      },
      () => undefined,
      { host: "b" }
    ),
    /msb refused/
  );
  assert.deepEqual(tried, ["b"]);
  assert.equal(pool.get("b")!.reserved, 0, "the slot was given back");
  // Without a choice the same failure moves the run on (unchanged behaviour).
  const tried2: string[] = [];
  const out = await placeRun(pool, cfg, "run w", async (hostCfg, onAcquired) => {
    tried2.push(hostCfg.hostId ?? "primary");
    if (hostCfg.hostId === "b") throw new Error("msb refused");
    onAcquired("box-2");
    return "ok";
  }, () => undefined);
  assert.equal(out, "ok");
  assert.deepEqual(tried2, ["b", "primary"]);
  registerSleepResolver(null);
});

test("the flow carries an admin's host choice into the plan", async () => {
  let seen: string | undefined;
  const r = await runDelegateFlow(
    cfg,
    {
      countBoxes: async () => 0,
      resolveGitAccess: async () => ({ ok: true, token: "t" }),
      runDelegation: async (_cfg: unknown, plan: { host?: string }) => ((seen = plan.host), { box: "box-1", warm: false, output: "ok" }),
    } as never,
    { source: "git", repo: "o/n", task: "write tests", host: "instabox-a" }
  );
  assert.equal(r.ok, true);
  assert.equal(seen, "instabox-a");
});
