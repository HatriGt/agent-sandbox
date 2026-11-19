import { test } from "node:test";
import assert from "node:assert/strict";
import { NAP_TURN_GRACE_MS, shouldNap } from "../src/nap.ts";

const now = 1_800_000_000_000;
const base = { role: "session", boxStatus: "Running", runState: "done", idleTimeoutSec: 900, nowMs: now };

test("a finished session box quiet for the idle timeout is napped; a working or warm one never", () => {
  assert.equal(shouldNap({ ...base, lastOutputAtSec: now / 1000 - 900 }), true);
  assert.equal(shouldNap({ ...base, lastOutputAtSec: now / 1000 - 899 }), false, "one second short");
  assert.equal(shouldNap({ ...base, runState: "running", lastOutputAtSec: now / 1000 - 5000 }), false, "working");
  assert.equal(shouldNap({ ...base, runState: "waiting", lastOutputAtSec: now / 1000 - 5000 }), false, "the ask-park owns a waiting box");
  assert.equal(shouldNap({ ...base, role: "pool-free", lastOutputAtSec: now / 1000 - 5000 }), false, "a warm box has its own idle limit");
  assert.equal(shouldNap({ ...base, boxStatus: "Stopped", lastOutputAtSec: now / 1000 - 5000 }), false, "already asleep");
  assert.equal(shouldNap({ ...base, lastOutputAtSec: undefined }), false, "nothing to count from");
  assert.equal(shouldNap({ ...base, idleTimeoutSec: 0, lastOutputAtSec: now / 1000 - 5000 }), false, "no idle limit configured");
});

test("a box whose turn the controller just started is left alone until the grace passes", () => {
  const quiet = { ...base, lastOutputAtSec: now / 1000 - 5000 };
  assert.equal(shouldNap({ ...quiet, turnStartedAtMs: now - NAP_TURN_GRACE_MS + 1 }), false);
  assert.equal(shouldNap({ ...quiet, turnStartedAtMs: now - NAP_TURN_GRACE_MS }), true);
});
