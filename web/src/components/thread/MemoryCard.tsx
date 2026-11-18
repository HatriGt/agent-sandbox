import * as React from "react";
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
 *   · memory is critically full mid-run — the card says that continuing means a pause and a
 *     restart (this runtime has no live resize), so the user chooses between letting it ride and
 *     bumping now.
 *
 * The click is ONE request that does the whole recovery server-side (/memory.json with
 * `continue`): a live turn is paused cleanly, the machine reboots with the new tier (workspace,
 * /tmp and session kept), and the same session resumes with a continuation line. While that runs
 * the button counts the seconds, so a half-minute reboot reads as progress rather than a hang.
 */
export function MemoryBumpCard({
  kind,
  nextTier,
  memUsage,
  busySince,
  onBump,
}: {
  kind: "oom" | "pressure";
  nextTier: string;
  memUsage?: Usage;
  /** When the one-click recovery started, or null when idle. */
  busySince: number | null;
  onBump: () => void;
}) {
  const oom = kind === "oom";
  const usage = fmtUsage(memUsage);
  const elapsed = useElapsedSeconds(busySince);
  const busy = busySince !== null;
  return (
    <div
      className={cn(
        "enter flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3",
        oom ? "border-destructive/40 bg-destructive/5" : "border-warn/40 bg-warn/5"
      )}
      role="alert"
      aria-busy={busy}
    >
      <MemoryStick className={cn("size-4 shrink-0", oom ? "text-destructive" : "text-attention")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-body font-medium">
          {busy ? `Adding memory (${nextTier})` : oom ? "The machine ran out of memory" : "Memory is nearly full"}
          {usage && !oom && !busy ? ` — ${usage}` : ""}
        </p>
        <p className="text-muted-foreground mt-0.5 text-meta">
          {busy
            ? oom
              ? "Restarting the machine with more memory, then the agent continues from where it was stopped. Usually under a minute."
              : "Pausing the agent, restarting the machine with more memory, then continuing the task where it paused. Usually under a minute."
            : oom
              ? `The kernel stopped the agent mid-task. Raise the memory to ${nextTier} and the agent continues from where it left off — the workspace, /tmp and the session are kept.`
              : `The agent may be stopped by the kernel any moment. Raising to ${nextTier} pauses the agent, restarts the machine (workspace, /tmp and session kept) and continues the task automatically.`}
        </p>
      </div>
      <Button size="sm" variant={oom ? "primary" : "outline"} onClick={onBump} disabled={busy} className="shrink-0 tabular-nums">
        {busy && <Loader2 className="animate-spin" />}
        {busy ? `Adding memory… ${elapsed}s` : `Add memory (${nextTier}) & continue`}
      </Button>
    </div>
  );
}

/** Whole seconds since `since`, ticking once a second; 0 while idle. */
function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}
