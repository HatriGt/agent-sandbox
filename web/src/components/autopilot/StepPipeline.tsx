import { ChevronRight, Terminal, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PipelineStep {
  /** agent: one more turn of the agent · check: a command that must exit 0. */
  kind: "agent" | "check";
  label: string;
  retry?: number;
}

/**
 * A playbook's steps as a row of chips: agent turns in ink, command checks in mono with their retry
 * budget, so a prompt never reads as a command. Wraps on narrow cards instead of truncating.
 */
export function StepPipeline({ steps, className }: { steps: readonly PipelineStep[]; className?: string }) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-1 gap-y-1.5", className)} aria-label={`${steps.length} steps`}>
      {steps.map((s, i) => (
        <li key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="text-faint size-3 shrink-0" aria-hidden />}
          <span
            className={cn(
              "inline-flex max-w-[12rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-micro",
              s.kind === "check" ? "bg-muted/60 text-muted-foreground font-mono" : "bg-background text-foreground"
            )}
            title={s.kind === "check" ? `Check: ${s.label}${s.retry ? ` — back to the agent up to ${s.retry}×` : ""}` : `Agent turn: ${s.label}`}
          >
            {s.kind === "check" ? <Terminal className="size-3 shrink-0" aria-hidden /> : <Wand2 className="text-live size-3 shrink-0" aria-hidden />}
            <span className="truncate">{s.label}</span>
            {s.retry ? <span className="text-faint shrink-0 tabular">×{s.retry}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
