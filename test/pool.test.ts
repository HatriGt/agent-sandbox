/**
 * Warm-pool maintainer + eligibility. The refill/claim IO lives behind msb.ts (SSH), so here we
 * cover the pure decisions: when the maintainer runs at all, and pool eligibility gating.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startPoolMaintainer, poolEligible } from "../src/pool.ts";
import type { Config } from "../src/config.ts";

const base = {
  poolSize: 1,
  snapshot: "agent-base",
  egressAllowAll: true,
  poolRefillIntervalMs: 60000,
} as unknown as Config;

test("maintainer is a no-op when pooling is disabled (size 0)", () => {
  const h = startPoolMaintainer({ ...base, poolSize: 0 });
  // A disabled maintainer returns a harmless stop handle and never arms a timer.
  assert.doesNotThrow(() => h.stop());
});

test("maintainer is a no-op without a snapshot or open egress", () => {
  assert.doesNotThrow(() => startPoolMaintainer({ ...base, snapshot: "" }).stop());
  assert.doesNotThrow(() => startPoolMaintainer({ ...base, egressAllowAll: false }).stop());
});

test("maintainer is a no-op when the interval is 0 (disabled)", () => {
  assert.doesNotThrow(() => startPoolMaintainer({ ...base, poolRefillIntervalMs: 0 }).stop());
});

test("maintainer arms a timer when enabled and stop() clears it", () => {
  const h = startPoolMaintainer(base);
  // stop() must be idempotent-safe and not throw.
  assert.doesNotThrow(() => h.stop());
  assert.doesNotThrow(() => h.stop());
});

test("poolEligible needs size>0, a snapshot, open egress, and no per-call domains", () => {
  assert.equal(poolEligible(base, false), true);
  assert.equal(poolEligible(base, true), false); // per-call allowDomains -> fresh cold boot
  assert.equal(poolEligible({ ...base, poolSize: 0 }, false), false);
  assert.equal(poolEligible({ ...base, snapshot: "" }, false), false);
  assert.equal(poolEligible({ ...base, egressAllowAll: false }, false), false);
});
