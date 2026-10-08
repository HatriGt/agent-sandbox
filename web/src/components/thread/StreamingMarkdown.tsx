import * as React from "react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Markdown } from "@/components/ui/markdown";
import { stabilizeMarkdown } from "@/lib/markdown-stream";
import { cn } from "@/lib/utils";
import { useLiveRewrite } from "@/components/viz/live-blocks";
import {
  FADE_MS,
  FRESH_SENTINEL,
  charsOf,
  freshStart,
  freshWords,
  graphemeEnds,
  graphemesWithin,
  initialPace,
  resumeAt,
  stepPace,
  type PaceState,
} from "@/lib/stream-pace";
import "@/styles/streaming.css";

/**
 * The live-feeling reveal for the NEWEST in-progress assistant block.
 *
 * Our source is a 3-second-polled `.agent.log`, not a token stream, so a finished paragraph would
 * otherwise pop in whole. This reveals the text with a steady cadence — but crucially it only ever
 * animates the *tail that has not been shown yet*. When a poll delivers more text the reveal
 * continues from where it was; when a poll re-delivers text already on screen it does nothing.
 * That is what keeps it live without re-animating the whole history on every tick (the jank risk).
 *
 * Pacing (lib/stream-pace.ts, pure and unit-tested): ~90 graphemes/s; a backlog closes smoothly in
 * ~0.3 s (never a dump); when `live` turns false the rest flushes in ~0.12 s. The position is counted
 * in grapheme clusters, so an emoji or a combining sequence is never cut in half. If the text is
 * REPLACED rather than appended (a regenerate, a dedupe re-emit) the reveal resumes from the longest
 * common prefix — never from zero, never rewinding what is unchanged.
 *
 * Content is rendered through the same `Markdown` as static blocks, so a table/code fence that has
 * fully arrived reads correctly even mid-stream; the blinking caret marks the growing edge.
 *
 * Reduced motion (the in-app setting) short-circuits to showing the full text immediately (no caret, no reveal).
 */
export function StreamingMarkdown({ text, live = true }: { text: string; live?: boolean }) {
  // A finished reply renders through the SAME element tree as the live one, so the visualizers
  // that grew while it streamed stay mounted when it ends — no remount, no replayed draw-in.
  const reduced = useReducedMotion();
  // Mounted already finished (history) → everything at once. Mounted live → reveal from the start
  // (a cached log catches up in ~0.3 s). `live` flipping to false later is a flush, not a jump.
  const instant = reduced || !live;
  const ends = React.useMemo(() => graphemeEnds(text), [text]);

  // shown: whole graphemes on screen. fadeFrom: where (in chars) the time window of freshly
  // revealed text begins, or -1 when nothing is fresh.
  const [view, setView] = React.useState(() => ({ shown: instant ? ends.length : 0, fadeFrom: -1 }));

  const paceRef = React.useRef<PaceState>(initialPace(view.shown));
  const endsRef = React.useRef(ends);
  const prevTextRef = React.useRef(text);
  const liveRef = React.useRef(live);
  liveRef.current = live;
  // When each slice landed: [charOffset, timestamp]. The fade window is "revealed in the last
  // FADE_MS", so under a fast catch-up every word still gets its full fade instead of a flash.
  const landedRef = React.useRef<[number, number][]>([]);

  // Text changed: continue from the common prefix (in grapheme units of the NEW text).
  if (prevTextRef.current !== text) {
    const prev = prevTextRef.current;
    const shownChars = charsOf(endsRef.current, paceRef.current.pos);
    const keep = resumeAt(prev, text, shownChars);
    paceRef.current = { pos: graphemesWithin(ends, keep), rate: paceRef.current.rate };
    landedRef.current = landedRef.current.filter(([at]) => at < keep);
    prevTextRef.current = text;
    endsRef.current = ends;
  }

  React.useEffect(() => {
    if (reduced) {
      paceRef.current = initialPace(ends.length);
      landedRef.current = [];
      setView({ shown: ends.length, fadeFrom: -1 });
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      const total = endsRef.current.length;
      const dt = last ? ts - last : 16;
      last = ts;
      const before = paceRef.current;
      const next = stepPace(before, total, dt, liveRef.current);
      paceRef.current = next;
      const shown = Math.floor(next.pos);
      const prevShown = Math.floor(before.pos);
      const now = performance.now();
      if (shown > prevShown) landedRef.current.push([charsOf(endsRef.current, prevShown), now]);
      // Drop slices whose fade has finished; the oldest survivor is where the fresh run starts.
      const landed = landedRef.current;
      while (landed.length && landed[0][1] < now - FADE_MS - 40) landed.shift();
      const fadeFrom = landed.length ? landed[0][0] : -1;
      setView((v) => (v.shown === shown && v.fadeFrom === fadeFrom ? v : { shown, fadeFrom }));
      // Idle once caught up and faded; the next poll (a new `text`) restarts the loop.
      if (next.pos < total || landed.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, live, reduced, ends]);

  const shownCount = reduced ? ends.length : Math.min(view.shown, ends.length);
  const revealed = reduced ? text : text.slice(0, charsOf(ends, shownCount));
  const streaming = !reduced && shownCount < ends.length;
  const done = !live && !streaming;

  // Render the slice as the stable document it is becoming: a fence still being typed is hidden and
  // an open fence is virtually closed, so a code block never flickers in as prose-then-panel. The
  // FULL text is stabilised too: the agent is mid-reply, so the log's tail can be an open fence.
  // Once the stream has ended AND the flush has landed, the text renders as-is.
  const safe = React.useMemo(() => (done ? text : stabilizeMarkdown(revealed)), [done, revealed, text]);

  /*
   * THE FADE — how, and why this way.
   *
   * `Markdown` takes a string and owns its element tree (its `components` prop replaces, not merges,
   * the visualizer overrides, so it cannot be used from here). The fade therefore has two halves:
   *
   *  1. In the SOURCE, a zero-width sentinel (U+200B) is inserted where the fresh run begins. The
   *     position comes from `freshStart`, which floors the time window of freshly revealed text to
   *     the trailing PLAIN prose of the current line — after any backtick, emphasis, link, URL, list
   *     marker or heading hash, never inside a fence, a table row or a live visual, never on a list
   *     item's first word — so inline markdown at the growing edge parses exactly as it will when
   *     finished. The sentinel is invisible, so even a frame where it is left alone costs nothing.
   *
   *  2. In the DOM, a layout effect finds the text node carrying the sentinel, cuts it there, and
   *     puts the words after it into `.md-fresh` spans — one per word, keyed by absolute offset so a
   *     word keeps its span (and its running fade) while the window slides past it; a span is only
   *     ever created (fade starts), retexted (the current word growing) or removed (fade finished —
   *     it is at opacity 1, and the word goes back into the plain text run: no seam). React is never
   *     fought: it only ever rewrites the text node's `nodeValue` from its own props, and the effect
   *     runs after every commit, before paint, re-cutting or restoring as needed. It never touches
   *     any node React might reorder, only inserts siblings right after that one text node.
   *
   * When live ends, nothing changes shape: the same `Markdown`, the same elements; the flush lands,
   * the last words finish fading, the sentinel disappears and the spans are folded back into text.
   */
  const fadeAt = React.useMemo(() => {
    if (reduced || view.fadeFrom < 0) return null;
    const at = freshStart(revealed, view.fadeFrom);
    // The stabiliser may have trimmed the tail (a half-typed code span, a header-only table): only
    // mark the run when the stabilised text still carries the prefix it would sit in.
    return at !== null && safe.length > at && safe.startsWith(revealed.slice(0, at)) ? at : null;
  }, [reduced, view.fadeFrom, revealed, safe]);
  const marked = fadeAt === null ? safe : safe.slice(0, fadeAt) + FRESH_SENTINEL + safe.slice(fadeAt);

  // A visual the agent re-emits under the same name renders once, at its first position, in its
  // latest version; later copies collapse to a row (lib/viz-identity.ts).
  const shownMd = useLiveRewrite(marked);

  const rootRef = React.useRef<HTMLDivElement>(null);
  useFreshSpans(rootRef, fadeAt, shownMd);

  // The caret belongs to the whole live reply, not just to the reveal: between two log deltas the
  // agent is still writing, and a caret that vanished there made every pause look like the end.
  // It sits inline after the last glyph (see styles/thread.css) and blinks only once caught up.
  return (
    <div ref={rootRef} className={cn("relative", live && "md-live", streaming && "md-catching-up")}>
      <Markdown className="prose-agent">{shownMd}</Markdown>
      {live && <span className="md-caret-block" aria-hidden />}
    </div>
  );
}

type FreshState = {
  /** The text node currently cut at the sentinel, and what it held on either side of it. */
  cut: { node: Text; head: string; run: string } | null;
  /** The spans on screen, and when each word first appeared (absolute offset → ms). */
  spans: HTMLSpanElement[];
  born: Map<number, number>;
};

/** The text node that carries the sentinel — searched from the last block backwards. */
function findSentinelNode(root: HTMLElement): Text | null {
  const prose = root.firstElementChild;
  if (!prose) return null;
  const scopes: Element[] = [];
  if (prose.lastElementChild) scopes.push(prose.lastElementChild);
  scopes.push(prose);
  for (const scope of scopes) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) if ((n as Text).data.includes(FRESH_SENTINEL)) return n as Text;
  }
  return null;
}

/** Take the spans out and fold the run back into its text node when React has not rewritten it. */
function unwrap(s: FreshState) {
  for (const span of s.spans) span.remove();
  s.spans = [];
  const c = s.cut;
  if (c && c.node.isConnected && c.node.data === c.head) c.node.data = c.head + c.run;
  s.cut = null;
}

/**
 * React owns the text nodes and may rewrite them any way it likes between commits — a lone string
 * child is updated by `parent.textContent = …`, which wipes any sibling we added and even swaps the
 * text node — so nothing here assumes a node survives. After every commit the spans are rebuilt
 * from scratch around whatever text node carries the sentinel; a word's fade stays continuous
 * because its first-seen time is remembered and the rebuilt span resumes from there via a negative
 * `animation-delay`. Cost: a handful of spans per frame.
 */
function useFreshSpans(rootRef: React.RefObject<HTMLDivElement | null>, fadeAt: number | null, md: string) {
  const stateRef = React.useRef<FreshState>({ cut: null, spans: [], born: new Map() });
  React.useLayoutEffect(() => {
    const s = stateRef.current;
    unwrap(s);
    const root = rootRef.current;
    const node = root && fadeAt !== null ? findSentinelNode(root) : null;
    if (!node) {
      s.born.clear();
      return;
    }
    const i = node.data.indexOf(FRESH_SENTINEL);
    const head = node.data.slice(0, i);
    const run = node.data.slice(i + FRESH_SENTINEL.length);
    node.data = head;
    s.cut = { node, head, run };
    const now = performance.now();
    const keep = new Set<number>();
    const parent = node.parentNode!;
    let after: Node = node;
    for (const w of freshWords(run)) {
      const key = fadeAt! + w.at;
      keep.add(key);
      const born = s.born.get(key) ?? now;
      s.born.set(key, born);
      const span = document.createElement("span");
      span.className = "md-fresh";
      span.textContent = w.text;
      if (now > born) span.style.animationDelay = `${born - now}ms`;
      parent.insertBefore(span, after.nextSibling);
      s.spans.push(span);
      after = span;
    }
    for (const key of s.born.keys()) if (!keep.has(key)) s.born.delete(key);
  }, [rootRef, fadeAt, md]);
  React.useEffect(
    () => () => {
      unwrap(stateRef.current);
      stateRef.current.born.clear();
    },
    []
  );
}
