/**
 * Context-window health, derived from the trace's ⟦usage⟧ events (src/trace.ts `usage` kind).
 *
 * A long-lived thread degrades silently: the agent's context fills, quality drops, and the user's
 * only signal was worse answers. Surfacing "how full is the window" lets the thread warn BEFORE the
 * rot — and the advice ("start a fresh task") is the practice every Claude Code guide teaches, baked
 * into the product instead of left for the user to discover.
 */
import type { TraceEvent } from "./trace";

/** Claude's context window. The in-box agent runs 200k-class models; if that ever varies per model,
 *  this becomes a lookup — the fraction, not the constant, is the contract. */
export const CONTEXT_WINDOW_TOKENS = 200_000;

export type ContextLevel = "normal" | "high" | "critical";

export interface ContextHealth {
  level: ContextLevel;
  /** 0..1 of the window used. */
  fraction: number;
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

export function contextHealth(contextTokens: number): ContextHealth {
  const fraction = Math.min(1, Math.max(0, contextTokens / CONTEXT_WINDOW_TOKENS));
  const level: ContextLevel = fraction >= 0.85 ? "critical" : fraction >= 0.6 ? "high" : "normal";
  const pct = Math.round(fraction * 100);
  return {
    level,
    fraction,
    label: `${pct}% of context used`,
    ...(level === "critical"
      ? { advice: "The agent's context is nearly full — long threads lose quality. Consider starting a fresh task for the next piece of work." }
      : {}),
  };
}
