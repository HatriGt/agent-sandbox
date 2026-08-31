import type { BoxView } from "@/lib/api";
import { displayState } from "@/lib/lifecycle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The fleet's capacity as slots — `MSB_MAX_BOXES` cells, each coloured by the machine occupying it.
 * Real configuration, real occupancy; an empty cell is a slot a new task can take right now. This is
 * the one piece of "SaaS dashboard" the product can honestly show: not a chart over invented history,
 * but the present shape of the fleet at a glance.
 */
export function Capacity({
  boxes,
  capacity,
  size = "md",
  className,
}: {
  boxes: BoxView[];
  capacity: number;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!capacity) return null;
  const live = boxes.filter((b) => /^running$/i.test(b.boxStatus));
  const cells = Array.from({ length: Math.max(capacity, live.length) }, (_, i) => live[i] ?? null);
  const free = Math.max(0, capacity - live.length);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-2", className)} aria-label={`${live.length} of ${capacity} slots in use`}>
          <div className={cn("flex items-center", size === "sm" ? "gap-1" : "gap-1.5")}>
            {cells.map((b, i) => {
              const s = b ? displayState(b) : null;
              return (
                <span
                  key={b?.name ?? `free-${i}`}
                  className={cn(
                    "rounded-[3px] transition-colors duration-300",
                    size === "sm" ? "h-2 w-3" : "h-2.5 w-5",
                    !b && "bg-border",
                    s === "running" && "bg-live sheen",
                    s === "waiting" && "bg-attention",
                    s === "done" && (b?.exitCode ? "bg-destructive" : "bg-ok"),
                    s === "idle" && "bg-live/45",
                    s === "sleeping" && "bg-sleep"
                  )}
                  aria-hidden
                />
              );
            })}
          </div>
          <span className={cn("text-muted-foreground tabular", size === "sm" ? "text-micro" : "text-meta")}>
            {live.length}/{capacity}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {live.length} of {capacity} machine slots in use · {free} free
      </TooltipContent>
    </Tooltip>
  );
}
