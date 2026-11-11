import { test } from "node:test";
import assert from "node:assert/strict";
import { hostDiskAlarmed, hostDiskAlertText, orphanSandboxDirs, parseDfPk, parseDirListing } from "../src/host-disk.ts";

test("parseDfPk reads the POSIX df line", () => {
  const r = parseDfPk("Filesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/sda1        161000000 139000000  22000000      87% /\n");
  assert.deepEqual(r, { totalMib: 157227, usedMib: 135742, availMib: 21484, usedPct: 87 });
  assert.equal(parseDfPk("df: /nope: No such file"), undefined);
  assert.equal(hostDiskAlarmed(r, 85), true);
  assert.equal(hostDiskAlarmed(r, 90), false);
  assert.equal(hostDiskAlarmed(undefined), false);
  assert.match(hostDiskAlertText(r!, "/root/.microsandbox", "https://x"), /^Host disk at 87% \(21\.0 GiB free of 153\.5 GiB under \/root\/\.microsandbox\)/);
});

test("orphanSandboxDirs: not listed AND a day old AND a plain name", () => {
  const now = 1_000_000;
  const dirs = parseDirListing(["pool-1-aaa 100.5", "pool-2-bbb 999990", "live-box 100", "weird name 100", "../x 100", "garbage", ""].join("\n"));
  assert.deepEqual(orphanSandboxDirs(dirs, ["live-box"], now), ["pool-1-aaa"]);
  assert.deepEqual(orphanSandboxDirs(dirs, [], now, 0).sort(), ["live-box", "pool-1-aaa", "pool-2-bbb"]);
});
