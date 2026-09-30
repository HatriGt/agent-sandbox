import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBudget, parseBudgetState, sumUsage, priceFor, costUsd, checkBudget, isStalled, usdEnforceable } from "../src/budget.js";
import { detectTransitions } from "../src/notify.js";

test("normalizeBudget requires maxMinutes and rejects bad numbers", () => {
  assert.equal(normalizeBudget(undefined), undefined);
  assert.deepEqual(normalizeBudget({ maxMinutes: 30, maxTokens: 1000.4 }), { maxMinutes: 30, maxTokens: 1000 });
  assert.throws(() => normalizeBudget({ maxUsd: 5 }), /maxMinutes is required/);
  assert.throws(() => normalizeBudget({ maxMinutes: -1 }));
  assert.throws(() => normalizeBudget({ maxMinutes: 99999 }));
});

test("parseBudgetState keeps tripped caps and tolerates junk", () => {
  assert.equal(parseBudgetState("not json"), undefined);
  const s = parseBudgetState(JSON.stringify({ maxMinutes: 5, model: "m", startedAt: 1000, tripped: ["minutes", "bogus"] }));
  assert.deepEqual(s, { maxMinutes: 5, model: "m", startedAt: 1000, tripped: ["minutes"] });
});

test("sumUsage adds every usage line", () => {
  const u = sumUsage("x\n⟦usage⟧ in=100 out=20 ctx=5\nfoo\n⟦usage⟧ in=50 out=5 ctx=1\n");
  assert.deepEqual(u, { inputTokens: 150, outputTokens: 25 });
});

test("unknown model price is undefined: tokens only, never guessed dollars", () => {
  assert.equal(priceFor("some-unknown-model", {}), undefined);
  assert.equal(costUsd({ inputTokens: 1e6, outputTokens: 0 }, "some-unknown-model", {}), undefined);
  assert.equal(costUsd({ inputTokens: 1e6, outputTokens: 1e6 }, "claude-sonnet-4-5", {}), 18);
  assert.deepEqual(priceFor("x", { MSB_MODEL_PRICES: '{"x":{"in":1,"out":2}}' }), { in: 1, out: 2 });
  assert.equal(usdEnforceable({ maxMinutes: 1, maxUsd: 1 }, "unknown", {}), false);
});

test("checkBudget trips each cap once", () => {
  const usage = { inputTokens: 600, outputTokens: 500 };
  const base = { maxMinutes: 10, maxTokens: 1000, maxUsd: 0.001, model: "claude-sonnet-4-5", startedAt: 1 };
  assert.equal(checkBudget({ ...base }, { nowMs: 11 * 60_000, usage })?.cap, "minutes");
  assert.equal(checkBudget({ ...base, tripped: ["minutes"] }, { nowMs: 11 * 60_000, usage }, {})?.cap, "tokens");
  assert.equal(checkBudget({ ...base, tripped: ["minutes", "tokens"] }, { nowMs: 11 * 60_000, usage }, {})?.cap, "usd");
  assert.equal(checkBudget({ ...base, tripped: ["minutes", "tokens", "usd"] }, { nowMs: 11 * 60_000, usage }, {}), null);
  // Unpriced model: the usd cap cannot fire.
  assert.equal(checkBudget({ maxMinutes: 10, maxUsd: 0.0001, model: "nope", startedAt: 1 }, { nowMs: 1, usage }, {}), null);
  assert.match(checkBudget({ ...base }, { nowMs: 11 * 60_000, usage })!.question, /continue/);
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
