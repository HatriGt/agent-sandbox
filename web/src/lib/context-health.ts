/**
 * Context-window health, derived from the trace's ⟦usage⟧ and ⟦compact⟧ events (src/trace.ts).
 *
 * A long-lived thread degrades silently: the agent's context fills, quality drops, and the user's
 * only signal was worse answers. Surfacing "how full is the window" lets the thread warn BEFORE the
 * rot. Claude Code compacts on its own when the window nearly fills (the owner's auto-compact
 * setting decides when), and `/compact` does it on demand — so the advice points there first.
 */
import type { TraceEvent } from "./trace";

/** The window when the log does not say (older formatters): the in-box agent runs 200K-class models. */
export const CONTEXT_WINDOW_TOKENS = 200_000;
/** Claude Code compacts at its window minus this reserve (it keeps room for the summary itself). */
export const AUTO_COMPACT_RESERVE_TOKENS = 33_000;
/** "early" auto-compaction: the window Claude Code is told to compact against (src/drivers/claude.ts). */
export const EARLY_COMPACT_WINDOW = 133_000;

export type AutoCompactMode = "standard" | "early" | "off";
export type ContextLevel = "normal" | "high" | "critical";

export interface ContextHealth {
  level: ContextLevel;
  /** 0..1 of the window used. */
  fraction: number;
  /** Tokens in the window now, and the window. */
  tokens: number;
  window: number;
  /** Where Claude Code compacts on its own (tokens), when it does; the meter draws a tick there. */
  compactAt?: number;
  /** "42% of context used" — ready for the meter's accessible label. */
  label: string;
  /** Present only when the user should act; verbatim UI copy. */
  advice?: string;
}

/** The last usage event in the trace — cumulative, so the last one is the current truth. */
export function lastUsage(events: TraceEvent[]): Extract<TraceEvent, { kind: "usage" }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "usage") return e;
  }
  return null;
}

/**
 * How full the window is right now. The newest of a turn's usage line or a finished compaction
 * wins: after `/compact` the window holds only the summary, and no usage line follows a
 * compaction-only turn. The window is the newest one the log reported.
 */
export function currentContext(events: TraceEvent[]): { tokens: number; window: number } | null {
  let tokens: number | undefined;
  let window: number | undefined;
  for (let i = events.length - 1; i >= 0 && (tokens === undefined || window === undefined); i--) {
    const e = events[i];
    if (e.kind === "usage") {
      if (tokens === undefined) tokens = e.contextTokens;
      if (window === undefined && e.contextWindow) window = e.contextWindow;
    } else if (e.kind === "compact" && e.state === "done" && e.postTokens !== undefined && tokens === undefined) {
      tokens = e.postTokens;
    }
  }
  if (tokens === undefined) return null;
  // Older logs carry no window; a context larger than the 200K default means a 1M-window model.
  return { tokens, window: window ?? (tokens > CONTEXT_WINDOW_TOKENS ? 1_000_000 : CONTEXT_WINDOW_TOKENS) };
}

/** Where Claude Code compacts on its own for this window and setting; undefined when it does not. */
export function autoCompactAt(window: number, mode: AutoCompactMode = "standard"): number | undefined {
  if (mode === "off") return undefined;
  const w = mode === "early" ? Math.min(window, EARLY_COMPACT_WINDOW) : window;
  return w > AUTO_COMPACT_RESERVE_TOKENS * 2 ? w - AUTO_COMPACT_RESERVE_TOKENS : undefined;
}

export function contextHealth(contextTokens: number, window = CONTEXT_WINDOW_TOKENS, mode?: AutoCompactMode): ContextHealth {
  const fraction = Math.min(1, Math.max(0, contextTokens / window));
  const level: ContextLevel = fraction >= 0.85 ? "critical" : fraction >= 0.6 ? "high" : "normal";
  const pct = Math.round(fraction * 100);
  const compactAt = autoCompactAt(window, mode);
  // Advice only when the window will not take care of itself: auto-compaction is off, or the context
  // is already past where it should have compacted (a single huge turn), or it is nearly full.
  const pastAuto = compactAt !== undefined && contextTokens >= compactAt;
  const advice =
    level === "critical" || pastAuto
      ? compactAt === undefined
        ? "Almost full, and auto-compact is off. Compact now to keep going."
        : "Almost full. It compacts on its own soon, or you can compact now."
      : level === "high" && compactAt === undefined
        ? "Auto-compact is off. Compact before the window fills."
        : undefined;
  return {
    level,
    fraction,
    tokens: contextTokens,
    window,
    ...(compactAt !== undefined ? { compactAt } : {}),
    label: `${pct}% of context used`,
    ...(advice ? { advice } : {}),
  };
}

/** Health from the trace, or null before the first turn reported usage. */
export function contextHealthOf(events: TraceEvent[], mode?: AutoCompactMode): ContextHealth | null {
  const c = currentContext(events);
  return c ? contextHealth(c.tokens, c.window, mode) : null;
}

/** Compact token count: 1234 → "1.2K", 200000 → "200K". */
export function fmtK(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** What a slice of the context window holds; the order is the legend's and the colour slot's. */
export type ContextPart = "setup" | "you" | "replies" | "reasoning" | "reads" | "commands" | "edits" | "search" | "tools";

export const CONTEXT_PARTS: Record<ContextPart, { label: string; color: string }> = {
  setup: { label: "System prompt, tools & memory", color: "var(--viz-7)" },
  you: { label: "Your messages", color: "var(--viz-1)" },
  replies: { label: "Agent replies", color: "var(--viz-3)" },
  reasoning: { label: "Reasoning", color: "var(--viz-5)" },
  reads: { label: "File reads", color: "var(--viz-2)" },
  commands: { label: "Commands", color: "var(--viz-4)" },
  edits: { label: "Edits", color: "var(--viz-6)" },
  search: { label: "Search & web", color: "var(--viz-8)" },
  tools: { label: "Other tools", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)" },
};

export interface ContextBreakdown {
  /** Tokens per part, largest first; together they make `total`. */
  parts: { part: ContextPart; tokens: number }[];
  /** The single tool calls that added the most, largest first. */
  heaviest: { name: string; arg?: string; tokens: number }[];
  total: number;
  /** The newest request's input, split by the prompt cache: reused, newly written, and uncached. */
  cache?: { read: number; write: number; fresh: number };
  /** The first slice is the compaction summary (plus system prompt), not the original setup. */
  afterCompaction: boolean;
}

function partOfTool(name: string): ContextPart {
  if (/^(Read|NotebookRead)$/.test(name)) return "reads";
  if (/^(Bash|BashOutput|KillShell|KillBash)$/.test(name)) return "commands";
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) return "edits";
  if (/^(Grep|Glob|LS|WebFetch|WebSearch)$/.test(name)) return "search";
  return "tools";
}

/**
 * Where the context window went, from the ⟦ctx⟧ lines (one per API request, newer Claude Code logs).
 * The first request's context is the setup (system prompt, tool definitions, memory files and the
 * task; after a compaction, the summary). Each later request's growth is exact, and is charged to
 * what happened since the previous request (its reply, reasoning, tool results), split by size when
 * several things share one step. Null when the log has no ⟦ctx⟧ lines.
 */
export function contextBreakdown(events: TraceEvent[]): ContextBreakdown | null {
  let from = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "compact" && e.state === "done") {
      from = i + 1;
      break;
    }
  }
  const marks: number[] = [];
  for (let i = from; i < events.length; i++) if (events[i].kind === "ctx") marks.push(i);
  if (!marks.length) return null;

  const tokens = new Map<ContextPart, number>();
  const add = (p: ContextPart, n: number) => n > 0 && tokens.set(p, (tokens.get(p) ?? 0) + n);
  const heavy: ContextBreakdown["heaviest"] = [];
  const at = (i: number) => (events[i] as Extract<TraceEvent, { kind: "ctx" }>).tokens;

  // Charge `delta` tokens to the events in (lo, hi), split by their size in the log.
  const charge = (lo: number, hi: number, delta: number) => {
    if (delta <= 0) return;
    const items: { part: ContextPart; weight: number; tool?: Extract<TraceEvent, { kind: "tool" }> }[] = [];
    for (let i = lo + 1; i < hi; i++) {
      const e = events[i];
      if (e.kind === "tool") items.push({ part: partOfTool(e.name), weight: 40 + (e.arg?.length ?? 0) + (e.result?.length ?? 0), tool: e });
      else if (e.kind === "say") items.push({ part: "replies", weight: e.text.length });
      else if (e.kind === "think") items.push({ part: "reasoning", weight: e.text.length });
      else if (e.kind === "you") items.push({ part: "you", weight: e.text.length });
      else if (e.kind === "plan") items.push({ part: "tools", weight: 200 });
    }
    const sum = items.reduce((s, x) => s + x.weight, 0);
    if (!sum) return add("replies", delta);
    for (const x of items) {
      const n = Math.round((delta * x.weight) / sum);
      add(x.part, n);
      if (x.tool && n > 0) heavy.push({ name: x.tool.name, ...(x.tool.arg ? { arg: x.tool.arg } : {}), tokens: n });
    }
  };

  add("setup", at(marks[0]));
  for (let k = 1; k < marks.length; k++) charge(marks[k - 1], marks[k], at(marks[k]) - at(marks[k - 1]));
  // After the last request: its reply is in the turn's final usage line (context incl. output).
  const last = marks[marks.length - 1];
  let tail: number | undefined;
  for (let i = events.length - 1; i > last; i--) {
    const e = events[i];
    if (e.kind === "usage") {
      tail = e.contextTokens;
      break;
    }
  }
  if (tail !== undefined) charge(last, events.length, tail - at(last));

  // A new turn can start smaller than the last one ended (Claude Code drops old reasoning between
  // turns), so the charged growth can overshoot what is in the window now: scale back to it.
  const now = tail ?? at(last);
  const charged = [...tokens.values()].reduce((s, n) => s + n, 0);
  const scale = charged > now && charged > 0 ? now / charged : 1;
  if (scale < 1) for (const [p, n] of tokens) tokens.set(p, Math.round(n * scale));
  for (const h of heavy) h.tokens = Math.round(h.tokens * scale);
  const parts = [...tokens].map(([part, n]) => ({ part, tokens: n })).sort((a, b) => b.tokens - a.tokens);
  const lastCtx = events[last] as Extract<TraceEvent, { kind: "ctx" }>;
  return {
    parts,
    heaviest: heavy.sort((a, b) => b.tokens - a.tokens).slice(0, 3),
    total: parts.reduce((s, p) => s + p.tokens, 0),
    cache: { read: lastCtx.cacheRead, write: lastCtx.cacheWrite, fresh: Math.max(0, lastCtx.tokens - lastCtx.cacheRead - lastCtx.cacheWrite) },
    afterCompaction: from > 0,
  };
}
