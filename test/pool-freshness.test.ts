/**
 * Warm-box freshness: a pool box's --max-duration clock starts at BOOT, not at claim, so a box
 * claimed late in its life is killed mid-run ("max duration 3600s exceeded" — observed live on
 * pool-1789619040775-7knf4i: booted 04:24, claimed 05:22, VM killed 05:24, run reported exit 254).
 * The fix is two-sided: boot warm boxes with maxDuration ON TOP of the pool idle window, and never
 * claim a box old enough that less than a full maxDuration remains. TDD: written before the fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { poolBoxAgeMs, freshPoolBoxes, warmMaxDuration } from "../src/pool.ts";

test("poolBoxAgeMs reads the boot time embedded in the pool name", () => {
  assert.equal(poolBoxAgeMs("pool-1789619040775-7knf4i", 1789619040775 + 60_000), 60_000);
  assert.equal(poolBoxAgeMs("pool-1789619040775-7knf4i", 1789619040775), 0);
});

test("poolBoxAgeMs is undefined for names it cannot date (never guess)", () => {
  assert.equal(poolBoxAgeMs("delegate-abc", 1), undefined);
  assert.equal(poolBoxAgeMs("pool--x", 1), undefined);
  assert.equal(poolBoxAgeMs("pool-notanumber-x", 1), undefined);
});

test("freshPoolBoxes keeps only boxes young enough to serve a full run", () => {
  const now = 1789619040775 + 3_600_000; // one hour after the first box booted
  const boxes = [
    "pool-1789619040775-old1", // 60m old
    `pool-${now - 30 * 60_000}-mid1`, // 30m old
    `pool-${now - 60_000}-new1`, // 1m old
  ];
  // With a 45m freshness budget, the 60m-old box is excluded.
  assert.deepEqual(freshPoolBoxes(boxes, 45 * 60_000, now), [`pool-${now - 30 * 60_000}-mid1`, `pool-${now - 60_000}-new1`]);
});

test("an undatable name is treated as stale, not fresh", () => {
  assert.deepEqual(freshPoolBoxes(["pool-garbage-x"], 60_000, 1000), []);
});

test("warmMaxDuration budgets a full run on top of the whole pool idle window", () => {
  // poolIdleTimeout 6h + maxDuration 1h -> a box claimed at minute 359 still has a full hour.
  assert.equal(warmMaxDuration("6h", "1h"), "25200s");
  assert.equal(warmMaxDuration("15m", "1h"), "4500s");
  // Unparseable inputs fall back to the plain max duration (never a broken flag value).
  assert.equal(warmMaxDuration("junk", "1h"), "1h");
});
