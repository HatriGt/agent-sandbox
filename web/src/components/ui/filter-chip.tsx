import * as React from "react";
import { cn } from "@/lib/utils";

export type ChipTone = "attention" | "live" | "sleep" | "ok" | "destructive";

const TONE: Record<ChipTone, string> = {
  attention: "bg-attention/20 text-attention-text",
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
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  count: number;
  tone?: ChipTone;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={count === 0 && !active}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-meta font-medium outline-none transition-[background-color,border-color,color,transform] duration-150",
        "focus-visible:ring-ring/40 focus-visible:ring-2 disabled:cursor-default disabled:opacity-45",
        active ? "border-foreground/20 bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground hover:border-line-strong active:scale-[0.97]",
        className
      )}
    >
      {label}
      <span className={cn("tabular rounded-full px-1.5 py-px text-micro font-semibold", active ? "bg-background/20 text-background" : tone && count > 0 ? TONE[tone] : "bg-muted text-muted-foreground")}>{count}</span>
    </button>
  );
}
