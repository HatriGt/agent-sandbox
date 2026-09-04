/**
 * The per-box memory tier: the one brittle piece is reading the CURRENT cap, which has no dedicated
 * field — it is the denominator of the MEM column of `msb metrics` ("1009.6 MiB / 1.0 GiB").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentMemoryTier } from "../web/src/lib/lifecycle.ts";
import { isMemoryTier, MEMORY_TIERS } from "../src/msb.ts";

test("currentMemoryTier: reads the cap from the metrics MEM column", () => {
  assert.equal(currentMemoryTier("1009.6 MiB / 1.0 GiB"), "1G");
  assert.equal(currentMemoryTier("512.0 MiB / 2.0 GiB"), "2G");
  assert.equal(currentMemoryTier("3.1 GiB / 4.0 GiB"), "4G");
  // A MiB-denominated reading must land on the same label the menu offers.
  assert.equal(currentMemoryTier("900 MiB / 1024 MiB"), "1G");
  assert.equal(currentMemoryTier("1.2 GB / 2 GB"), "2G");
});

test("currentMemoryTier: falls back when there are no metrics", () => {
  // A sleeping box has no metrics at all — the deployment default stands in.
  assert.equal(currentMemoryTier(undefined, "1G"), "1G");
  assert.equal(currentMemoryTier("", "2G"), "2G");
  assert.equal(currentMemoryTier("1009.6 MiB", "1G"), "1G", "no denominator");
  assert.equal(currentMemoryTier("x / y", "1G"), "1G", "unparseable denominator");
  assert.equal(currentMemoryTier(undefined), undefined);
});

test("isMemoryTier: only the offered tiers are accepted", () => {
  for (const t of MEMORY_TIERS) assert.equal(isMemoryTier(t), true);
  // The route validates against this, so anything else must be a 400 rather than an msb argument.
  for (const bad of ["8G", "1g", "1024M", "", "--restart", null, 1]) assert.equal(isMemoryTier(bad), false);
});
