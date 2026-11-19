/**
 * A kept box is never lost: the removal rule every reaper, trim and teardown passes (src/claims.ts
 * removalVerdict, applied in src/msb.ts forceRemoveBox and teardown).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { removalVerdict } from "../src/claims.ts";

test("removalVerdict: a kept box is refused, unreadable markers refuse, only force proceeds", () => {
  const kept = new Set(["pool-1-kept"]);
  assert.equal(removalVerdict(kept, "pool-1-kept"), "refuse-kept");
  assert.equal(removalVerdict(kept, "pool-2-free"), "proceed");
  assert.equal(removalVerdict(null, "pool-2-free"), "refuse-unknown", "not being able to read the markers is not proof the box is unkept");
  assert.equal(removalVerdict(null, "pool-1-kept"), "refuse-unknown");
  assert.equal(removalVerdict(kept, "pool-1-kept", true), "proceed", "a deliberate Destroy that names the keep proceeds");
});

test("every teardown wrapper passes the force flag through (a deliberate Destroy of a kept box must reach msb)", async () => {
  const fs = await import("node:fs/promises");
  const tenancy = await fs.readFile(new URL("../src/tenancy.ts", import.meta.url), "utf8");
  assert.match(tenancy, /async teardown\(cfg, session, opts\)[\s\S]*?deps\.teardown\(cfg, session, opts\)/, "tenancy.ts wraps teardown and must forward opts");
  const http = await fs.readFile(new URL("../src/http.ts", import.meta.url), "utf8");
  assert.match(http, /deps\.teardown\(hcfg\(session\), session, \{ force: force === true \}\)/, "the route sends force only when the body says so");
  assert.match(http, /deps\.teardown = async \(c, session, opts\) => \{[\s\S]*?await rawTeardown\(c, session, opts\)/, "the per-box cleanup lane in http.ts rebinds teardown and must forward opts");
  assert.doesNotMatch(http, /deps\.teardown = async \(c, session\) =>/, "no teardown rebind may drop the third argument");
});

test("a teardown wakes the box's host first, and the removal guard reads the keep markers strictly", () => {
  const http = fs.readFileSync(new URL("../src/http.ts", import.meta.url), "utf8");
  assert.match(http, /deps\.teardown = async \(c, session, opts\) => \{[\s\S]*?await hostPool\.readyForBox\(session, `destroy \$\{session\}`\);[\s\S]*?await rawTeardown\(c, session, opts\)/, "the cleanup lane must bring the host up before the raw teardown");
  const msb = fs.readFileSync(new URL("../src/msb.ts", import.meta.url), "utf8");
  assert.match(msb, /async function removalRefusal[\s\S]*?await listKeptStrict\(cfg\)\.catch\(/, "removalRefusal must use the strict reader so a gated SSH reads as unknown");
});
