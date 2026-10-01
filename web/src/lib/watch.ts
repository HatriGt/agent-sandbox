/**
 * Watch mode: the agent was asked to KEEP monitoring something ("keep listening to the backend logs")
 * and loops — bounded tail, re-emit the same titled block — until the operator stops it.
 *
 * The agent announces it with an invisible marker in its prose (an HTML comment, which the markdown
 * renderer drops), so nothing new appears in the transcript:
 *
 *   <!-- watch: backend logs | every 30s -->   start (or resume) a watch
 *   <!-- watch: end -->                        it finished on its own (stated duration over)
 *   a line starting "Watch paused"             it hit a hard limit and asks to be continued
 *
 * Pure: reads the parsed trace, no React. See docs/output-visualizers.md ("Watch mode").
 */
import type { TraceEvent } from "../../../src/trace";

export interface WatchState {
  target: string;
  /** "30s" as written by the agent, when given. */
  every: string | null;
  /** Agent replies after the marker that carried a block (each one an update of the live summary). */
  updates: number;
  /** Epoch ms of the marker / of the last stamped event since; null on unstamped logs. */
  startedAt: number | null;
  lastAt: number | null;
  /** "on" = the loop is (or was, if the run is gone) still going; "ended" / "paused" = the agent said so. */
  phase: "on" | "ended" | "paused";
}

export type WatchMark = { kind: "start"; target: string; every: string | null } | { kind: "end" };

const MARK_RE = /<!--\s*watch\s*:\s*([\s\S]*?)\s*-->/gi;
const PAUSED_RE = /^\s*(?:\*\*)?watch paused\b/im;
const FENCE_RE = /^\s*(```|~~~)/m;

/** Every watch marker in one piece of prose, in order. "end" (or "stop"/"done") closes the watch. */
export function watchMarks(text: string): WatchMark[] {
  const out: WatchMark[] = [];
  for (const m of text.matchAll(MARK_RE)) {
    const body = m[1].replace(/\s+/g, " ").trim();
    if (/^(end|stop|stopped|done)$/i.test(body)) {
      out.push({ kind: "end" });
      continue;
    }
    const [rawTarget, ...rest] = body.split("|").map((s) => s.trim());
    const target = rawTarget
      .replace(/^target\s*[:=]\s*/i, "")
      .replace(/^["']|["']$/g, "")
      .slice(0, 80);
    if (!target) continue;
    const ev = rest.join(" ").match(/(\d+\s*(?:ms|sec|s|min|m|h))\b/i);
    out.push({ kind: "start", target, every: ev ? ev[1].replace(/\s+/g, "") : null });
  }
  return out;
}

/**
 * The current watch, if the latest agent turn is one. A message from the operator after the marker
 * ends it (the agent re-emits the marker if it resumes watching), as does an end marker.
 */
export function deriveWatch(events: TraceEvent[]): WatchState | null {
  let w = null as WatchState | null;
  for (const e of events) {
    const at = "at" in e && typeof e.at === "number" ? e.at : undefined;
    if (e.kind === "you") {
      w = null;
      continue;
    }
    if (w && at) w.lastAt = at;
    if (e.kind !== "say") continue;
    for (const m of watchMarks(e.text)) {
      if (m.kind === "start") w = { target: m.target, every: m.every, updates: 0, startedAt: at ?? null, lastAt: at ?? null, phase: "on" };
      else if (w) w.phase = "ended";
    }
    if (!w) continue;
    if (FENCE_RE.test(e.text)) w.updates++;
    if (PAUSED_RE.test(e.text)) w.phase = "paused";
  }
  return w;
}

/** Elapsed seconds of a watch: to `now` while it runs, to its last stamped event once it stopped. */
export function watchElapsedSec(w: WatchState, live: boolean, now = Date.now()): number | null {
  if (w.startedAt == null) return null;
  const end = live ? now : (w.lastAt ?? w.startedAt);
  return Math.max(0, Math.round((end - w.startedAt) / 1000));
}
