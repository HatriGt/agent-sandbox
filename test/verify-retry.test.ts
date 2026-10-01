/**
 * Done means verified — the retry loop (plan phase 3). A harness run whose verification failed is
 * sent back with the failure (harness rule autoRetry), at most that many times, never when the run
 * ended on a question; the digest records how many times it happened.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { autoRetryOf, makeVerifyRetrier, runVerification, verifyRetryMessage, type VerifyResult } from "../src/verify.ts";
import { buildDigest, verifiedLabel } from "../src/digest.ts";
import { buildOutcome } from "../src/outcome.ts";
import { normalizeHarness } from "../src/harness.ts";

const failed: VerifyResult = { mode: "command", pass: false, detail: "1 failing", command: "npm test", code: 1, output: "✓ a\n✗ b\n1 failing" };
const passed: VerifyResult = { mode: "command", pass: true, detail: "2 passing", command: "npm test", code: 0 };

function fakeResume() {
  const sent: Array<{ box: string; message: string }> = [];
  return { sent, resume: async (box: string, message: string) => void sent.push({ box, message }) };
}

test("retry feedback: the command, the exit code, the output tail and the instruction", () => {
  const m = verifyRetryMessage(failed);
  assert.match(m, /^Verification failed: npm test — exit 1\.\n\n/);
  assert.match(m, /✗ b\n1 failing\n\nFix it and re-verify before finishing\.$/);
  // Criterion mode has no output tail: the verdict's reason is the feedback.
  const c = verifyRetryMessage({ mode: "criterion", pass: false, detail: "endpoint 500s" });
  assert.match(c, /^Verification failed: criterion check — exit 1\.\n\nendpoint 500s\n\n/);
});

test("command mode keeps the last 40 lines of a FAILED run for the feedback, nothing on a pass", async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
  const io = { askCriterion: async () => ({ answer: "" }) };
  const r = await runVerification({ mode: "command", command: "x" }, { ...io, execCommand: async () => ({ code: 2, output: lines }) });
  assert.equal(r.code, 2);
  assert.equal(r.output!.split("\n").length, 40);
  assert.ok(r.output!.startsWith("line 21\n") && r.output!.endsWith("line 60"));
  const ok = await runVerification({ mode: "command", command: "x" }, { ...io, execCommand: async () => ({ code: 0, output: lines }) });
  assert.equal(ok.code, 0);
  assert.equal(ok.output, undefined);
});

test("a failed verify with autoRetry=1 issues exactly one resume; the second failure stamps", async () => {
  const f = fakeResume();
  const r = makeVerifyRetrier(f);
  r.arm("box-a", 1);
  assert.equal(await r.consider("box-a", failed, "done"), true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].box, "box-a");
  assert.equal(f.sent[0].message, verifyRetryMessage(failed));
  assert.equal(r.retriesOf("box-a"), 1);
  // The retried turn fails again: budget spent, no second resume.
  assert.equal(await r.consider("box-a", failed, "done"), false);
  assert.equal(f.sent.length, 1);
  assert.equal(r.retriesOf("box-a"), 1);
});

test("a pass, an unarmed box, a missing result and a run ending on a question are never retried", async () => {
  const f = fakeResume();
  const r = makeVerifyRetrier(f);
  r.arm("box-a", 2);
  assert.equal(await r.consider("box-a", passed, "done"), false);
  assert.equal(await r.consider("box-a", undefined, "done"), false);
  assert.equal(await r.consider("box-a", failed, "waiting"), false);
  assert.equal(await r.consider("box-b", failed, "done"), false); // never armed: a hand-typed verify clause
  assert.equal(f.sent.length, 0);
  assert.equal(r.retriesOf("box-a"), 0);
  r.forget("box-a");
  assert.equal(await r.consider("box-a", failed, "done"), false);
});

test("autoRetry=2 allows two resumes; a resume that throws does not spend the budget", async () => {
  let fail = true;
  const sent: string[] = [];
  const r = makeVerifyRetrier({
    resume: async (_box, m) => {
      if (fail) throw new Error("box gone");
      sent.push(m);
    },
    log: () => {},
  });
  r.arm("b", 2);
  assert.equal(await r.consider("b", failed, "done"), false);
  assert.equal(r.retriesOf("b"), 0);
  fail = false;
  assert.equal(await r.consider("b", failed, "done"), true);
  assert.equal(await r.consider("b", failed, "done"), true);
  assert.equal(await r.consider("b", failed, "done"), false);
  assert.equal(sent.length, 2);
  assert.equal(r.retriesOf("b"), 2);
});

test("autoRetry is clamped to 0..2 with 1 as the default; the harness validator rejects anything else", () => {
  assert.equal(autoRetryOf(undefined), 1);
  assert.equal(autoRetryOf(5), 2);
  assert.equal(autoRetryOf(-1), 0);
  assert.equal(autoRetryOf(1.7), 1);
  const h = normalizeHarness({ name: "H", rules: { verifyOnDone: true, autoRetry: 2 } });
  assert.equal(h.rules.autoRetry, 2);
  assert.equal(normalizeHarness({ name: "H", rules: {} }).rules.autoRetry, undefined); // stored blobs from before the rule
  assert.throws(() => normalizeHarness({ name: "H", rules: { autoRetry: 3 } }), /0 to 2/);
  assert.throws(() => normalizeHarness({ name: "H", rules: { autoRetry: "1" } }), /0 to 2/);
});

test("the digest and the outcome card record the retries; the headline says on which try", () => {
  const base = { box: "b", task: "t", runState: "done" as const, exitCode: 0, events: [], files: [] };
  const d = buildDigest({ ...base, verified: passed, retries: 1 });
  assert.equal(d.retries, 1);
  assert.match(d.headline, /verified on 2nd try$/);
  const o = buildOutcome({ digest: d, events: [], log: "", filesKnown: true, diffText: "" });
  assert.deepEqual(o.trust.verified, { pass: true, mode: "command", retries: 1 });
  const twice = buildDigest({ ...base, verified: failed, retries: 2 });
  assert.match(twice.headline, /UNVERIFIED after 3 tries$/);
  // No retries: the field is omitted and the label is the plain one.
  const none = buildDigest({ ...base, verified: passed, retries: 0 });
  assert.equal(none.retries, undefined);
  assert.match(none.headline, /· verified$/);
  assert.equal(verifiedLabel(true, 2), "verified on 3rd try");
  assert.equal(verifiedLabel(false), "UNVERIFIED");
});
