import { Loader2, MemoryStick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtUsage, type Usage } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

/**
 * The memory rescue card: one click to raise the tier AND continue the task.
 *
 * Two moments produce it:
 *   · the agent was OOM-killed (exit 137) — the run is dead and the ONLY useful next step is more
 *     memory, so the card is the primary action, not a hint buried in a menu;
 *   · memory is critically full mid-run — the card warns that continuing means a restart (this
 *     runtime has no live resize), so the user chooses between letting it ride and bumping now.
 *
 * The click does the whole recovery: resize (reboot, workspace and session kept), then a forced
 * resume telling the agent to pick up where it left off. The user never has to know the sequence.
 */
export function MemoryBumpCard({
  kind,
  nextTier,
  memUsage,
  phase,
  onBump,
}: {
  kind: "oom" | "pressure";
  nextTier: string;
  memUsage?: Usage;
  /** null = idle; otherwise the step in flight, shown in place of the button label. */
  phase: "resizing" | "resuming" | null;
  onBump: () => void;
}) {
  const oom = kind === "oom";
  const usage = fmtUsage(memUsage);
  return (
    <div
      className={cn(
        "enter flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3",
        oom ? "border-destructive/40 bg-destructive/5" : "border-attention/40 bg-attention/5"
      )}
      role="alert"
    >
      <MemoryStick className={cn("size-4 shrink-0", oom ? "text-destructive" : "text-attention")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-body font-medium">
          {oom ? "The machine ran out of memory" : "Memory is nearly full"}
          {usage && !oom ? ` — ${usage}` : ""}
        </p>
        <p className="text-muted-foreground mt-0.5 text-meta">
          {oom
            ? `The kernel stopped the agent mid-task. Raise the memory to ${nextTier} and the agent continues from where it left off — the workspace and session are kept.`
            : `The agent may be stopped by the kernel any moment. Raising to ${nextTier} restarts the machine (workspace and session kept) and the agent continues automatically.`}
        </p>
      </div>
      <Button size="sm" variant={oom ? "primary" : "outline"} onClick={onBump} disabled={phase !== null} className="shrink-0">
        {phase !== null && <Loader2 className="animate-spin" />}
        {phase === "resizing" ? "Adding memory…" : phase === "resuming" ? "Continuing the task…" : `Add memory (${nextTier}) & continue`}
      </Button>
    </div>
  );
}
