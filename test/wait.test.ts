/**
 * Tests for the block-until-boundary helper — the core of interactive A2A.
 *
 * `delegate`/`resume` launch the in-box agent, then WAIT server-side until the agent hits an
 * interactive boundary (asked a question => waiting, or finished => done) or a timeout fires.
 * The loop is pure: `poll` and `sleep` are injected so we test it with no SSH and no real timers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBoundary, waitForBoundary } from "../src/wait.ts";

test("isBoundary: waiting and done are boundaries; running and idle are not", () => {
  assert.equal(isBoundary("waiting"), true);
  assert.equal(isBoundary("done"), true);
  assert.equal(isBoundary("running"), false);
  assert.equal(isBoundary("idle"), false);
});

test("waitForBoundary: returns immediately when the first poll is already a boundary (waiting)", async () => {
  let polls = 0;
  let sleeps = 0;
  const r = await waitForBoundary({
    poll: async () => {
      polls++;
      return { state: "waiting", text: "Which npm tag?" };
    },
    sleep: async () => {
      sleeps++;
    },
    timeoutMs: 10_000,
    intervalMs: 100,
  });
  assert.equal(r.reached, true);
  assert.equal(r.state, "waiting");
  assert.match(r.text, /Which npm tag/);
  assert.equal(polls, 1, "should not poll again after a boundary");
  assert.equal(sleeps, 0, "should not sleep before the first poll");
});

test("waitForBoundary: polls through running states until it reaches done", async () => {
  const states = ["running", "running", "done"] as const;
  let i = 0;
  let sleeps = 0;
  const r = await waitForBoundary({
    poll: async () => ({ state: states[i++], text: `poll ${i}` }),
    sleep: async () => {
      sleeps++;
    },
    timeoutMs: 10_000,
    intervalMs: 100,
  });
  assert.equal(r.reached, true);
  assert.equal(r.state, "done");
  assert.equal(i, 3, "polled until the boundary");
  assert.equal(sleeps, 2, "slept between the non-boundary polls only");
});

test("waitForBoundary: times out (deadline) and returns reached=false with the last state", async () => {
  // Virtual clock: sleep advances `now`; the deadline is exceeded after a couple of intervals.
  let now = 0;
  let polls = 0;
  const r = await waitForBoundary({
    poll: async () => {
      polls++;
      return { state: "running", text: "still building" };
    },
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
    timeoutMs: 250,
    intervalMs: 100,
  });
  assert.equal(r.reached, false, "never hit a boundary");
  assert.equal(r.state, "running");
  assert.match(r.text, /still building/);
  // With a 250ms budget and 100ms interval: poll@0, poll@100, poll@200, then 300>250 stops.
  assert.ok(polls >= 2 && polls <= 4, `bounded number of polls (got ${polls})`);
});

test("waitForBoundary: a poll error does not kill the loop; it retries then can still succeed", async () => {
  let i = 0;
  const r = await waitForBoundary({
    poll: async () => {
      i++;
      if (i === 1) throw new Error("ssh blip");
      return { state: "waiting", text: "need a token" };
    },
    sleep: async () => {},
    timeoutMs: 10_000,
    intervalMs: 10,
  });
  assert.equal(r.reached, true);
  assert.equal(r.state, "waiting");
  assert.equal(i, 2, "retried after the transient error");
});
