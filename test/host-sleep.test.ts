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

test("wokeAt: the moment the host last came back from sleep, 0 until it ever slept", () => {
  let t = 5_000_000;
  const s = makeHostSleep(60_000, { now: () => t });
  assert.equal(s.wokeAt(), 0);
  s.wake("delegate"); // awake already: not a wake-up
  assert.equal(s.wokeAt(), 0);
  t += 120_000;
  s.noteFleet([]);
  assert.equal(s.asleep(), true);
  t += 30_000;
  s.wake("message");
  assert.equal(s.wokeAt(), t);
});

test("makeHostSleep: a hold keeps the host up past the quiet delay, then the clock restarts from the hold's end", () => {
  let t = 1_000_000;
  const said: string[] = [];
  const s = makeHostSleep(5 * 60_000, { now: () => t, log: (m) => said.push(m) });
  s.hold(60 * 60_000, "open thread-a");
  assert.match(said.at(-1)!, /held awake 60m: open thread-a/);
  assert.equal(s.state().heldUntil, t + 60 * 60_000);
  // Sweeps that read nothing working (or time out) for the whole hour: still awake.
  for (let i = 0; i < 12; i++) {
    t += 5 * 60_000;
    s.noteFleet([box("done")]);
    assert.equal(s.asleep(), false, `minute ${(i + 1) * 5}`);
  }
  // The hold has ended; the quiet delay counts from there, not from before the hold.
  t += 4 * 60_000;
  s.noteFleet([box("done")]);
  assert.equal(s.asleep(), false);
  t += 60_000;
  s.noteFleet([box("done")]);
  assert.equal(s.asleep(), true);
  assert.equal(s.state().heldUntil, 0);
  // A shorter hold never shortens a longer one already in force.
  s.hold(60 * 60_000);
  const until = s.state().heldUntil;
  s.hold(60_000);
  assert.equal(s.state().heldUntil, until);
  assert.equal(s.asleep(), false, "a hold wakes");
});
