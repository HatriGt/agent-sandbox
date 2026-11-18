import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { friendlyName } from "@/lib/format";
import { launchKind, launchRows, stuckAfterMs, type LaunchRow } from "@/lib/launch";
import { useLaunch } from "@/hooks/useLaunch";
import { useNow } from "@/hooks/useNow";
import { useReducedMotion } from "@/lib/motion-pref";

/**
 * The agent's side of the conversation before it has said anything: a bubble that narrates the
 * launch as it happens — the request leaving, access resolved, the host picked, a repo cloned, a
 * warm sandbox claimed or a fresh one booted, the agent started, the wait for its first words.
 * Each row is a real stage reported by the controller the moment it begins (src/launch-progress.ts);
 * nothing here is a timer pretending to be progress.
 *
 * Same silhouette as a reply would have (label row, then the surface) so the transcript's first
 * real turn lands where the reader is already looking. Done rows carry how long they took; the
 * active row ticks; a stage that overruns says so instead of leaving a dot breathing for minutes.
 */
export function LaunchBubble({ launchId, machine, className }: { launchId?: string; machine?: string; className?: string }) {
  const feed = useLaunch(launchId);
  // A pane that opened without a feed (a refresh mid-boot) still narrates from what it knows.
  const [mountedAt] = React.useState(() => Date.now());
  const now = useNow(true, 1000);
  const rows = launchRows(feed?.steps ?? [], { sentAt: feed?.sentAt ?? mountedAt, machine: machine ? friendlyName(machine) : undefined, now });
  const active = rows.find((r) => r.state === "active");
  const failed = rows.find((r) => r.state === "failed");
  const stuck = !!active && now - active.at >= stuckAfterMs(active);
  const still = useReducedMotion();
  const name = machine ? friendlyName(machine) : "Agent Sandbox";

  return (
    <div className={cn("flex flex-col gap-1.5", className)} role="status" aria-live="polite" aria-label="Starting the run" data-launch-steps>
      <span className="label text-muted-foreground flex items-center gap-1.5 pl-1">
        <span className={cn("size-1.5 rounded-full", failed ? "bg-destructive" : "bg-live breathe")} aria-hidden />
        {name}
      </span>
      <div className="bg-card raised border-border w-full max-w-[min(100%,34rem)] rounded-2xl rounded-tl-md border px-4 py-3">
        <ol className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <motion.li
                key={r.key}
                layout="position"
                initial={still ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: still ? 0.1 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="flex min-w-0 items-center gap-2.5 text-meta"
              >
                <RowMark row={r} />
                <span className={cn("min-w-0 truncate", r.state === "active" ? "text-foreground font-medium" : r.state === "failed" ? "text-destructive font-medium" : "text-muted-foreground")}>{r.label}</span>
                {r.state === "failed" && r.detail && <span className="text-muted-foreground min-w-0 truncate text-micro">{r.detail}</span>}
                <span className="stamp text-faint ml-auto shrink-0 pl-2" aria-hidden>
                  {r.state === "active" ? `${Math.max(0, Math.floor((now - r.at) / 1000))}s` : r.state === "done" && r.took !== undefined && r.took >= 1000 ? `${Math.round(r.took / 1000)}s` : ""}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
        <AnimatePresence initial={false}>
          {stuck && (
            <motion.p
              key="stuck"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="text-attention-text overflow-hidden pt-2 text-micro"
            >
              Taking longer than usual. The run carries on; this page follows it.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RowMark({ row }: { row: LaunchRow }) {
  if (row.state === "done") {
    return (
      <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} className="text-muted-foreground grid size-4 shrink-0 place-items-center" aria-hidden>
        <Check className="size-3.5" strokeWidth={2.5} />
      </motion.span>
    );
  }
  if (row.state === "failed") {
    return (
      <span className="text-destructive grid size-4 shrink-0 place-items-center" aria-hidden>
        <X className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className="text-live flex size-4 shrink-0 items-center justify-center gap-0.5" aria-hidden>
      <span className="bg-current dot dot-1 size-1 rounded-full" />
      <span className="bg-current dot dot-2 size-1 rounded-full" />
      <span className="bg-current dot dot-3 size-1 rounded-full" />
    </span>
  );
}

/**
 * The one-line receipt once the transcript has taken over: how long the launch took and on what.
 * Only for the tab that pressed Send (the feed lives in this tab), so a reopened thread never
 * shows a receipt it cannot vouch for.
 */
export function LaunchReceipt({ launchId }: { launchId?: string }) {
  const feed = useLaunch(launchId);
  if (!feed || !feed.done) return null;
  const started = feed.steps.find((s) => s.phase === "started");
  if (!started) return null;
  const secs = Math.max(1, Math.round((started.at - feed.sentAt) / 1000));
  const kind = launchKind(feed.steps);
  return (
    <div className="flex items-center gap-3 py-0.5" data-launch-receipt>
      <span className="label text-muted-foreground inline-flex shrink-0 items-center gap-1.5">
        <Check className="size-3" aria-hidden />
        Started in {secs}s{kind ? ` on a ${kind === "warm" ? "warm" : "fresh"} sandbox` : ""}
      </span>
      <span className="bg-border h-px flex-1" aria-hidden />
    </div>
  );
}
