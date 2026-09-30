/**
 * Answer from the notification (src/answer-choice.ts + src/push.ts): choice parsing, the push
 * payload's privacy, and the one-use nonce's answer-once / idempotent semantics.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.ts";
import { claimNonce, LABEL_MAX, mintNonce, NONCE_TTL_MS, questionChoices, releaseNonce } from "../src/answer-choice.ts";
import { buildPushMessages } from "../src/push.ts";
import { parseQuestion, questionChoices as webChoices } from "../web/src/lib/question.ts";

const Q = [
  "Which fix should I apply for the flaky checkout test?",
  "",
  "It fails 1 in 20 runs on CI; secret sk-live-abc is in the fixture.",
  "",
  "Options:",
  "- Mock the clock | freeze Date.now in the test",
  "- Widen tolerance",
  "- Skip the test for now",
  "- Rewrite the test entirely",
].join("\n");

test("choices: first 3 options, label before ' | ', full line as the answer", () => {
  const c = questionChoices(Q);
  assert.equal(c.length, 3);
  assert.deepEqual(c[0], { label: "Mock the clock", answer: "Mock the clock | freeze Date.now in the test" });
  assert.deepEqual(c[1], { label: "Widen tolerance", answer: "Widen tolerance" });
});

test("choices: free-form or single-option questions have none; long labels truncate", () => {
  assert.deepEqual(questionChoices("What should the DB be called?"), []);
  assert.deepEqual(questionChoices("Proceed?\n\nOptions:\n- Yes"), []);
  const long = questionChoices(`Q?\n\nOptions:\n- ${"x".repeat(80)}\n- b`);
  assert.equal(long[0].label.length, LABEL_MAX);
  assert.ok(long[0].label.endsWith("…"));
});

test("web/mobile parser agrees with the server on labels and answers", () => {
  assert.deepEqual(webChoices(parseQuestion(Q)), questionChoices(Q));
});

test("push: choice labels + nonce, never the question text or context", () => {
  const [m] = buildPushMessages({ box: "b1", kind: "waiting", question: Q }, ["ExpoPushToken[xxxxxxxxxx]"], "Fix checkout", {
    labels: ["Mock the clock", "Widen tolerance", "Skip the test for now"],
    nonce: "n0nce-value-123",
  });
  assert.equal(m.body, "Needs an answer · 1 Mock the clock · 2 Widen tolerance · 3 Skip the test for now");
  assert.equal(m.categoryId, "ask-choices-3");
  assert.equal(m.data.nonce, "n0nce-value-123");
  const visible = `${m.title} ${m.body}`;
  assert.ok(!visible.includes("flaky"));
  assert.ok(!visible.includes("sk-live"));
  assert.ok(!visible.includes("n0nce"));
});

test("push: no choices on done/failed, and no category without choices", () => {
  const [d] = buildPushMessages({ box: "b1", kind: "done" }, ["ExpoPushToken[xxxxxxxxxx]"], "t", { labels: ["a", "b"], nonce: "nnnnnnnnnn" });
  assert.equal(d.categoryId, undefined);
  assert.equal(d.data.nonce, undefined);
  const [w] = buildPushMessages({ box: "b1", kind: "waiting" }, ["ExpoPushToken[xxxxxxxxxx]"], "t");
  assert.equal(w.body, "Needs an answer");
  assert.equal(w.categoryId, undefined);
});

test("nonce: answers once; same choice replays idempotently; a different choice is refused", () => {
  const db = openMemoryDb();
  const n = mintNonce(db, "u1", "b1", Q);
  const r1 = claimNonce(db, { owner: "u1", box: "b1", nonce: n, choice: 1, currentQuestion: Q });
  assert.ok(r1.ok && !r1.already);
  assert.equal(r1.ok && r1.choice.answer, "Widen tolerance");
  // The question is gone once answered: a replay is still a success, but does nothing.
  const r2 = claimNonce(db, { owner: "u1", box: "b1", nonce: n, choice: 1, currentQuestion: undefined });
  assert.ok(r2.ok && r2.already);
  const r3 = claimNonce(db, { owner: "u1", box: "b1", nonce: n, choice: 0, currentQuestion: Q });
  assert.deepEqual(r3, { ok: false, status: 409, error: "this question was already answered" });
});

test("nonce: a sibling (reminder push) nonce dies when any one is used", () => {
  const db = openMemoryDb();
  const a = mintNonce(db, "u1", "b1", Q);
  const b = mintNonce(db, "u1", "b1", Q);
  assert.ok(claimNonce(db, { owner: "u1", box: "b1", nonce: a, choice: 0, currentQuestion: Q }).ok);
  const r = claimNonce(db, { owner: "u1", box: "b1", nonce: b, choice: 0, currentQuestion: Q });
  assert.equal(r.ok, false);
});

test("nonce: wrong owner/box looks unknown; stale question, bad input and expiry are refused", () => {
  const db = openMemoryDb();
  const now = 1_000_000;
  const n = mintNonce(db, "u1", "b1", Q, now);
  assert.equal((claimNonce(db, { owner: "u2", box: "b1", nonce: n, choice: 0, currentQuestion: Q }, now) as { status: number }).status, 404);
  assert.equal((claimNonce(db, { owner: "u1", box: "b2", nonce: n, choice: 0, currentQuestion: Q }, now) as { status: number }).status, 404);
  assert.equal((claimNonce(db, { owner: "u1", box: "b1", nonce: n, choice: 0, currentQuestion: "A different question?" }, now) as { status: number }).status, 409);
  assert.equal((claimNonce(db, { owner: "u1", box: "b1", nonce: n, choice: 7, currentQuestion: Q }, now) as { status: number }).status, 400);
  assert.equal((claimNonce(db, { owner: "u1", box: "b1", nonce: 42, choice: 0, currentQuestion: Q }, now) as { status: number }).status, 400);
  assert.equal((claimNonce(db, { owner: "u1", box: "b1", nonce: n, choice: 0, currentQuestion: Q }, now + NONCE_TTL_MS + 1) as { status: number }).status, 410);
  // None of the refusals consumed it.
  assert.ok(claimNonce(db, { owner: "u1", box: "b1", nonce: n, choice: 0, currentQuestion: Q }, now).ok);
});

test("nonce: release after a failed delivery lets the user retry", () => {
  const db = openMemoryDb();
  const n = mintNonce(db, "u1", "b1", Q);
  assert.ok(claimNonce(db, { owner: "u1", box: "b1", nonce: n, choice: 0, currentQuestion: Q }).ok);
  releaseNonce(db, n);
  const r = claimNonce(db, { owner: "u1", box: "b1", nonce: n, choice: 2, currentQuestion: Q });
  assert.ok(r.ok && !r.already);
});
