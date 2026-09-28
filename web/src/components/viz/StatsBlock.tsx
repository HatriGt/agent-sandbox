import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stat } from "@/lib/viz";
import { VizFrame } from "./VizFrame";

/**
 * ```stats fence → a row of stat tiles. The value is the hero (large, proportional figures — this
 * is a headline, not a column); the label and note stay quiet. A delta wears the good/bad text
 * colors WITH a glyph, so the direction survives color-blindness; `!` in the fence flips which
 * direction is good (latency down = good).
 */
export function StatsBlock({ stats, source }: { stats: Stat[]; source: string }) {
  // Hero size is for NUMBERS. Agents sometimes put a sentence in the value slot ("3/3 instances
  // RUNNING") — scale the type down with length so a prose value reads as a line, not a billboard.
  const wide = stats.some((s) => s.value.length > 16 || s.label.length > 24);
  return (
    <VizFrame source={source} title={stats.length === 1 ? undefined : `${stats.length} metrics`}>
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${wide ? "14rem" : "9rem"}, 1fr))` }}>
        {stats.map((s) => (
          <div key={s.label} className="bg-card px-4 py-3">
            <div className="text-muted-foreground truncate text-micro font-medium" title={s.label}>{s.label}</div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className={cn("text-foreground font-semibold", s.value.length <= 12 ? "text-h2" : s.value.length <= 28 ? "text-lead" : "text-meta")}>{s.value}</span>
              {s.delta && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-micro font-medium tabular-nums",
                    s.deltaGood ? "text-ok" : "text-destructive"
                  )}
                >
                  {s.delta.startsWith("-") || s.delta.startsWith("−") ? (
                    <TrendingDown className="size-3" aria-hidden />
                  ) : (
                    <TrendingUp className="size-3" aria-hidden />
                  )}
                  {s.delta}
                </span>
              )}
            </div>
            {s.note && <div className="text-faint mt-0.5 truncate text-micro">{s.note}</div>}
          </div>
        ))}
      </div>
    </VizFrame>
  );
}
