/**
 * The usage meters and the disk tier. Two brittle pieces here:
 *  - `mem` is a parsed CLI table cell ("63.4 MiB / 1.0 GiB"), so the numeric split must be exact;
 *  - df reports LESS than the nominal disk size (a 4 GiB disk reads 3.9G), so tier matching has to
 *    tolerate filesystem overhead rather than expect equality.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMemUsage, parseSizeMib } from "../src/monitor.ts";
import { DISK_TIERS, isDiskTier } from "../src/msb.ts";
import { currentDiskTier, fmtMib, fmtUsage, offerableTiers, tierGib, usageFraction, usageLevel } from "../web/src/lib/lifecycle.ts";

test("parseSizeMib: every unit msb metrics emits", () => {
  assert.equal(parseSizeMib("63.4 MiB"), 63);
  assert.equal(parseSizeMib("1.0 GiB"), 1024);
  assert.equal(parseSizeMib("4 GB"), 4096);
  assert.equal(parseSizeMib("1024 MiB"), 1024);
  assert.equal(parseSizeMib("512 k"), 1, "rounds to the nearest MiB");
  assert.equal(parseSizeMib("2048"), 2048, "bare numbers are MiB");
  assert.equal(parseSizeMib(undefined), undefined);
  assert.equal(parseSizeMib("—"), undefined, "an exited box shows an em dash");
});

test("parseMemUsage: splits the MEM cell into numbers", () => {
  assert.deepEqual(parseMemUsage("63.4 MiB / 1.0 GiB"), { usedMib: 63, totalMib: 1024 });
  assert.deepEqual(parseMemUsage("258.5 MiB / 4.0 GiB"), { usedMib: 259, totalMib: 4096 });
  assert.equal(parseMemUsage("1009.6 MiB"), undefined, "no denominator, no meter");
  assert.equal(parseMemUsage(undefined), undefined);
  assert.equal(parseMemUsage("x / y"), undefined);
});

test("usageFraction: clamped, and undefined when there is nothing live", () => {
  assert.equal(usageFraction({ usedMib: 512, totalMib: 1024 }), 0.5);
  assert.equal(usageFraction({ usedMib: 2048, totalMib: 1024 }), 1, "clamped");
  assert.equal(usageFraction({ usedMib: 10, totalMib: 0 }), undefined);
  assert.equal(usageFraction(undefined), undefined);
});

test("usageLevel: amber with headroom left to act, red at the wall", () => {
  assert.equal(usageLevel({ usedMib: 500, totalMib: 1024 }), "normal");
  assert.equal(usageLevel({ usedMib: 767, totalMib: 1024 }), "normal", "just under 75%");
  assert.equal(usageLevel({ usedMib: 768, totalMib: 1024 }), "high");
  assert.equal(usageLevel({ usedMib: 1014, totalMib: 1024 }), "critical", "the box that got OOM-killed");
  assert.equal(usageLevel(undefined), "normal", "no data is not an alarm");
});

test("fmtMib / fmtUsage: whole MB below a gig, one decimal above", () => {
  assert.equal(fmtMib(812), "812 MB");
  assert.equal(fmtMib(1024), "1.0 GB");
  assert.equal(fmtMib(4096), "4.0 GB");
  assert.equal(fmtMib(16384), "16 GB", "no decimal once it is wide");
  assert.equal(fmtUsage({ usedMib: 812, totalMib: 4096 }), "812 MB of 4.0 GB");
  assert.equal(fmtUsage(undefined), null);
});

test("tierGib / isDiskTier", () => {
  assert.equal(tierGib("16G"), 16);
  assert.equal(tierGib("4g"), 4);
  assert.equal(tierGib("512M"), undefined);
  for (const t of DISK_TIERS) assert.equal(isDiskTier(t), true);
  assert.equal(isDiskTier("1G"), false, "below the create size — the disk cannot shrink there");
  assert.equal(isDiskTier("64G"), false);
});

test("currentDiskTier: tolerates the filesystem overhead df reports", () => {
  const tiers = [...DISK_TIERS];
  // `df -h /` on a 4 GiB disk reads "3.9G" — 3993 MiB. It must still say 4G, not 8G.
  assert.equal(currentDiskTier({ usedMib: 1126, totalMib: 3993 }, tiers), "4G");
  assert.equal(currentDiskTier({ usedMib: 100, totalMib: 8090 }, tiers), "8G");
  assert.equal(currentDiskTier({ usedMib: 100, totalMib: 32000 }, tiers), "32G");
  assert.equal(currentDiskTier({ usedMib: 100, totalMib: 99999 }, tiers), "32G", "clamps to the largest offered");
  assert.equal(currentDiskTier(undefined, tiers), undefined);
});

test("offerableTiers: disk is grow-only, memory is not", () => {
  const tiers = [...DISK_TIERS];
  assert.deepEqual(offerableTiers(tiers, "8G", true), ["8G", "16G", "32G"], "no shrink option is ever shown");
  assert.deepEqual(offerableTiers(tiers, "32G", true), ["32G"]);
  assert.deepEqual(offerableTiers(tiers, "4G", false), tiers, "memory resizes both ways");
  assert.deepEqual(offerableTiers(tiers, undefined, true), tiers, "unknown current size: offer everything");
  assert.deepEqual(offerableTiers(undefined, "4G", true), []);
});
