/**
 * Pacing and splitting maths for the streaming prose reveal (components/thread/StreamingMarkdown).
 *
 * Pure functions only — no React, no DOM — so the server's `node:test` suite covers them
 * (test/stream-pace.test.ts). Three concerns live here:
 *
 *  · PACE. The reveal runs at a steady BASE_CPS. When a poll drops a big chunk, the rate rises
 *    (smoothly, never a dump) so the backlog closes in about CATCHUP_SEC; when the stream ends the
 *    rest flushes in about FLUSH_SEC. {@link stepPace} advances one frame.
 *  · GRAPHEMES. The reveal position is counted in grapheme clusters, so a surrogate pair, an emoji
 *    ZWJ sequence or a combining mark is never cut mid-way ({@link graphemeEnds}).
 *  · REPLACEMENT. When the text is replaced rather than appended (a regenerate, a dedupe re-emit)
 *    the reveal resumes from the longest common prefix ({@link commonPrefixLength}) — never from
 *    zero, never visibly rewinding past text that is still the same.
 *
 * Plus {@link freshStart}, which decides where the soft "fresh words" fade may begin without
 * breaking inline markdown at the growing edge.
 */

/** Steady reveal speed, characters (graphemes) per second. */
export const BASE_CPS = 90;
/** A backlog that piles up is closed in about this long. */
export const CATCHUP_SEC = 0.3;
/** Once the stream has ended, the remainder lands in about this long. */
export const FLUSH_SEC = 0.12;
/** A frame longer than this (a background tab waking) is treated as this long, so nothing dumps. */
export const MAX_FRAME_MS = 64;
/** How long a freshly revealed word fades in (keep in sync with styles/streaming.css). */
export const FADE_MS = 240;
/** Zero-width marker inserted into the markdown source where the fresh-word spans begin. */
export const FRESH_SENTINEL = String.fromCharCode(0x200b);

export type PaceState = {
  /** Fractional reveal position, in graphemes. */
  pos: number;
  /** Current speed in graphemes per second (smoothed, so a rate change ramps rather than jumps). */
  rate: number;
};

export function initialPace(pos = 0): PaceState {
  return { pos, rate: BASE_CPS };
}

/** The speed the reveal wants for a given backlog: steady, or whatever closes it in the horizon. */
export function targetRate(backlog: number, live: boolean): number {
  const horizon = live ? CATCHUP_SEC : FLUSH_SEC;
  return Math.max(BASE_CPS, backlog / horizon);
}

/**
 * Advance one animation frame. The rate chases {@link targetRate}: it rises quickly (≈40 ms time
 * constant) so a fresh chunk starts closing at once, and falls slowly (≈600 ms) so the pace holds
 * through the catch-up instead of decaying exponentially — the backlog closes roughly linearly in
 * the horizon, then settles back to BASE_CPS.
 */
export function stepPace(state: PaceState, total: number, dtMs: number, live: boolean): PaceState {
  if (state.pos >= total) return { pos: total, rate: live ? Math.min(state.rate, BASE_CPS) : state.rate };
  const dt = Math.min(Math.max(dtMs, 0), MAX_FRAME_MS) / 1000;
  const backlog = total - state.pos;
  const want = targetRate(backlog, live);
  const tau = want > state.rate ? 0.04 : 0.6;
  const k = 1 - Math.exp(-dt / tau);
  const rate = state.rate + (want - state.rate) * k;
  const pos = Math.min(total, state.pos + rate * dt);
  return { pos, rate };
}

/* ── Graphemes ─────────────────────────────────────────────────────────────────────────────────── */

type Segmenter = { segment(input: string): Iterable<{ index: number; segment: string }> };
let segmenter: Segmenter | null | undefined;
function getSegmenter(): Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    const I = (globalThis as { Intl?: { Segmenter?: new (l: undefined, o: { granularity: string }) => Segmenter } }).Intl;
    segmenter = I?.Segmenter ? new I.Segmenter(undefined, { granularity: "grapheme" }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

const ZWJ = String.fromCharCode(0x200d);
// Combining marks, ZWJ, variation selectors, keycap, skin tones, tag characters.
const EXTEND_RE = new RegExp("[\\p{M}" + ZWJ + String.fromCharCode(0xfe0e, 0xfe0f, 0x20e3) + "\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}]", "u");
const REGIONAL_RE = /[\u{1F1E6}-\u{1F1FF}]/u;

/**
 * End offsets (in UTF-16 code units) of every grapheme cluster, so `text.slice(0, ends[i - 1])`
 * is the first `i` graphemes. Uses Intl.Segmenter when available; the fallback walks code points
 * and glues combining marks, ZWJ sequences, variation selectors, skin tones, keycaps and flag pairs.
 */
export function graphemeEnds(text: string): number[] {
  const ends: number[] = [];
  const seg = getSegmenter();
  if (seg) {
    for (const s of seg.segment(text)) ends.push(s.index + s.segment.length);
    return ends;
  }
  let i = 0;
  let prevRegional = false;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    let j = i + (cp > 0xffff ? 2 : 1);
    const ch = text.slice(i, j);
    const regional = REGIONAL_RE.test(ch);
    // A second regional indicator joins the first into a flag (pairs only).
    if (regional && prevRegional && ends.length) {
      ends[ends.length - 1] = j;
      prevRegional = false;
      i = j;
      continue;
    }
    prevRegional = regional;
    // Swallow extenders; a ZWJ also pulls in the code point after it.
    for (;;) {
      if (j >= text.length) break;
      const ncp = text.codePointAt(j)!;
      const nlen = ncp > 0xffff ? 2 : 1;
      const nch = text.slice(j, j + nlen);
      if (!EXTEND_RE.test(nch)) break;
      j += nlen;
      if (nch === ZWJ && j < text.length) {
        const zcp = text.codePointAt(j)!;
        j += zcp > 0xffff ? 2 : 1;
      }
    }
    ends.push(j);
    i = j;
  }
  return ends;
}

/** Number of whole graphemes that fit inside the first `chars` code units (binary search). */
export function graphemesWithin(ends: number[], chars: number): number {
  let lo = 0;
  let hi = ends.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ends[mid] <= chars) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Code-unit length of the first `count` graphemes. */
export function charsOf(ends: number[], count: number): number {
  const n = Math.max(0, Math.min(Math.floor(count), ends.length));
  return n === 0 ? 0 : ends[n - 1];
}

/* ── Replacement ───────────────────────────────────────────────────────────────────────────────── */

export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/**
 * Where the reveal continues after the text changed from `prev` to `next`, given `shownChars` were
 * on screen: never past the common prefix (what follows it is different text), never rewound below
 * it (that text is unchanged and already seen).
 */
export function resumeAt(prev: string, next: string, shownChars: number): number {
  if (next.startsWith(prev)) return Math.min(shownChars, next.length);
  return Math.min(shownChars, commonPrefixLength(prev, next));
}

/* ── Fresh-word fade ───────────────────────────────────────────────────────────────────────────── */

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const LINE_PREFIX_RE = /^\s*(?:(?:[-*+]|\d+[.)]|>|#{1,6})\s+)*(?:\[[ xX]\]\s+)?/;
/** Characters that open or close inline markdown; the fade run must sit after the last of them. */
const INLINE_SYNTAX_RE = /[`*_~[\]()<>|#\\&]/g;

function fenceOpen(text: string): boolean {
  let open: { marker: string; len: number } | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(FENCE_RE);
    if (!m) continue;
    const marker = m[1][0];
    const len = m[1].length;
    if (!open) open = { marker, len };
    else if (marker === open.marker && len >= open.len && !m[2].trim()) open = null;
  }
  return open !== null;
}

/**
 * The offset in `revealed` where the fresh-word spans may begin, or null when the growing edge is
 * not plain prose. `from` is where the time window of freshly revealed text starts; the result is
 * floored so the run that follows it is a plain text run inside ONE inline context:
 *
 *  · never inside a fence (the stabiliser would reflow it anyway) or on a table row;
 *  · after the line's block prefix (`- `, `1. `, `## `, `> `, `[ ] `) so a list marker survives;
 *  · after the last inline-syntax character on the line (backtick, emphasis, link brackets, …),
 *    and after any bare URL (an autolink must not be split);
 *  · at a word boundary, so kerning across the span seam is nil;
 *  · never on the first word of a list item: the list visualizers read that word's shape.
 */
export function freshStart(revealed: string, from: number): number | null {
  const end = revealed.length;
  if (from >= end || from < 0) return null;
  const lineStart = revealed.lastIndexOf("\n") + 1;
  const line = revealed.slice(lineStart);
  if (/^\s*\|/.test(line) || /^(?: {4}|\t)/.test(line)) return null;
  if (fenceOpen(revealed)) return null;

  const prefix = line.match(LINE_PREFIX_RE)?.[0] ?? "";
  const contentStart = lineStart + prefix.length;
  let floor = Math.max(contentStart, lineStart);

  let m: RegExpExecArray | null;
  INLINE_SYNTAX_RE.lastIndex = 0;
  while ((m = INLINE_SYNTAX_RE.exec(line))) floor = Math.max(floor, lineStart + m.index + 1);

  const url = Math.max(line.lastIndexOf("://"), line.lastIndexOf("www."));
  if (url >= 0) {
    const ws = line.slice(url).search(/\s/);
    if (ws < 0) return null;
    floor = Math.max(floor, lineStart + url + ws + 1);
  }

  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(prefix)) {
    // A list item: skip its first word (the list visualizers read its shape — a status glyph, a
    // `Term —`, a `label:` — and a marker inside it would flip the list's rendering for a frame).
    const ws = revealed.slice(contentStart).search(/\s/);
    if (ws < 0) return null;
    floor = Math.max(floor, contentStart + ws + 1);
  }

  let start = Math.max(from, floor);
  // Back up to the start of the word so the seam never falls inside one.
  while (start > floor && !/\s/.test(revealed[start - 1])) start--;
  // Skip leading whitespace: a span that starts with a space is pointless.
  while (start < end && /\s/.test(revealed[start])) start++;
  return start < end ? start : null;
}

/**
 * Split a fresh run into word tokens (whitespace stays attached to the word before it), with each
 * token's offset relative to the run start — the stable key for its span.
 */
export function freshWords(run: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  const re = /\S+\s*|\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run))) out.push({ at: m.index, text: m[0] });
  return out;
}
