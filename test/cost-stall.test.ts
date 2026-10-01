import { test } from "node:test";
import assert from "node:assert/strict";
import { sumUsage, priceFor, costUsd } from "../src/cost.js";
import { isStalled } from "../src/stall.js";
import { detectTransitions } from "../src/notify.js";

test("sumUsage adds every usage line", () => {
  const u = sumUsage("x\n⟦usage⟧ in=100 out=20 ctx=5\nfoo\n⟦usage⟧ in=50 out=5 ctx=1\n");
  assert.deepEqual(u, { inputTokens: 150, outputTokens: 25 });
});

test("unknown model price is undefined: tokens only, never guessed dollars", () => {
  assert.equal(priceFor("some-unknown-model", {}), undefined);
  assert.equal(costUsd({ inputTokens: 1e6, outputTokens: 0 }, "some-unknown-model", {}), undefined);
  assert.equal(costUsd({ inputTokens: 1e6, outputTokens: 1e6 }, "claude-sonnet-4-5", {}), 18);
  assert.deepEqual(priceFor("x", { MSB_MODEL_PRICES: '{"x":{"in":1,"out":2}}' }), { in: 1, out: 2 });
});

test("isStalled only for quiet running runs", () => {
  const now = 1_000_000_000;
  assert.equal(isStalled("running", now / 1000 - 11 * 60, now), true);
  assert.equal(isStalled("running", now / 1000 - 60, now), false);
  assert.equal(isStalled("waiting", now / 1000 - 11 * 60, now), false);
});

test("notify fires stalled once on the edge", () => {
  const prev = [{ name: "b", runState: "running" as const }];
  const next = [{ name: "b", runState: "running" as const, stalled: true, lastOutputAt: Date.now() / 1000 - 600 }];
  const ev = detectTransitions(prev, next);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "stalled");
  assert.equal(detectTransitions(next, next).length, 0);
});
