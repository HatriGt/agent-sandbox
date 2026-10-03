import { ArrowUpRight, CalendarClock, Loader2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ThreadScheduleItem, ThreadScheduleReject } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATEGORY, fmtNext, useActions, useNow, useThreadSchedule } from "./SchedulePill";

/**
 * What this chat scheduled, under the agent's message that scheduled it — in the shape the question
 * card uses for anything the agent hands back to you: a label line, a plain card, a footer with the
 * action. One card per schedule. A card waiting on your approval carries the amber border; once
 * approved it is an ordinary ink card with when it runs. A schedule the agent wrote but the
 * controller could not read is shown too, with a one-tap way to ask again — never a silent drop.
 */

function exact(at: number): string {
  return new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function ScheduledCard({ box, runState, onRetry }: { box: string; runState: string; onRetry: (text: string) => void }) {
  const { items, rejected, reload } = useThreadSchedule(box, runState);
  const actions = useActions(() => void reload());
  const still = !!useReducedMotion();
  const now = useNow();

  const mine = items.filter((i) => i.relation === "proposed" || i.relation === "created");
  const pending = mine.filter((i) => i.relation === "proposed").length;
  // A reject that later got scheduled correctly (the agent tried again) is no longer news.
  const failed = runState !== "running" ? rejected.filter((r) => !mine.some((i) => i.task === r.task)) : [];
  if (mine.length === 0 && failed.length === 0) return null;

  const spring = still ? { duration: 0.15 } : { type: "spring" as const, stiffness: 320, damping: 26 };
  return (
    <motion.div initial={still ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="flex max-w-[72ch] flex-col gap-1.5">
      <span className={cn("label flex items-center gap-1.5", pending ? "text-attention-text" : "text-muted-foreground")}>
        <span className="relative grid size-3 place-items-center" aria-hidden>
          {pending > 0 && <span className="bg-attention mcp-ping absolute inset-0 rounded-full opacity-40 motion-reduce:hidden" />}
          <CalendarClock className="size-3" strokeWidth={2.5} />
        </span>
        {pending > 0 ? (pending === 1 ? "Scheduled — waiting for your approval" : `Scheduled — ${pending} waiting for your approval`) : "Scheduled from this chat"}
      </span>
      <AnimatePresence initial={false}>
        {mine.map((it) => (
          <Card key={it.id} it={it} now={now} still={still} busy={actions.busy === it.id} actions={actions} />
        ))}
        {failed.map((r) => (
          <Rejected key={`${r.when}|${r.task}`} r={r} still={still} onRetry={onRetry} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

type Actions = ReturnType<typeof useActions>;

const leave = (still: boolean) => ({
  layout: !still,
  initial: still ? { opacity: 0 } : { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: still ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: -6, transition: { duration: 0.2 } },
});

function when(it: ThreadScheduleItem, now: number): string {
  if (it.relation === "proposed") return it.at ? `Runs once · ${exact(it.at)}` : it.when;
  switch (it.status) {
    case "done":
      return `Done${it.lastFired ? ` · ${exact(it.lastFired)}` : ""}`;
    case "failed":
      return `Failed${it.lastOutcome ? ` · ${it.lastOutcome}` : ""}`;
    case "running":
      return "Running now";
    case "cancelled":
      return "Cancelled";
    case "paused":
      return `Paused · ${it.when}`;
    default:
      if (it.at) return `Runs once · ${exact(it.at)} · ${fmtNext(it.at, now)}`;
      return it.nextFire !== null ? `${it.when} · next ${fmtNext(it.nextFire, now)}` : it.when;
  }
}

function Card({ it, now, still, busy, actions }: { it: ThreadScheduleItem; now: number; still: boolean; busy: boolean; actions: Actions }) {
  const pending = it.relation === "proposed";
  const over = it.status === "done" || it.status === "cancelled";
  return (
    <motion.div
      {...leave(still)}
      role="group"
      aria-label={it.name}
      className={cn(
        "bg-card overflow-hidden rounded-xl border transition-[border-color,box-shadow] duration-500",
        pending && "border-attention/50 attention-glow attention-pulse",
        over && "opacity-70"
      )}
    >
      <div className="px-5 pt-4 pb-3">
        <p className="text-foreground text-body leading-[1.5] font-medium text-balance" title={it.task}>
          {it.name}
        </p>
        <p className={cn("mt-1 text-meta leading-relaxed tabular-nums", it.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
          {when(it, now)} · {CATEGORY[it.category].label}
        </p>
        {pending && <p className="text-muted-foreground mt-1 text-meta leading-relaxed">{it.why ?? "The agent asked you to confirm it first"}. It stays paused until you approve.</p>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
        {pending ? (
          <>
            <p className="text-muted-foreground min-w-0 text-micro leading-snug line-clamp-2 sm:truncate">Approving puts it on the schedule. Nothing runs until you do.</p>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void actions.dismiss(it)}>
                Dismiss
              </Button>
              <Button variant="attention" size="sm" disabled={busy} onClick={() => void actions.approve(it)}>
                {busy && <Loader2 className="animate-spin" />}
                {busy ? "Approving…" : "Approve"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted-foreground min-w-0 truncate text-micro leading-snug">{it.relation === "created" && it.enabled && !over ? "On the schedule. You can pause or run it early from Autopilot." : "Kept in Autopilot."}</p>
            <Button variant="ghost" size="xs" className="shrink-0" onClick={() => actions.openAutopilot(it)}>
              Open in Autopilot <ArrowUpRight className="size-3.5" />
            </Button>
          </>
        )}
      </div>
    </motion.div>
  );
}

function Rejected({ r, still, onRetry }: { r: ThreadScheduleReject; still: boolean; onRetry: (text: string) => void }) {
  const name = r.task.split(/[.!?](?=\s|$)/)[0].trim();
  return (
    <motion.div {...leave(still)} role="alert" className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-body font-medium" title={r.task}>
          {name}
        </p>
        <p className="text-muted-foreground mt-0.5 text-meta">Not scheduled — {r.reason}.</p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => onRetry(`Schedule this again with an exact time (for example "in 5d" or an ISO date): ${r.task}`)}>
        Ask again
      </Button>
    </motion.div>
  );
}
