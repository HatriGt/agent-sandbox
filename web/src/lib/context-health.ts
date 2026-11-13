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
  return tokens === undefined ? null : { tokens, window: window ?? CONTEXT_WINDOW_TOKENS };
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
        ? "The agent's context is nearly full and auto-compact is off — send /compact to summarize the conversation, or start a fresh task."
        : "The agent's context is nearly full — it compacts on its own, or send /compact now to summarize the conversation and keep going."
      : level === "high" && compactAt === undefined
        ? "Auto-compact is off — send /compact before the window fills, or the run stops with “prompt is too long”."
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
