import * as React from "react";
import { useReducedMotion } from "motion/react";
import { cellNumber } from "@/lib/viz";
import { cn } from "@/lib/utils";

/**
 * Motion when a visual fence re-renders with new data (docs/output-visualizers.md). CSS-first:
 * the classes live in index.css next to .viz-grow / .viz-draw and collapse under the global
 * reduced-motion rule. Nothing here replays the first-mount draw-in — entrances are assigned
 * once per row key and never change, so a streaming re-render leaves a running animation alone.
 */

/** Rows past this many in one new batch appear instantly. */
export const STAGGER_CAP = 8;

type Entrance = { className: string; style?: React.CSSProperties };

/**
 * Entrance classes per row key. Rows present on the block's first render keep the existing
 * one-shot `stagger-item` draw-in; rows that arrive later (streaming) get `viz-row-new`, a
 * fade + lift staggered 30 ms within their batch, capped at {@link STAGGER_CAP} rows.
 */
export function useRowEntrance(keys: readonly string[]): (key: string) => Entrance {
  const seen = React.useRef(new Map<string, Entrance>());
  const mounted = React.useRef(false);
  let batch = 0;
  for (let idx = 0; idx < keys.length; idx++) {
    const k = keys[idx];
    if (seen.current.has(k)) continue;
    if (!mounted.current) {
      seen.current.set(k, { className: "stagger-item", style: { "--i": Math.min(idx, 12) } as React.CSSProperties });
    } else {
      const n = batch++;
      seen.current.set(k, n < STAGGER_CAP ? { className: "viz-row-new", style: { "--i": n } as React.CSSProperties } : { className: "" });
    }
  }
  React.useEffect(() => {
    mounted.current = true;
  }, []);
  return (key) => seen.current.get(key) ?? { className: "" };
}

const NUM = /^(.*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/s;

interface Parsed {
  prefix: string;
  n: number;
  suffix: string;
  decimals: number;
  grouped: boolean;
}

/** Split a display value into prefix / number / suffix — only when cellNumber reads it as a number. */
function parse(text: string): Parsed | null {
  if (cellNumber(text) === null) return null;
  const m = text.match(NUM);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  return { prefix: m[1], n, suffix: m[3], decimals: m[2].split(".")[1]?.length ?? 0, grouped: m[2].includes(",") };
}

function format(p: Parsed, v: number): string {
  const s = p.grouped
    ? v.toLocaleString("en-US", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })
    : v.toFixed(p.decimals);
  return p.prefix + s + p.suffix;
}

const ROLL_MS = 250;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The value text, rolled from its previous value when it changes (~250 ms ease-out). Keeps the
 * original formatting — prefix, unit, decimals, thousands commas — and only rolls when both the
 * old and new text parse as numbers with the same prefix/unit; anything else just swaps. The
 * first render shows the real value (no count-up from zero: that would display fabricated
 * intermediate data on a block that isn't changing). Reduced motion → no roll.
 */
export function useRolledText(text: string): string {
  const reduce = useReducedMotion();
  const [shown, setShown] = React.useState(text);
  const prev = React.useRef(text);
  const raf = React.useRef(0);

  // Layout effect: a non-rollable change re-renders before paint, so no stale frame flashes.
  React.useLayoutEffect(() => {
    const from = parse(prev.current);
    const to = parse(text);
    prev.current = text;
    cancelAnimationFrame(raf.current);
    if (reduce || !from || !to || from.prefix !== to.prefix || from.suffix !== to.suffix || from.n === to.n) {
      setShown(text);
      return;
    }
    const start = performance.now();
    const fmt: Parsed = { ...to, decimals: Math.max(from.decimals, to.decimals) };
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ROLL_MS);
      if (t >= 1) return setShown(text);
      setShown(format(fmt, from.n + (to.n - from.n) * easeOut(t)));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [text, reduce]);

  return shown;
}

/** {@link useRolledText} as an element. The accessible name is always the final value. */
export function RollNumber({ text, className }: { text: string; className?: string }) {
  const shown = useRolledText(text);
  return (
    <span className={className} aria-label={shown === text ? undefined : text}>
      {shown}
    </span>
  );
}

/**
 * A per-digit odometer: each digit is a column 0–9 that slides to the new value, soft-masked at the
 * top and bottom, so a count that changes every poll rolls instead of swapping. Non-digits (prefix,
 * unit, separators) never move. Retargets mid-roll (a CSS transition, not a keyframe), width grows
 * by a digit fading in. Reduced motion renders the plain text. Pattern after Rare UI's animated
 * counter and Cult UI's rolling number.
 */
export function Odometer({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  const first = React.useRef(true);
  React.useEffect(() => {
    first.current = false;
  }, []);
  if (reduce) return <span className={cn("tabular-nums", className)}>{text}</span>;
  const chars = Array.from(text);
  return (
    <span className={cn("odometer inline-flex tabular-nums", className)}>
      {/* The real value is the only text in the DOM; the digit wheels draw via CSS content. */}
      <span className="sr-only">{text}</span>
      {chars.map((c, i) =>
        /\d/.test(c) ? (
          <span key={`d${i}`} className={cn("odometer-digit", !first.current && "odometer-digit-new")} aria-hidden>
            <span className="odometer-col" style={{ transform: `translateY(-${Number(c) * 10}%)` }}>
              {DIGITS.map((d) => (
                <span key={d} data-d={d} />
              ))}
            </span>
          </span>
        ) : (
          <span key={`c${i}`} aria-hidden>
            {c}
          </span>
        )
      )}
    </span>
  );
}
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
