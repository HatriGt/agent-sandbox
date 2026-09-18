/**
 * refillPool concurrency + surplus trimming. Observed live: a warm claim's reseed and the periodic
 * maintainer both computed deficit=1 before either boot registered, so TWO warm boxes were booted
 * for poolSize=1 — the extra one eats 1G RAM and a capacity slot for the whole pool window.
 * TDD: written before the fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refillPool } from "../src/pool.ts";
import type { Config } from "../src/config.ts";

const cfg = {
  poolSize: 1,
  snapshot: "agent-base",
  egressAllowAll: true,
} as unknown as Config;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("concurrent refills share one flight: the deficit is booted once, not once per caller", async () => {
  let boots = 0;
  const io = {
    listPoolBoxes: async () => {
      await sleep(20); // the SSH-backed listing is slow — this is the race window
      return [] as string[];
    },
    bootWarmBox: async () => {
      boots++;
      return `pool-${Date.now()}-t${boots}`;
    },
    removeBox: async () => {},
  };
  await Promise.all([refillPool(cfg, io), refillPool(cfg, io), refillPool(cfg, io)]);
  assert.equal(boots, 1);
});

test("sequential refills each re-check: a full pool boots nothing", async () => {
  let boots = 0;
  const io = {
    listPoolBoxes: async () => ["pool-100-a"],
    bootWarmBox: async () => {
      boots++;
      return "x";
    },
    removeBox: async () => {},
  };
  await refillPool(cfg, io);
  await refillPool(cfg, io);
  assert.equal(boots, 0);
});

test("a surplus (two warm boxes, poolSize 1) trims the OLDEST extra instead of booting", async () => {
  const removed: string[] = [];
  let boots = 0;
  const io = {
    listPoolBoxes: async () => ["pool-2000-young", "pool-1000-old"],
    bootWarmBox: async () => {
      boots++;
      return "x";
    },
    removeBox: async (_cfg: Config, box: string) => {
      removed.push(box);
    },
  };
  await refillPool(cfg, io);
  assert.equal(boots, 0);
  assert.deepEqual(removed, ["pool-1000-old"]);
});

test("refill failures are swallowed (a broken boot never breaks the caller) and release the flight", async () => {
  let calls = 0;
  const io = {
    listPoolBoxes: async () => {
      calls++;
      if (calls === 1) throw new Error("ssh blip");
      return ["pool-100-a"];
    },
    bootWarmBox: async () => "x",
    removeBox: async () => {},
  };
  await assert.doesNotReject(() => refillPool(cfg, io));
  // The failed flight must not be cached — the next call runs a fresh one.
  await refillPool(cfg, io);
  assert.equal(calls, 2);
});
