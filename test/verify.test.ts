/**
 * Verified outcomes — "done" means proven (docs/features-2026-09.md §3).
 *
 * verifyPlanOf validates the caller's verify clause; parseVerdict reads the co-pilot's judgement;
 * runVerification is IO-injected so both modes are tested without a box. TDD: written before
 * src/verify.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { verifyPlanOf, parseVerdict, runVerification, verdictPrompt, formatVerifyResult } from "../src/verify.ts";

/* ── plan validation ─────────────────────────────────────────────────────── */

test("verify plan: exactly one of command | criterion, non-empty, length-capped", () => {
  assert.deepEqual(verifyPlanOf({ command: "npm test" }), { ok: true, plan: { mode: "command", command: "npm test" } });
  assert.deepEqual(verifyPlanOf({ criterion: "GET /x returns 401 without a token" }), {
    ok: true,
    plan: { mode: "criterion", criterion: "GET /x returns 401 without a token" },
  });
  for (const bad of [
    {},
    { command: "", criterion: "" },
    { command: "npm test", criterion: "also this" },
    { command: "x".repeat(4001) },
    { criterion: "x".repeat(4001) },
  ]) {
    const r = verifyPlanOf(bad as Record<string, unknown>);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(!r.ok && r.question.length > 0);
  }
});

test("verify plan: undefined input means no verification (ok, no plan)", () => {
  assert.deepEqual(verifyPlanOf(undefined), { ok: true, plan: undefined });
});

/* ── verdict parsing ─────────────────────────────────────────────────────── */

test("parseVerdict reads VERDICT: pass|fail with the reason, case-insensitively, anywhere in the answer", () => {
  assert.deepEqual(parseVerdict("Checked the route.\nVERDICT: pass — 401 confirmed"), { pass: true, detail: "401 confirmed" });
  assert.deepEqual(parseVerdict("verdict: FAIL - the endpoint returns 200"), { pass: false, detail: "the endpoint returns 200" });
});

test("parseVerdict: a missing or ambiguous verdict is a FAIL with an honest detail — never a silent pass", () => {
  const r = parseVerdict("Everything looks great to me!");
  assert.equal(r.pass, false);
  assert.match(r.detail, /no verdict/i);
  // The LAST verdict wins when the co-pilot corrects itself.
  const r2 = parseVerdict("VERDICT: pass — hm wait\nVERDICT: fail — actually the test is red");
  assert.equal(r2.pass, false);
});

/* ── runVerification (IO injected) ───────────────────────────────────────── */

test("command mode: exit 0 is pass, nonzero is fail with the tail of the output", async () => {
  const pass = await runVerification(
    { mode: "command", command: "npm test" },
    {
      execCommand: async (cmd) => ({ code: 0, output: `ran ${cmd}\nall green` }),
      askCriterion: async () => {
        throw new Error("must not be called");
      },
    }
  );
  assert.deepEqual(pass, { mode: "command", pass: true, detail: "all green" });

  const fail = await runVerification(
    { mode: "command", command: "npm test" },
    { execCommand: async () => ({ code: 1, output: "2 tests failed" }), askCriterion: async () => ({ answer: "" }) }
  );
  assert.equal(fail.pass, false);
  assert.match(fail.detail, /2 tests failed/);
});

test("criterion mode: the co-pilot's answer is parsed for the verdict", async () => {
  const r = await runVerification(
    { mode: "criterion", criterion: "the endpoint requires auth" },
    {
      execCommand: async () => {
        throw new Error("must not be called");
      },
      askCriterion: async (prompt) => {
        assert.match(prompt, /VERDICT/);
        assert.match(prompt, /the endpoint requires auth/);
        return { answer: "I curled it without a token and got 401.\nVERDICT: pass — 401 without a token" };
      },
    }
  );
  assert.deepEqual(r, { mode: "criterion", pass: true, detail: "401 without a token" });
});

test("a verification that itself blows up is a fail with the error, never a throw", async () => {
  const r = await runVerification(
    { mode: "command", command: "npm test" },
    { execCommand: async () => { throw new Error("ssh died"); }, askCriterion: async () => ({ answer: "" }) }
  );
  assert.equal(r.pass, false);
  assert.match(r.detail, /ssh died/);
});

/* ── prompt + result formatting ──────────────────────────────────────────── */

test("verdictPrompt tells the co-pilot it is a verifier, includes the criterion, demands the VERDICT line", () => {
  const p = verdictPrompt("all new code has tests");
  assert.match(p, /verif/i);
  assert.match(p, /all new code has tests/);
  assert.match(p, /VERDICT: pass|VERDICT: fail/);
});

test("formatVerifyResult renders pass/fail one-liners for transcripts and notifications", () => {
  assert.match(formatVerifyResult({ mode: "command", pass: true, detail: "all green" }), /verified/i);
  const f = formatVerifyResult({ mode: "criterion", pass: false, detail: "endpoint returns 200" });
  assert.match(f, /UNVERIFIED/);
  assert.match(f, /endpoint returns 200/);
});
