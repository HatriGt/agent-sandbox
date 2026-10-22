import * as React from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Level 0 is the empty cell; 1–4 mix --live in at rising strength. */
const LEVEL_BG = [
  "var(--border)",
  "color-mix(in oklch, var(--live) 30%, var(--border))",
  "color-mix(in oklch, var(--live) 55%, var(--border))",
  "color-mix(in oklch, var(--live) 78%, var(--border))",
  "var(--live)",
];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export interface ActivityRun {
  /** Epoch milliseconds. */
  t: number;
  failed?: boolean;
}

interface Cell {
  date: Date;
  n: number;
  failed: number;
  future: boolean;
}

/**
 * GitHub-style run activity: one cell per local day for the last `weeks` weeks; columns are weeks,
 * Sun→Sat top to bottom. With `days`, a single row of the last `days` days instead: the shape for an
 * archive too sparse to fill a grid. Intensity is relative to the busiest day in range, in four
 * steps over empty. A roving-tabindex grid: arrow keys walk days, each cell names its date and count to AT.
 */
export function ActivityHeatmap({ runs, weeks = 20, days, className }: { runs: ActivityRun[]; weeks?: number; days?: number; className?: string }) {
  const reduce = useReducedMotion();
  const perCol = days ? 1 : 7;
  const nCols = days ?? weeks;
  const { cols, max, total } = React.useMemo(() => {
    const counts = new Map<string, { n: number; failed: number }>();
    for (const r of runs) {
      const k = dayKey(new Date(r.t));
      const c = counts.get(k) ?? { n: 0, failed: 0 };
      c.n++;
      if (r.failed) c.failed++;
      counts.set(k, c);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - (days ? days - 1 : (weeks - 1) * 7 + today.getDay()));
    const cols: Cell[][] = [];
    let max = 0;
    let total = 0;
    for (let w = 0; w < nCols; w++) {
      const col: Cell[] = [];
      for (let d = 0; d < perCol; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * perCol + d);
        const c = counts.get(dayKey(date)) ?? { n: 0, failed: 0 };
        const future = date.getTime() > today.getTime();
        if (!future) {
          max = Math.max(max, c.n);
          total += c.n;
        }
        col.push({ date, ...c, future });
      }
      cols.push(col);
    }
    return { cols, max, total };
  }, [runs, weeks, days, nCols, perCol]);

  const level = (n: number) => (n === 0 || max === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const [focus, setFocus] = React.useState<[number, number]>(() => [nCols - 1, days ? 0 : new Date().getDay()]);
  const cellRefs = React.useRef(new Map<string, HTMLButtonElement>());

  const onKey = (e: React.KeyboardEvent, w: number, d: number) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    let nw = Math.min(nCols - 1, Math.max(0, w + m[0]));
    let nd = Math.min(perCol - 1, Math.max(0, d + m[1]));
    if (cols[nw][nd].future) [nw, nd] = [w, d];
    setFocus([nw, nd]);
    cellRefs.current.get(`${nw}-${nd}`)?.focus();
  };

  const monthLabel = (w: number) => {
    const first = cols[w][0].date;
    const prev = w > 0 ? cols[w - 1][0].date : null;
    const next = cols[w + 1]?.[0].date;
    // The first column names its month only if the next column is still in it; otherwise the two labels collide.
    if (!prev && next && next.getMonth() !== first.getMonth()) return "";
    return !prev || prev.getMonth() !== first.getMonth() ? first.toLocaleDateString(undefined, { month: "short" }) : "";
  };

  return (
    <figure className={cn("min-w-0", className)}>
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1.5">
          <div className="flex gap-[3px]" aria-hidden>
            {cols.map((_, w) => (
              <span key={w} className="text-faint w-3 overflow-visible whitespace-nowrap text-micro leading-none">
                {monthLabel(w)}
              </span>
            ))}
          </div>
          <div role="grid" aria-label={`Run activity, last ${days ? `${days} days` : `${weeks} weeks`}: ${total} ${total === 1 ? "run" : "runs"}`} className="flex gap-[3px]">
            {cols.map((col, w) => (
              <div key={w} role="row" className="flex flex-col gap-[3px]">
                {col.map((c, d) => {
                  if (c.future) return <span key={d} className="size-3" aria-hidden />;
                  const dateText = c.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
                  const label = `${c.n === 0 ? "No" : c.n} ${c.n === 1 ? "run" : "runs"}${c.failed ? ` (${c.failed} failed)` : ""} · ${dateText}`;
                  return (
                    <Tooltip key={d}>
                      <TooltipTrigger asChild>
                        <motion.button
                          type="button"
                          role="gridcell"
                          ref={(el: HTMLButtonElement | null) => {
                            if (el) cellRefs.current.set(`${w}-${d}`, el);
                          }}
                          tabIndex={focus[0] === w && focus[1] === d ? 0 : -1}
                          aria-label={label}
                          onKeyDown={(e) => onKey(e, w, d)}
                          onFocus={() => setFocus([w, d])}
                          initial={reduce ? false : { opacity: 0, scale: 0.6 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.3, delay: reduce ? 0 : w * 0.018 + d * 0.01, ease: [0.22, 1, 0.36, 1] }}
                          style={{ background: LEVEL_BG[level(c.n)] }}
                          className="focus-visible:ring-ring size-3 cursor-default rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">{label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="text-faint mt-2 flex items-center justify-end gap-1.5 text-micro" aria-hidden>
        Less
        {LEVEL_BG.map((bg, i) => (
          <span key={i} className="size-2.5 rounded-[2px]" style={{ background: bg }} />
        ))}
        More
      </figcaption>
    </figure>
  );
}
