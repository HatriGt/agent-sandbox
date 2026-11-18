/**
 * A kept box is never lost: the removal rule every reaper, trim and teardown passes (src/claims.ts
 * removalVerdict, applied in src/msb.ts forceRemoveBox and teardown).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { removalVerdict } from "../src/claims.ts";

test("removalVerdict: a kept box is refused, unreadable markers refuse, only force proceeds", () => {
  const kept = new Set(["pool-1-kept"]);
  assert.equal(removalVerdict(kept, "pool-1-kept"), "refuse-kept");
  assert.equal(removalVerdict(kept, "pool-2-free"), "proceed");
  assert.equal(removalVerdict(null, "pool-2-free"), "refuse-unknown", "not being able to read the markers is not proof the box is unkept");
  assert.equal(removalVerdict(null, "pool-1-kept"), "refuse-unknown");
  assert.equal(removalVerdict(kept, "pool-1-kept", true), "proceed", "a deliberate Destroy that names the keep proceeds");
});
