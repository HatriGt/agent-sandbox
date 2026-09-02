/**
 * Notifications — the missing half of walk-away (docs/features-2026-09.md §1).
 *
 * detectTransitions is pure edge detection over two fleet sweeps; makeNotifier dedupes and
 * swallows send failures; formatNotification produces the one-line headline + dashboard link.
 * TDD: this file was written before src/notify.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectTransitions,
  makeNotifier,
  formatNotification,
  isValidWebhookUrl,
  type BoxRunView,
  type NotifyEvent,
} from "../src/notify.ts";

const box = (name: string, runState: BoxRunView["runState"], extra: Partial<BoxRunView> = {}): BoxRunView => ({
  name,
  runState,
  ...extra,
});

test("running→waiting fires exactly one waiting event carrying the question", () => {
  const prev = [box("b1", "running")];
  const next = [box("b1", "waiting", { question: "Which branch?" })];
  assert.deepEqual(detectTransitions(prev, next), [
    { box: "b1", kind: "waiting", question: "Which branch?" },
  ]);
});

test("running→done exit 0 is done; nonzero exit is failed with the code", () => {
  const prev = [box("a", "running"), box("b", "running")];
  const next = [box("a", "done", { exitCode: 0 }), box("b", "done", { exitCode: 1 })];
  assert.deepEqual(detectTransitions(prev, next), [
    { box: "a", kind: "done", exitCode: 0 },
    { box: "b", kind: "failed", exitCode: 1 },
  ]);
});

test("exit 254/253 are failed with an interruption note", () => {
  const prev = [box("a", "running"), box("b", "running")];
  const next = [box("a", "done", { exitCode: 254 }), box("b", "done", { exitCode: 253 })];
  const evs = detectTransitions(prev, next);
  assert.equal(evs.length, 2);
  assert.ok(evs.every((e) => e.kind === "failed"));
  assert.match(evs[0].note ?? "", /interrupted/i);
  assert.match(evs[1].note ?? "", /stopped/i);
});

test("a box first seen already terminal fires nothing (restart hydration must not replay history)", () => {
  const next = [box("old", "done", { exitCode: 0 }), box("q", "waiting", { question: "?" })];
  assert.deepEqual(detectTransitions([], next), []);
});

test("no edge, no event: steady states and disappearing boxes are silent", () => {
  const prev = [box("run", "running"), box("wait", "waiting", { question: "q" }), box("gone", "running")];
  const next = [box("run", "running"), box("wait", "waiting", { question: "q" })];
  assert.deepEqual(detectTransitions(prev, next), []);
});

test("waiting→waiting with a NEW question fires again (a second question is news)", () => {
  const prev = [box("b", "waiting", { question: "first?" })];
  const next = [box("b", "waiting", { question: "second?" })];
  assert.deepEqual(detectTransitions(prev, next), [{ box: "b", kind: "waiting", question: "second?" }]);
});

test("waiting→done fires done (answered and finished while unwatched)", () => {
  const prev = [box("b", "waiting", { question: "q" })];
  const next = [box("b", "done", { exitCode: 0 })];
  assert.deepEqual(detectTransitions(prev, next), [{ box: "b", kind: "done", exitCode: 0 }]);
});

test("done→running→done again fires again (a resumed run's finish is a new finish)", () => {
  const a = detectTransitions([box("b", "done", { exitCode: 0 })], [box("b", "running")]);
  assert.deepEqual(a, []);
  const b = detectTransitions([box("b", "running")], [box("b", "done", { exitCode: 0 })]);
  assert.equal(b.length, 1);
});

/* ── makeNotifier ─────────────────────────────────────────────────────────── */

test("notifier posts each event once and dedupes an identical re-detection inside the window", async () => {
  const sent: NotifyEvent[] = [];
  let t = 1000;
  const n = makeNotifier({ send: async (e) => void sent.push(e), cooldownMs: 60_000, now: () => t });
  const ev: NotifyEvent = { box: "b", kind: "waiting", question: "q" };
  await n.notify(ev);
  await n.notify(ev); // same box+kind+question inside the window: suppressed
  assert.equal(sent.length, 1);
  t += 61_000;
  await n.notify(ev); // window elapsed: a still-unanswered question may re-fire
  assert.equal(sent.length, 2);
});

test("a different question on the same box is not deduped", async () => {
  const sent: NotifyEvent[] = [];
  const n = makeNotifier({ send: async (e) => void sent.push(e) });
  await n.notify({ box: "b", kind: "waiting", question: "one?" });
  await n.notify({ box: "b", kind: "waiting", question: "two?" });
  assert.equal(sent.length, 2);
});

test("a send failure is swallowed and does not poison the dedupe (retry allowed next time)", async () => {
  let calls = 0;
  const n = makeNotifier({
    send: async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    },
  });
  await assert.doesNotReject(() => n.notify({ box: "b", kind: "done" }));
  await n.notify({ box: "b", kind: "done" }); // first send failed => not marked sent => retried
  assert.equal(calls, 2);
});

/* ── formatNotification ───────────────────────────────────────────────────── */

test("formatter: waiting leads with the question, done with the outcome, failed with the code", () => {
  const base = { publicUrl: "https://asb.example", title: "Fix retry logic" };
  const w = formatNotification({ box: "b1", kind: "waiting", question: "Merge to main?" }, base);
  assert.match(w.text, /needs an answer/i);
  assert.match(w.text, /Merge to main\?/);
  assert.match(w.text, /Fix retry logic/);
  assert.equal(w.url, "https://asb.example/dashboard/#/box/b1");

  const d = formatNotification({ box: "b1", kind: "done", exitCode: 0 }, base);
  assert.match(d.text, /finished/i);

  const f = formatNotification({ box: "b1", kind: "failed", exitCode: 254, note: "interrupted by a restart" }, base);
  assert.match(f.text, /failed|interrupted/i);
  assert.match(f.text, /254|interrupted/);
});

test("formatter falls back to the box name when there is no title, and headline enriches done", () => {
  const d = formatNotification({ box: "b9", kind: "done", exitCode: 0 }, { publicUrl: "https://x", headline: "done · 3 files · 4 steps" });
  assert.match(d.text, /b9/);
  assert.match(d.text, /3 files/);
});

/* ── webhook URL validation ───────────────────────────────────────────────── */

test("webhook URLs must be http(s), have a host, and carry no credentials", () => {
  assert.equal(isValidWebhookUrl("https://hooks.slack.com/services/T/B/x"), true);
  assert.equal(isValidWebhookUrl("http://ntfy.internal:8080/topic"), true);
  for (const bad of [
    "ftp://x/y",
    "javascript:alert(1)",
    "https://user:pass@host/hook", // credentials would end up in the stored blob AND the request line
    "not a url",
    "",
    "https://",
  ]) {
    assert.equal(isValidWebhookUrl(bad), false, bad);
  }
});
