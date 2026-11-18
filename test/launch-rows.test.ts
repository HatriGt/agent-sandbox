/**
 * The launch bubble's rows (web/src/lib/launch.ts): what the thread shows between Send and the
 * agent's first words. Pure, so the rules are pinned here: the request row, each reported stage
 * done-with-duration or active, the wait for first words after `started`, a failure row, and the
 * fallback when no stages ever arrive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchRows, launchKind, newLaunchId, stuckAfterMs, type LaunchStep } from "../web/src/lib/launch.ts";
import { LAUNCH_ID_RE } from "../src/launch-progress.ts";

const step = (phase: LaunchStep["phase"], at: number, detail?: string): LaunchStep => ({ phase, label: `${phase}${detail ? ` ${detail}` : ""}`, at, ...(detail ? { detail } : {}) });

test("newLaunchId: accepted by the controller's id rule", () => {
  for (let i = 0; i < 20; i++) assert.match(newLaunchId(), LAUNCH_ID_RE);
  assert.notEqual(newLaunchId(), newLaunchId());
});

test("before anything arrives the request row is the active one; a known machine turns it into connecting", () => {
  const a = launchRows([], { sentAt: 1000, now: 3000 });
  assert.deepEqual(a.map((r) => [r.key, r.state]), [["send", "active"]]);
  const b = launchRows([], { sentAt: 1000, now: 3000, machine: "dusk-cedar" });
  assert.deepEqual(b.map((r) => [r.key, r.state, r.label]), [
    ["send", "done", "Sending the task"],
    ["connect", "active", "Connecting to dusk-cedar"],
  ]);
});

test("stages: every reported stage but the last is done with how long it took; the last is active", () => {
  const steps = [step("accepted", 1200), step("access", 1500), step("host", 1600), step("clone", 2100, "o/n"), step("sandbox", 4100, "warm")];
  const rows = launchRows(steps, { sentAt: 1000, now: 5000 });
  assert.deepEqual(rows.map((r) => [r.key, r.state, r.took]), [
    ["send", "done", 200],
    ["0:accepted", "done", 300],
    ["1:access", "done", 100],
    ["2:host", "done", 500],
    ["3:clone", "done", 2000],
    ["4:sandbox", "active", undefined],
  ]);
  assert.equal(rows[5].at, 4100);
});

test("started: the stage is done and the wait for the first words is the active row", () => {
  const steps = [step("accepted", 1200), step("agent", 3000), step("started", 9000, "dusk-cedar")];
  const rows = launchRows(steps, { sentAt: 1000, now: 9500, machine: "dusk-cedar" });
  assert.deepEqual(rows.map((r) => [r.key, r.state]), [
    ["send", "done"],
    ["0:accepted", "done"],
    ["1:agent", "done"],
    ["2:started", "done"],
    ["words", "active"],
  ]);
  assert.equal(rows[4].at, 9000);
  // No "connecting" row once stages are flowing: the machine is already in the story.
  assert.ok(!rows.some((r) => r.key === "connect"));
});

test("failed: the failure row carries the reason and nothing is active after it", () => {
  const steps = [step("accepted", 1200), step("sandbox", 2000, "cold"), step("failed", 2500, "Refused: 3/3 boxes already running")];
  const rows = launchRows(steps, { sentAt: 1000, now: 3000 });
  const last = rows[rows.length - 1];
  assert.equal(last.state, "failed");
  assert.equal(last.detail, "Refused: 3/3 boxes already running");
  assert.ok(!rows.some((r) => r.state === "active"));
  // The stage that was running when it failed is marked done, not left ticking.
  assert.equal(rows[2].state, "done");
});

test("launchKind reads the sandbox stage; stuckAfterMs stretches for a host wake and a cold boot", () => {
  assert.equal(launchKind([step("sandbox", 1, "warm")]), "warm");
  assert.equal(launchKind([step("sandbox", 1, "cold")]), "cold");
  assert.equal(launchKind([step("sandbox", 1)]), undefined);
  assert.equal(stuckAfterMs({ key: "x", label: "Waking the asb-host host", state: "active", at: 0 }), 150_000);
  assert.equal(stuckAfterMs({ key: "x", label: "Booting a fresh sandbox", state: "active", at: 0 }), 90_000);
  assert.equal(stuckAfterMs({ key: "x", label: "Starting the agent", state: "active", at: 0 }), 45_000);
});
