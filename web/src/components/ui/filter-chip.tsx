import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { NumberTicker } from "@/components/ui/number-ticker";

export type ChipTone = "attention" | "live" | "sleep" | "ok" | "destructive";

const TONE: Record<ChipTone, string> = {
  attention: "text-attention-text ring-1 ring-inset ring-attention/40",
  live: "bg-live/10 text-live",
  sleep: "bg-sleep/10 text-sleep",
  ok: "bg-ok/10 text-ok",
  destructive: "bg-destructive/10 text-destructive",
};

/**
 * A count-carrying filter pill: the counts ARE the filter. One `radiogroup` of these sits above a
 * list; the active chip is the one ink fill in the row, the rest are paper with a tinted count when
 * the state has a hue (needs you, working, failed…). A zero count disables the chip — there is
 * nothing to narrow to — but the active chip stays clickable so the group is never stuck.
 */
export function FilterChip({
  active,
  onClick,
  label,
  count,
  tone,
  className,
  group,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  count: number;
  tone?: ChipTone;
  className?: string;
  /** Shared id for one radiogroup: the ink fill slides between chips instead of jumping. */
  group?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={count === 0 && !active}
      className={cn(
        "relative isolate flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-meta font-medium outline-none",
        "focus-visible:ring-ring/40 focus-visible:ring-2 disabled:cursor-default disabled:opacity-45",
        active ? "border-foreground/20 text-background" : "bg-card text-muted-foreground hover:text-foreground hover:border-line-strong",
        active && !group && "bg-foreground",
        className
      )}
    >
      {active && group && (
        <motion.span
          layoutId={`filter-chip-${group}`}
          className="bg-foreground absolute inset-0 -z-10 rounded-full"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
          aria-hidden
        />
      )}
      {label}
      <span className={cn("tabular rounded-full px-1.5 py-px text-micro font-semibold", active ? "bg-background/20 text-background" : tone && count > 0 ? TONE[tone] : "bg-muted text-muted-foreground")}>
        <NumberTicker value={count} from={count} />
      </span>
    </button>
  );
}
