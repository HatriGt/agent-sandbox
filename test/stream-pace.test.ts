/**
 * Pacing maths for the streaming prose reveal (web/src/lib/stream-pace.ts): steady speed, smooth
 * catch-up, end-of-stream flush, grapheme-safe splitting, resume-from-common-prefix, and where the
 * fresh-word fade may start without breaking inline markdown.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_CPS,
  CATCHUP_SEC,
  FLUSH_SEC,
  MAX_FRAME_MS,
  charsOf,
  commonPrefixLength,
  freshStart,
  freshWords,
  graphemeEnds,
  graphemesWithin,
  initialPace,
  resumeAt,
  stepPace,
  targetRate,
  type PaceState,
} from "../web/src/lib/stream-pace.ts";

/** Run frames of `dt` ms until caught up; returns the time it took and the largest single step. */
function run(total: number, live: boolean, dt = 16, start: PaceState = initialPace()) {
  let s = start;
  let t = 0;
  let maxStep = 0;
  while (s.pos < total && t < 10_000) {
    const n = stepPace(s, total, dt, live);
    maxStep = Math.max(maxStep, n.pos - s.pos);
    s = n;
    t += dt;
  }
  return { ms: t, maxStep, state: s };
}

test("a feed arriving at the steady rate is revealed at BASE_CPS, never ahead of it", () => {
  // 15 chars every 160ms ≈ 94 cps for two seconds: the backlog stays small, so the floor rules.
  let s = initialPace();
  let total = 0;
  for (let t = 0; t < 2000; t += 16) {
    if (t % 160 === 0) total += 15;
    s = stepPace(s, total, 16, true);
    assert.ok(s.pos <= total);
  }
  assert.ok(s.pos > BASE_CPS * 2 * 0.85 && s.pos <= BASE_CPS * 2 * 1.1, `revealed ${s.pos} in 2s`);
  assert.ok(Math.abs(s.rate - BASE_CPS) < 5, `rate settled at ${s.rate}`);
});

test("target rate is the floor when the backlog is small and scales with it when large", () => {
  assert.equal(targetRate(5, true), BASE_CPS);
  assert.equal(targetRate(600, true), 600 / CATCHUP_SEC);
  assert.equal(targetRate(600, false), 600 / FLUSH_SEC);
});

test("a big backlog closes in about CATCHUP_SEC without dumping", () => {
  const { ms, maxStep } = run(900, true);
  assert.ok(ms >= 250 && ms <= 450, `closed in ${ms}ms`);
  // Never a dump: no frame reveals more than a modest slice of the backlog.
  assert.ok(maxStep < 900 * 0.1, `max step ${maxStep}`);
});

test("the pace rises smoothly: the first frames are slower than the cruising frames", () => {
  let s = initialPace();
  const a = stepPace(s, 900, 16, true);
  s = a;
  for (let i = 0; i < 6; i++) s = stepPace(s, 900, 16, true);
  const b = stepPace(s, 900, 16, true);
  assert.ok(a.pos - initialPace().pos < b.pos - s.pos, "first step smaller than a later one");
});

test("when live ends the remainder flushes in about FLUSH_SEC", () => {
  const { ms } = run(300, false);
  assert.ok(ms >= 100 && ms <= 220, `flushed in ${ms}ms`);
});

test("a long frame (background tab) is clamped, so waking never dumps", () => {
  const s = stepPace(initialPace(), 5000, 4000, true);
  const clamped = stepPace(initialPace(), 5000, MAX_FRAME_MS, true);
  assert.equal(s.pos, clamped.pos);
});

test("caught up: position clamps to the total", () => {
  const s = stepPace({ pos: 50, rate: 400 }, 20, 16, true);
  assert.equal(s.pos, 20);
});

test("grapheme ends never split a surrogate pair, ZWJ sequence or combining mark", () => {
  const text = "a\u{1F468}‍\u{1F469}‍\u{1F467}é\u{1F1EC}\u{1F1E7}z";
  const ends = graphemeEnds(text);
  const parts = ends.map((e, i) => text.slice(i === 0 ? 0 : ends[i - 1], e));
  assert.deepEqual(parts, ["a", "\u{1F468}‍\u{1F469}‍\u{1F467}", "é", "\u{1F1EC}\u{1F1E7}", "z"]);
  // Every cut lands on a code-point boundary.
  for (const e of ends) {
    const c = text.charCodeAt(e);
    assert.ok(Number.isNaN(c) || c < 0xdc00 || c > 0xdfff, `cut at ${e} splits a surrogate`);
  }
  assert.equal(graphemesWithin(ends, 1), 1);
  assert.equal(graphemesWithin(ends, 3), 1); // half way through the family: not yet
  assert.equal(charsOf(ends, 2), 1 + 8);
  assert.equal(charsOf(ends, 0), 0);
  assert.equal(charsOf(ends, 99), text.length);
});

test("plain ASCII graphemes are one per character", () => {
  assert.deepEqual(graphemeEnds("abc"), [1, 2, 3]);
  assert.deepEqual(graphemeEnds(""), []);
});

test("replacement resumes from the longest common prefix, never from zero, never rewinding unchanged text", () => {
  assert.equal(commonPrefixLength("hello world", "hello there"), 6);
  // Appended: keep everything shown.
  assert.equal(resumeAt("hello", "hello world", 5), 5);
  // Replaced after the prefix while the reveal was past it: back to the prefix, not to zero.
  assert.equal(resumeAt("hello world", "hello there", 9), 6);
  // Replaced after the prefix while the reveal was still inside it: nothing moves.
  assert.equal(resumeAt("hello world", "hello there", 3), 3);
  // Shrunk to a prefix: clamp to the new length.
  assert.equal(resumeAt("hello world", "hello", 9), 5);
});

test("freshStart: plain prose fades from the word containing `from`", () => {
  const text = "The limiter now keeps six buckets per key";
  const at = freshStart(text, text.length - 12)!;
  assert.equal(text.slice(at), "buckets per key");
});

test("freshStart: never inside an open fence or on a table row", () => {
  assert.equal(freshStart("intro\n```ts\nconst a = 1", 15), null);
  assert.equal(freshStart("| a | b |\n| --- | --- |\n| one | two", 30), null);
  // A closed fence followed by prose is fine again.
  const t = "```ts\nx\n```\nand then prose continues here";
  assert.equal(t.slice(freshStart(t, t.length - 8)!), "continues here");
});

test("freshStart: starts after the last inline syntax character and after a bare URL", () => {
  const bold = "see **the docs** for a better explanation";
  assert.equal(bold.slice(freshStart(bold, 6)!), "for a better explanation");
  const code = "run `npm test` then commit";
  assert.equal(code.slice(freshStart(code, 0)!), "then commit");
  const link = "read [this](https://x.y/z) and that";
  assert.equal(link.slice(freshStart(link, 0)!), "and that");
  const url = "see https://example.com/path for the details";
  assert.equal(url.slice(freshStart(url, 0)!), "for the details");
  // A URL still being typed: no fade.
  assert.equal(freshStart("see https://example.com/pa", 0), null);
});

test("freshStart: keeps a list marker and the item's first word intact", () => {
  const item = "intro\n- allows a burst under the limit";
  assert.equal(item.slice(freshStart(item, 6)!), "a burst under the limit");
  const num = "1. Exits early when the key is missing";
  assert.equal(num.slice(freshStart(num, 0)!), "early when the key is missing");
  const head = "## Sliding-window limiter is in";
  assert.equal(head.slice(freshStart(head, 0)!), "Sliding-window limiter is in");
});

test("freshStart: null when nothing after the floor is left to fade", () => {
  assert.equal(freshStart("abc", 3), null);
  assert.equal(freshStart("- only", 0), null);
  assert.equal(freshStart("a `b`", 0), null);
});

test("freshWords keeps whitespace attached and offsets stable", () => {
  assert.deepEqual(freshWords("per key  in"), [
    { at: 0, text: "per " },
    { at: 4, text: "key  " },
    { at: 9, text: "in" },
  ]);
});
