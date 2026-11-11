import { test } from "node:test";
import assert from "node:assert/strict";
import { CANARY_TASK, CANARY_TOKEN, canaryAlertText, canaryVerdict, isCanaryTask, makeCanary, type CanaryResult } from "../src/canary.ts";

test("the canary task is recognisable and asks for the token only", () => {
  assert.equal(isCanaryTask(CANARY_TASK), true);
  assert.equal(isCanaryTask("  " + CANARY_TASK), true);
  assert.equal(isCanaryTask("fix the login bug"), false);
  assert.equal(isCanaryTask(undefined), false);
  assert.ok(CANARY_TASK.includes(CANARY_TOKEN));
});

test("canaryVerdict: token in a clean finish passes; anything else fails with a reason", () => {
  assert.deepEqual(canaryVerdict({ runState: "done", exitCode: 0, log: `● session started\n${CANARY_TOKEN}\n`, ms: 9800 }), { ok: true, ms: 9800, detail: "replied in 9.8s" });
  assert.match(canaryVerdict({ runState: "done", exitCode: 0, log: "hello", ms: 1000 }).detail, /without saying CANARY-OK/);
  assert.match(canaryVerdict({ runState: "done", exitCode: 1, log: "boom\nENOSPC", ms: 1000 }).detail, /^exit 1: boom \| ENOSPC/);
  assert.match(canaryVerdict({ runState: "running", log: "", ms: 180_000, timedOut: true }).detail, /no finish within 180\.0s/);
  assert.match(canaryVerdict({ runState: "waiting", log: "", ms: 5000 }).detail, /run state waiting/);
});

test("makeCanary: alerts on failure, is silent while failing inside the cooldown, says recovered once", async () => {
  let now = 0;
  const results: CanaryResult[] = [];
  const notified: Array<[boolean, number]> = [];
  const c = makeCanary(
    {
      run: async () => results.shift() ?? { ok: true, ms: 1, detail: "replied" },
      notify: (s, recovered) => void notified.push([recovered, s.failures]),
      now: () => now,
    },
    { intervalMs: 1000, alertCooldownMs: 100 }
  );
  results.push({ ok: false, ms: 1, detail: "f1" }, { ok: false, ms: 1, detail: "f2" }, { ok: false, ms: 1, detail: "f3" }, { ok: true, ms: 1, detail: "r" }, { ok: true, ms: 1, detail: "r2" });
  now = 10;
  await c.runNow(); // fail 1: alert
  now = 20;
  await c.runNow(); // fail 2: inside the cooldown
  now = 200;
  await c.runNow(); // fail 3: cooldown over, alert again
  await c.runNow(); // pass: recovered
  await c.runNow(); // pass: silence
  assert.deepEqual(notified, [
    [false, 1],
    [false, 3],
    [true, 0],
  ]);
  assert.equal(c.state()?.ok, true);
  assert.equal(c.state()?.lastOkAt, 200);
});

test("makeCanary: a throwing run is a failure, not a crash; runs never overlap", async () => {
  let running = 0;
  let max = 0;
  const c = makeCanary(
    {
      run: async () => {
        running++;
        max = Math.max(max, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        throw new Error("ssh down");
      },
      notify: () => {},
    },
    { intervalMs: 1000 }
  );
  await Promise.all([c.runNow(), c.runNow(), c.runNow()]);
  assert.equal(max, 1);
  assert.match(c.state()?.detail ?? "", /canary could not run: ssh down/);
  assert.equal(c.state()?.failures, 1);
});

test("canaryAlertText", () => {
  assert.match(canaryAlertText({ ok: false, ms: 1, detail: "exit 1", at: 0, failures: 2 }, false, "https://x/"), /^Canary failed 2 times in a row: .*https:\/\/x\/dashboard\/#\/sandboxes$/);
  assert.match(canaryAlertText({ ok: true, ms: 1, detail: "replied in 9s", at: 0, failures: 0 }, true, ""), /^Canary recovered/);
});
