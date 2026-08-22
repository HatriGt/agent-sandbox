import { ChevronRight, Inbox } from "lucide-react";
import type { BoxView } from "@/lib/api";
import { roleLabel, shortName, stateLabel, stateVariant, triageSort } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The fleet, ordered for triage: boxes blocked on a human first. Rows are buttons, not divs with
 * click handlers, so keyboard and screen-reader users get the same affordance.
 */
export function FleetList({
  boxes,
  pending,
  selected,
  loading,
  onSelect,
}: {
  boxes: BoxView[];
  pending: { id: string; task: string }[];
  selected: string | null;
  loading: boolean;
  onSelect: (name: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-1.5 p-2" aria-busy="true" aria-label="Loading sandboxes">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (!boxes.length && !pending.length) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 py-12 text-center">
        <Inbox className="size-6 opacity-50" aria-hidden />
        <p className="text-foreground text-sm font-medium">No sandboxes are up</p>
        <p className="max-w-[34ch] text-xs leading-relaxed">
          Describe a task below and a fresh microVM will pick it up. Boxes stop themselves when idle.
        </p>
      </div>
    );
  }

  const sorted = [...boxes].sort(triageSort);

  return (
    <ul className="space-y-1 p-2" aria-label="Sandboxes">
      {pending.map((p) => (
        <li key={p.id}>
          <div className="rounded-lg border border-dashed p-3">
            <Badge variant="muted" className="animate-pulse">
              starting…
            </Badge>
            <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-relaxed">{p.task}</p>
          </div>
        </li>
      ))}

      {sorted.map((v) => {
        const active = selected === v.name;
        return (
          <li key={v.name}>
            <button
              type="button"
              onClick={() => onSelect(v.name)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "group w-full cursor-pointer rounded-lg border p-3 text-left transition-colors duration-150",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                active
                  ? "border-accent/40 bg-accent/10"
                  : "hover:bg-secondary/60 border-transparent hover:border-border"
              )}
            >
              <div className="flex items-center gap-2">
                <Badge variant={stateVariant(v.runState)}>
                  {v.runState === "running" && <span className="bg-current size-1.5 animate-pulse rounded-full" />}
                  {stateLabel(v)}
                </Badge>
                <span className="text-muted-foreground ml-auto text-[11px]">{roleLabel(v.role)}</span>
                <ChevronRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 md:opacity-0" />
              </div>

              <p className="mt-2 truncate font-mono text-xs font-semibold">{shortName(v.name)}</p>

              {v.task ? (
                <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">{v.task}</p>
              ) : (
                <p className="text-muted-foreground/70 mt-1 text-xs italic">task-less run</p>
              )}

              <p className="text-muted-foreground/80 tabular mt-2 flex flex-wrap gap-x-2.5 text-[11px]">
                {v.uptime && <span>up {v.uptime}</span>}
                {v.cpu && <span>cpu {v.cpu}</span>}
                {v.mem && <span>mem {v.mem.split(" / ")[0]}</span>}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
