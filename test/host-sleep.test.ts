import { test } from "node:test";
import assert from "node:assert/strict";
import { isWorkingBox, makeHostSleep } from "../src/host-sleep.ts";

const box = (runState: string, extra: Partial<{ boxStatus: string; role: string }> = {}) => ({ boxStatus: "Running", role: "session", runState, ...extra });

test("isWorkingBox: only a running session whose agent is working", () => {
  assert.equal(isWorkingBox(box("running")), true);
  assert.equal(isWorkingBox(box("waiting")), false);
  assert.equal(isWorkingBox(box("done")), false);
  assert.equal(isWorkingBox(box("idle")), false);
  assert.equal(isWorkingBox(box("running", { boxStatus: "Stopped" })), false);
  assert.equal(isWorkingBox(box("running", { role: "pool-free" })), false);
  assert.equal(isWorkingBox(box("running", { role: "pool-claimed" })), true);
});

test("makeHostSleep: a quiet fleet sleeps after the delay, work keeps it up, a launch wakes it", () => {
  let t = 1_000_000;
  const said: string[] = [];
  const s = makeHostSleep(10 * 60_000, { now: () => t, log: (m) => said.push(m) });
  assert.equal(s.enabled, true);
  assert.equal(s.asleep(), false);

  // Quiet, but not for long enough.
  t += 5 * 60_000;
  s.noteFleet([box("done")]);
  assert.equal(s.asleep(), false);

  // A working box resets the quiet clock.
  s.noteFleet([box("running")]);
  t += 9 * 60_000;
  s.noteFleet([]);
  assert.equal(s.asleep(), false);

  // Ten quiet minutes after the last working box: asleep.
  t += 60_000;
  s.noteFleet([box("waiting"), box("idle", { role: "pool-free" })]);
  assert.equal(s.asleep(), true);
  assert.equal(s.state().since, t);
  assert.match(said.at(-1)!, /quiet for 10m/);

  // Still asleep on later quiet sweeps, and the sleep moment does not move.
  t += 60_000;
  s.noteFleet([]);
  assert.equal(s.state().since, t - 60_000);

  // A launch wakes it and restarts the clock.
  s.wake("delegate");
  assert.equal(s.asleep(), false);
  assert.equal(s.state().since, 0);
  assert.equal(s.state().lastWorkAt, t);
  assert.match(said.at(-1)!, /awake: delegate/);
  t += 9 * 60_000;
  s.noteFleet([]);
  assert.equal(s.asleep(), false);
  t += 60_000;
  s.noteFleet([]);
  assert.equal(s.asleep(), true);
});

test("makeHostSleep: 0 means never", () => {
  let t = 0;
  const s = makeHostSleep(0, { now: () => t });
  assert.equal(s.enabled, false);
  t += 24 * 3600_000;
  s.noteFleet([]);
  assert.equal(s.asleep(), false);
  assert.equal(s.state().enabled, false);
});
