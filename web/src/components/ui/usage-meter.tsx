import { HardDrive, MemoryStick } from "lucide-react";
import { fmtMib, usageFraction, usageLevel, type Usage } from "@/lib/lifecycle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A used/total meter — one ratio against a hard limit, so a Meter, not a chart. The fill carries the
 * severity (live blue → amber → red) and the unfilled track is a recessive step of the same ink, so
 * "how full" reads without a legend. The number is ALWAYS rendered: the amber fill is a 1.7:1 mark
 * against paper, which is fine for a bar but obliges a visible value beside it.
 *
 * `kind` only picks the icon and the words; the geometry is identical so RAM and disk stack legibly.
 */
export function UsageMeter({
  kind,
  usage,
  className,
  width = "w-16",
}: {
  kind: "memory" | "disk";
  usage: Usage | undefined;
  className?: string;
  /** Track width utility — narrow inline in a header, wider in a panel. */
  width?: string;
}) {
  const f = usageFraction(usage);
  if (f == null || !usage) return null;
  const level = usageLevel(usage);
  const Icon = kind === "memory" ? MemoryStick : HardDrive;
  const noun = kind === "memory" ? "memory" : "disk";
  const pct = Math.round(f * 100);
  const label = `${fmtMib(usage.usedMib)} / ${fmtMib(usage.totalMib)}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex shrink-0 items-center gap-1.5 text-micro", className)}
          role="meter"
          aria-label={`${noun} ${pct}% used`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <Icon className="text-faint size-3 shrink-0" aria-hidden />
          {/* The track is a lighter step of the same ramp, never a competing colour. */}
          <span className={cn("bg-border/70 block h-1 shrink-0 overflow-hidden rounded-full", width)}>
            <span
              className={cn(
                "block h-full rounded-full transition-[width] duration-700",
                level === "critical" ? "bg-destructive" : level === "high" ? "bg-attention" : "bg-live",
              )}
              style={{ width: `${Math.max(f * 100, 2)}%` }}
            />
          </span>
          <span
            className={cn(
              "stamp whitespace-nowrap",
              level === "critical" ? "text-destructive" : level === "high" ? "text-attention-text" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {pct}% of this machine&rsquo;s {noun} — {fmtMib(usage.usedMib)} of {fmtMib(usage.totalMib)} used
        {level === "critical"
          ? kind === "memory"
            ? ". Nearly full: a bigger task will be OOM-killed. Raise it from the ⋯ menu."
            : ". Nearly full: grow the disk from the ⋯ menu."
          : ""}
      </TooltipContent>
    </Tooltip>
  );
}
