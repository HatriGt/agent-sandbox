/**
 * WS3 — ask-park: stop burning RAM while a run waits on a question.
 *
 * A box blocked on the ask-gate used to stay fully booted until the idle timeout (15m of RAM for
 * nothing), and the 1h sleep TTL could then reap an unanswered run overnight. With ASK_PARK=1 the
 * fleet sweep parks a waiting box after a grace period: capture the ask snapshot, stop the box,
 * leave it down. resumeAgentTask already wakes it (startBoxIfStopped). A parked box is held to a
 * much longer TTL (ASK_PARK_TTL) so an overnight question survives to be answered.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { askParkEnabled, askParkGraceMs, askParkTtlSec, shouldPark, parkWaitingBox } from "../src/snapshot.ts";
import { shouldKeepStopped } from "../src/claims.ts";

test("feature flag and knobs read from env with safe defaults", () => {
  assert.equal(askParkEnabled({}), false);
  assert.equal(askParkEnabled({ ASK_PARK: "1" }), true);
  assert.equal(askParkGraceMs({}), 180_000);
  assert.equal(askParkGraceMs({ ASK_PARK_GRACE_MS: "60000" }), 60_000);
  assert.equal(askParkTtlSec({}), 48 * 3600);
  assert.equal(askParkTtlSec({ ASK_PARK_TTL: "24h" }), 24 * 3600);
});

test("shouldPark: only a waiting, running box past the grace window", () => {
  const now = 1_000_000;
  // Waiting long enough → park.
  assert.equal(shouldPark({ enabled: true, runState: "waiting", boxRunning: true, waitingSinceMs: now - 200_000, graceMs: 180_000, nowMs: now }), true);
  // Still inside the grace window (a quick answer stays instant) → no.
  assert.equal(shouldPark({ enabled: true, runState: "waiting", boxRunning: true, waitingSinceMs: now - 10_000, graceMs: 180_000, nowMs: now }), false);
  // Not waiting / not running / disabled → no.
  assert.equal(shouldPark({ enabled: true, runState: "running", boxRunning: true, waitingSinceMs: now - 999_999, graceMs: 180_000, nowMs: now }), false);
  assert.equal(shouldPark({ enabled: true, runState: "waiting", boxRunning: false, waitingSinceMs: now - 999_999, graceMs: 180_000, nowMs: now }), false);
  assert.equal(shouldPark({ enabled: false, runState: "waiting", boxRunning: true, waitingSinceMs: now - 999_999, graceMs: 180_000, nowMs: now }), false);
  // Unknown waiting-since (first sweep that sees it) → not yet; the clock starts now.
  assert.equal(shouldPark({ enabled: true, runState: "waiting", boxRunning: true, waitingSinceMs: undefined, graceMs: 180_000, nowMs: now }), false);
});

test("parkWaitingBox: snapshot then stop, leave the box DOWN", async () => {
  const calls: string[][] = [];
  const io = { msb: async (args: string[]) => (calls.push(args), { code: 0, stdout: "", stderr: "" }) };
  const ok = await parkWaitingBox(io, "b1");
  assert.equal(ok, true);
  const verbs = calls.map((c) => c.join(" "));
  // Order matters: stop first (snapshot create needs a stopped box), snapshot, and NO restart.
  assert.deepEqual(verbs, ["stop b1", "snapshot rm snap-ask-b1", "snapshot create --force --from b1 snap-ask-b1"]);
});

test("parkWaitingBox: a failed stop aborts (box stays up, nothing lost)", async () => {
  const calls: string[][] = [];
  const io = { msb: async (args: string[]) => (calls.push(args), { code: args[0] === "stop" ? 1 : 0, stdout: "", stderr: "busy" }) };
  assert.equal(await parkWaitingBox(io, "b1"), false);
  assert.equal(calls.length, 1);
});

test("parkWaitingBox: a failed snapshot RESTARTS the box (never park without a safety copy)", async () => {
  const calls: string[][] = [];
  const io = {
    msb: async (args: string[]) => (calls.push(args), { code: args[0] === "snapshot" && args[1] === "create" ? 1 : 0, stdout: "", stderr: "" }),
  };
  assert.equal(await parkWaitingBox(io, "b1"), false);
  assert.ok(calls.some((c) => c[0] === "start" && c[1] === "b1"), "the box must be brought back up");
});

test("a parked (waiting) box is held to the park TTL, not the sleep TTL", () => {
  const sleepTtl = 3600;
  const parkTtl = 48 * 3600;
  // asleep 5h with a pending question: the old rule reaped it, the park TTL holds it.
  assert.equal(shouldKeepStopped(5 * 3600, sleepTtl, false), false, "baseline: sleep TTL alone reaps");
  assert.equal(shouldKeepStopped(5 * 3600, parkTtl, false), true, "park TTL holds the same box");
});
