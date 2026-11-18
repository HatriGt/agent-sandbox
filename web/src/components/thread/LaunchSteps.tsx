import * as React from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { friendlyName } from "@/lib/format";
import { launchKind, launchRows, stuckAfterMs, type LaunchRow } from "@/lib/launch";
import { useLaunch } from "@/hooks/useLaunch";
import { useNow } from "@/hooks/useNow";
import { useReducedMotion } from "@/lib/motion-pref";
import { Swap } from "@/components/ui/swap";
import { Collapse } from "@/components/ui/collapse";
import { IconSwap } from "@/components/ui/icon-swap";

/**
 * The agent's side of the conversation before it has said anything: a tonal card that narrates
 * the launch as it happens — the request leaving, access resolved, the host picked, a repo cloned,
 * a warm sandbox claimed or a fresh one booted, the agent started, the wait for its first words.
 * Each row is a real stage the controller reported the moment it began (src/launch-progress.ts);
 * nothing here is a timer pretending to be progress.
 *
 * Motion, all time-driven and all from the shared vocabulary (web/DESIGN.md, Motion): rows rise in
 * as they arrive and the rest keep their place (`layout="position"`); a live wash glides from the
 * finished row to the new one (`layoutId`); the dots crossfade into a check that draws itself; the
 * rail between marks takes ink as each stage completes; the seconds lift in one by one; an overrun
 * note and the failure reason unfold. Done rows settle into muted ink at the same weight, so no
 * word ever reflows. Everything but the fades is dropped under reduced motion.
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
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <div className={cn("flex flex-col gap-1.5", className)} role="status" aria-live="polite" aria-label="Starting the run" data-launch-steps>
      <span className="label text-muted-foreground flex items-center gap-1.5 pl-1">
        <span className={cn("size-1.5 rounded-full transition-colors duration-500", failed ? "bg-destructive" : "bg-live breathe")} aria-hidden />
        <Swap state={name} mode="popLayout" y={3}>
          {name}
        </Swap>
      </span>
      <div className="viz-card w-full max-w-[min(100%,34rem)] rounded-2xl rounded-tl-md px-4 py-3">
        <LayoutGroup id={launchId ?? "launch"}>
          <ol className="relative flex flex-col">
            <AnimatePresence initial={false}>
              {rows.map((r, i) => (
                <motion.li
                  key={r.key}
                  layout="position"
                  initial={still ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(2px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: still ? 0.12 : 0.28, ease, layout: { type: "spring", stiffness: 420, damping: 38 } }}
                  className="relative flex min-w-0 items-center gap-3 py-1 text-meta"
                >
                  {/* The live wash: one element that glides to whichever row is current. */}
                  {r.state === "active" && !still && (
                    <motion.span layoutId="launch-active" transition={{ type: "spring", stiffness: 380, damping: 36 }} className="bg-live/8 absolute -inset-x-2 inset-y-0 rounded-lg" aria-hidden />
                  )}
                  {/* The rail segment down to the next mark; it takes ink once this stage is done. */}
                  {i < rows.length - 1 && (
                    <span
                      className={cn("absolute left-[7.5px] top-[calc(50%+9px)] h-[calc(100%-10px)] w-px transition-colors duration-500 ease-out", r.state === "done" ? "bg-foreground/30" : "bg-foreground/10")}
                      aria-hidden
                    />
                  )}
                  <RowMark row={r} still={still} />
                  <span className={cn("relative min-w-0 flex-1 truncate transition-colors duration-500 ease-out", r.state === "active" ? "text-foreground" : r.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
                    {r.label}
                  </span>
                  <span className="stamp text-faint relative flex h-4 shrink-0 items-center overflow-hidden" aria-hidden>
                    {r.state === "active" ? (
                      // Counted from the second second: a stage that is over in a blink never shows a number.
                      <Swap state={Math.max(0, Math.floor((now - r.at) / 1000))} mode="popLayout" y={6}>
                        {now - r.at >= 1000 ? `${Math.floor((now - r.at) / 1000)}s` : ""}
                      </Swap>
                    ) : r.state === "done" && r.took !== undefined && r.took >= 1000 ? (
                      <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: 0.1 }}>
                        {Math.round(r.took / 1000)}s
                      </motion.span>
                    ) : null}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </LayoutGroup>
        <Collapse open={!!failed && !!failed.detail}>
          <p className="text-muted-foreground pt-2 pl-7 text-micro">{failed?.detail}</p>
        </Collapse>
        <Collapse open={stuck}>
          <p className="text-attention-text pt-2 pl-7 text-micro">Taking longer than usual. The run carries on; this page follows it.</p>
        </Collapse>
      </div>
    </div>
  );
}

/** The mark at the head of a row: breathing dots while it runs, a check that draws itself once done, a cross on failure. */
function RowMark({ row, still }: { row: LaunchRow; still: boolean }) {
  return (
    <IconSwap state={row.state} className="relative size-4 shrink-0">
      {row.state === "done" ? (
        <svg viewBox="0 0 14 14" className="text-foreground/70 size-3.5" aria-hidden>
          <motion.path
            d="M2.5 7.5 L5.5 10.5 L11.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={still ? { pathLength: 1 } : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
          />
        </svg>
      ) : row.state === "failed" ? (
        <X className="text-destructive size-3.5" strokeWidth={2.5} aria-hidden />
      ) : (
        <span className="text-live flex items-center gap-0.5" aria-hidden>
          <span className="bg-current dot dot-1 size-1 rounded-full" />
          <span className="bg-current dot dot-2 size-1 rounded-full" />
          <span className="bg-current dot dot-3 size-1 rounded-full" />
        </span>
      )}
    </IconSwap>
  );
}

/**
 * The one-line receipt once the transcript has taken over: how long the launch took and on what.
 * Unfolds into place under the task. Only for the tab that pressed Send (the feed lives in this
 * tab), so a reopened thread never shows a receipt it cannot vouch for.
 */
export function LaunchReceipt({ launchId }: { launchId?: string }) {
  const feed = useLaunch(launchId);
  const still = useReducedMotion();
  const started = feed?.done ? feed.steps.find((s) => s.phase === "started") : undefined;
  const secs = feed && started ? Math.max(1, Math.round((started.at - feed.sentAt) / 1000)) : 0;
  const kind = feed ? launchKind(feed.steps) : undefined;
  return (
    <Collapse open={!!started}>
      <div className="flex items-center gap-3 py-0.5" data-launch-receipt>
        <span className="label text-muted-foreground inline-flex shrink-0 items-center gap-1.5">
          <svg viewBox="0 0 14 14" className="size-3" aria-hidden>
            <motion.path d="M2.5 7.5 L5.5 10.5 L11.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={still ? { pathLength: 1 } : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.2 }} />
          </svg>
          Started in {secs}s{kind ? ` on a ${kind === "warm" ? "warm" : "fresh"} sandbox` : ""}
        </span>
        <span className={cn("bg-border h-px flex-1", !still && "rule-draw")} aria-hidden />
      </div>
    </Collapse>
  );
}
