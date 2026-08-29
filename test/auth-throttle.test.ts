import test from "node:test";
import assert from "node:assert/strict";
import { makeAuthThrottle, clientOf, makeRateLimiter } from "../src/auth-throttle.js";

test("rate limiter: sliding window per key", () => {
  let t = 0;
  const rl = makeRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  assert.equal(rl.over("a"), false);
  assert.equal(rl.over("a"), false);
  assert.equal(rl.over("a"), false);
  assert.equal(rl.over("a"), true, "4th in the window");
  assert.equal(rl.over("b"), false, "other keys unaffected");
  t = 1001;
  assert.equal(rl.over("a"), false, "window slid");
});

test("auth throttle: blocks after the limit within the window, forgets after it", () => {
  let t = 1_000_000;
  const th = makeAuthThrottle({ limit: 3, windowMs: 1000, now: () => t });
  assert.equal(th.blocked("a"), false);
  th.fail("a");
  th.fail("a");
  assert.equal(th.blocked("a"), false);
  th.fail("a");
  assert.equal(th.blocked("a"), true);
  assert.equal(th.blocked("b"), false, "other clients unaffected");
  t += 1001;
  assert.equal(th.blocked("a"), false, "window elapsed");
});

test("auth throttle: client identity prefers the first forwarded hop", () => {
  assert.equal(clientOf({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, "10.0.0.2"), "1.2.3.4");
  assert.equal(clientOf({}, "10.0.0.2"), "10.0.0.2");
  assert.equal(clientOf({}, undefined), "unknown");
});
