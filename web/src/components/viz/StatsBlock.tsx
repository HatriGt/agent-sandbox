import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stat } from "@/lib/viz";
import { VizFrame } from "./VizFrame";
import { RollNumber, useRowEntrance } from "./motion";
import { Pill } from "./tone";

/**
 * ```stats fence → a row of stat tiles inset 6px in the card (6px radius inside its 12px: concentric).
 * The value is the hero, in tabular figures so a live update rolls without the row jittering; the
 * label and note stay quiet. A delta is a tinted chip in the good/bad hue WITH a glyph, so the
 * direction survives colour-blindness; `!` in the fence flips which direction is good (latency down = good).
 */
export function StatsBlock({ stats, source }: { stats: Stat[]; source: string }) {
  // Hero size is for NUMBERS. Agents sometimes put a sentence in the value slot ("3/3 instances
  // RUNNING") — scale the type down with length so a prose value reads as a line, not a billboard.
  const wide = stats.some((s) => s.value.length > 16 || s.label.length > 24);
  const entrance = useRowEntrance(stats.map((s) => s.label));
  return (
    <VizFrame source={source} title={stats.length === 1 ? undefined : `${stats.length} metrics`}>
      <div className="grid gap-1.5 p-1.5" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${wide ? "14rem" : "9rem"}, 1fr))` }}>
        {stats.map((s) => {
          const e = entrance(s.label);
          return (
          <div key={s.label} className={cn("bg-muted/40 min-w-0 rounded-md px-3 py-2.5", e.className)} style={e.style}>
            <div className="text-muted-foreground truncate text-micro font-medium" title={s.label}>{s.label}</div>
            <RollNumber text={s.value} className={cn("text-foreground mt-0.5 block font-semibold tabular-nums text-balance", s.value.length <= 12 ? "text-h2" : s.value.length <= 28 ? "text-lead" : "text-meta")} />
            {/* Delta and note share one line under the value in every tile, so the row reads level
                whether or not a tile's value happens to leave room beside it. */}
            {(s.delta || s.note) && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              {s.delta && (
                <Pill tone={s.deltaGood ? "ok" : "fail"} round={false} className="px-1">
                  {s.delta.startsWith("-") || s.delta.startsWith("−") ? (
                    <TrendingDown className="size-3" strokeWidth={2} aria-hidden />
                  ) : (
                    <TrendingUp className="size-3" strokeWidth={2} aria-hidden />
                  )}
                  <RollNumber text={s.delta} />
                </Pill>
              )}
              {s.note && <span className="text-faint min-w-0 truncate text-micro">{s.note}</span>}
            </div>
            )}
          </div>
          );
        })}
      </div>
    </VizFrame>
  );
}
