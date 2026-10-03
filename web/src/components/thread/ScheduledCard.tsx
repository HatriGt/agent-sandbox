import { ArrowUpRight, CalendarClock, Check, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ThreadScheduleItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CategoryChip, fmtNext, useActions, useThreadSchedule } from "./SchedulePill";

/**
 * What this chat scheduled, in the flow of the conversation under the agent's last message — so
 * "I set up the merge for 5 days from now" is followed by the thing itself: when it runs, whether it
 * is waiting on you, and the Approve button. The pill at the top-right is the same list, always in
 * reach; this card is where you read it the moment it happens.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

function exact(at: number): string {
  return new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function status(it: ThreadScheduleItem, now: number): string {
  if (it.relation === "proposed") return it.at ? `Once · ${exact(it.at)}` : it.when;
  switch (it.status) {
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "running":
      return "Running now";
    case "cancelled":
      return "Cancelled";
    case "paused":
      return "Paused";
    default:
      return it.nextFire !== null ? `${it.at ? "Once" : it.when} · ${fmtNext(it.nextFire, now)}` : it.when;
  }
}

export function ScheduledCard({ box, runState }: { box: string; runState: string }) {
  const { items, reload } = useThreadSchedule(box, runState);
  const actions = useActions(() => void reload());
  const still = useReducedMotion();
  const now = Date.now();
  const mine = items.filter((i) => i.relation === "proposed" || i.relation === "created");
  const pending = mine.filter((i) => i.relation === "proposed").length;
  const btn = "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-micro font-medium transition-colors disabled:opacity-50 [&_svg]:size-3.5";
  return (
    <AnimatePresence initial={false}>
      {mine.length > 0 && (
        <motion.section
          key="scheduled-card"
          initial={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE }}
          aria-label="Scheduled from this chat"
          className="bg-card rounded-xl border"
        >
          <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
            <CalendarClock className={cn("size-4 shrink-0", pending ? "text-attention-text" : "text-muted-foreground")} aria-hidden />
            <p className="text-foreground text-meta font-semibold">Scheduled from this chat</p>
            {pending > 0 && <span className="bg-attention/15 text-attention-text rounded-full px-2 py-0.5 text-micro font-medium">{pending === 1 ? "Needs your OK" : `${pending} need your OK`}</span>}
          </header>
          <ul className="divide-y border-t">
            {mine.map((it) => {
              const busy = actions.busy === it.id;
              const dim = it.status === "done" || it.status === "cancelled";
              return (
                <li key={it.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5", dim && "opacity-60")}>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-foreground truncate text-meta font-medium" title={it.task}>
                      {it.name}
                    </p>
                    <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro tabular-nums">
                      <CategoryChip c={it.category} />
                      <span>{status(it, now)}</span>
                      {it.relation === "proposed" && it.why && <span className="text-attention-text">· {it.why}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {it.relation === "proposed" ? (
                      <>
                        <button type="button" disabled={busy} className={cn(btn, "bg-foreground text-background hover:bg-foreground/90")} onClick={() => void actions.approve(it)}>
                          <Check /> Approve
                        </button>
                        <button type="button" disabled={busy} className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={() => void actions.dismiss(it)}>
                          <X /> Dismiss
                        </button>
                      </>
                    ) : (
                      <button type="button" className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={() => actions.openAutopilot(it)}>
                        Open <ArrowUpRight />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
