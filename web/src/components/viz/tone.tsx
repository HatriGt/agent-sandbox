import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * One chip vocabulary for every visual block (severity, status, delta, semver jump, method, expiry):
 * the callout's recipe at chip size — a few percent of the hue over the card, a hairline in the same
 * hue, the hue's text token for ink (index.css `.viz-tone`). No saturated fills, and the chip always
 * carries a word or a glyph, so meaning never rides on the hue alone.
 */
export type Tone = "ok" | "fail" | "warn" | "live" | "violet" | "neutral";

const TONE_VARS: Record<Tone, React.CSSProperties> = {
  ok: { "--tone": "var(--ok)" } as React.CSSProperties,
  fail: { "--tone": "var(--destructive)" } as React.CSSProperties,
  // The amber hue is light; its text token inks the word so it still reads on a light card.
  warn: { "--tone": "var(--warn)", "--tone-ink": "var(--warn-text)" } as React.CSSProperties,
  live: { "--tone": "var(--live)" } as React.CSSProperties,
  violet: { "--tone": "var(--sleep)" } as React.CSSProperties,
  neutral: { "--tone": "var(--muted-foreground)", "--tone-ink": "var(--muted-foreground)" } as React.CSSProperties,
};

export function toneStyle(tone: Tone, style?: React.CSSProperties): React.CSSProperties {
  return { ...TONE_VARS[tone], ...style };
}

/** A hue-tinted pill. `round` for counts/states, default 6px corners for tags inside rows. */
export function Pill({
  tone,
  children,
  className,
  round = true,
  ...rest
}: { tone: Tone; children: React.ReactNode; className?: string; round?: boolean } & Omit<React.HTMLAttributes<HTMLSpanElement>, "className" | "children">) {
  return (
    <span
      {...rest}
      className={cn("viz-tone inline-flex h-5 shrink-0 items-center gap-1 px-1.5 text-micro font-medium whitespace-nowrap tabular-nums", round ? "rounded-full" : "rounded-md", className)}
      style={toneStyle(tone, rest.style)}
    >
      {children}
    </span>
  );
}
