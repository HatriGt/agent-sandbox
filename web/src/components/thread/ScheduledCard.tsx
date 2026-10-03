import * as React from "react";
import { AlertTriangle, ArrowUpRight, CalendarClock, Check, Loader2, Minus, Repeat, ShieldAlert, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ThreadScheduleItem, ThreadScheduleReject } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CategoryChip, fmtNext, useActions, useNow, useThreadSchedule } from "./SchedulePill";

/**
 * What this chat scheduled, in the flow of the conversation under the agent's last message — so
 * "I set up the merge for 5 days from now" is followed by the thing itself. Each row is a calendar
 * leaf (month band, big day) next to the name, the exact time and a live countdown; a row that is
 * waiting on you gets the one amber accent in the thread and its Approve button right there.
 * Approving flips the leaf from amber to ink in place and stamps "Approved" for a beat; dismissing
 * folds the row away. A schedule the agent wrote but the controller could not read is shown too,
 * with a one-tap way to ask again — never a silent drop. Reduced motion keeps only the fades.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const SPRING = { type: "spring" as const, bounce: 0.18, duration: 0.5 };

function exact(at: number): string {
  return new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** "in 4 d 23 h" · "in 2 h 10 min" · "in 12 min" · "now" — the line that ticks. */
function countdown(at: number, now: number): string {
  const mins = Math.round((at - now) / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `in ${h} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
  const d = Math.floor(h / 24);
  return `in ${d} d${h % 24 ? ` ${h % 24} h` : ""}`;
}

const btn =
  "focus-visible:ring-live/50 inline-flex h-7.5 cursor-pointer items-center gap-1.5 rounded-full px-3 text-micro font-medium outline-none transition-[background-color,color,scale,opacity] active:scale-[0.96] focus-visible:ring-2 disabled:cursor-default disabled:opacity-60 [&_svg]:size-3.5";

export function ScheduledCard({ box, runState, onRetry }: { box: string; runState: string; onRetry: (text: string) => void }) {
  const { items, rejected, reload } = useThreadSchedule(box, runState);
  const actions = useActions(() => void reload());
  const still = !!useReducedMotion();
  const now = useNow();
  // Ids approved from this card a moment ago: the row stamps "Approved" while the list refreshes.
  const [stamped, setStamped] = React.useState<Set<string>>(() => new Set());
  const stamp = (id: string) => {
    setStamped((s) => new Set(s).add(id));
    window.setTimeout(() => setStamped((s) => ((s.delete(id), new Set(s)))), 3200);
  };

  const mine = items.filter((i) => i.relation === "proposed" || i.relation === "created");
  const pending = mine.filter((i) => i.relation === "proposed");
  // A reject that later got scheduled correctly (the agent tried again) is no longer news.
  const failed = runState !== "running" ? rejected.filter((r) => !mine.some((i) => i.task === r.task)) : [];
  const next = mine
    .map((i) => (i.relation === "proposed" ? null : i.nextFire))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)[0];
  const show = mine.length > 0 || failed.length > 0;

  const subtitle = [
    `${mine.length} scheduled`,
    pending.length > 0 && <span key="p" className="text-attention-text font-medium">{pending.length} awaiting approval</span>,
    next !== undefined && `next ${fmtNext(next, now)}`,
    failed.length > 0 && <span key="f" className="text-destructive">{failed.length} not scheduled</span>,
  ].filter(Boolean);

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.section
          key="scheduled-card"
          layout={!still}
          initial={still ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          transition={still ? { duration: 0.15 } : SPRING}
          aria-label="Scheduled from this chat"
          className="bg-card overflow-hidden rounded-2xl border"
        >
          <header className="flex items-center gap-3 px-4 pt-3.5 pb-3">
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-xl transition-colors duration-500",
                pending.length ? "bg-attention/15 text-attention-text attention-pulse" : "bg-muted text-foreground"
              )}
              aria-hidden
            >
              <CalendarClock className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-meta leading-tight font-semibold">Scheduled from this chat</p>
              <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1 text-micro tabular-nums">
                {subtitle.map((s, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span aria-hidden>·</span>}
                    {s}
                  </React.Fragment>
                ))}
              </p>
            </div>
            <button
              type="button"
              onClick={() => actions.openAutopilot(mine[0])}
              className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-live/50 hidden h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 text-micro font-medium outline-none transition-colors focus-visible:ring-2 sm:inline-flex"
            >
              Autopilot <ArrowUpRight className="size-3.5" />
            </button>
          </header>

          <ul className="border-t">
            <AnimatePresence initial={false}>
              {mine.map((it, i) => (
                <Row key={it.id} it={it} i={i} now={now} still={still} busy={actions.busy === it.id} stamped={stamped.has(it.id)} actions={actions} onApproved={() => stamp(it.id)} />
              ))}
              {failed.map((r, i) => (
                <Rejected key={`${r.when}|${r.task}`} r={r} i={mine.length + i} still={still} onRetry={onRetry} />
              ))}
            </AnimatePresence>
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

type Actions = ReturnType<typeof useActions>;

const rowMotion = (still: boolean, i: number) => ({
  layout: !still,
  initial: still ? { opacity: 0 } : { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, height: "auto" },
  exit: still ? { opacity: 0 } : { opacity: 0, height: 0, x: -16, transition: { duration: 0.24, ease: EASE } },
  transition: still ? { duration: 0.15 } : { ...SPRING, delay: 0.06 + i * 0.05 },
});

function Row({ it, i, now, still, busy, stamped, actions, onApproved }: { it: ThreadScheduleItem; i: number; now: number; still: boolean; busy: boolean; stamped: boolean; actions: Actions; onApproved: () => void }) {
  const pending = it.relation === "proposed";
  const over = it.status === "done" || it.status === "cancelled" || it.status === "failed";
  const at = it.at ?? it.nextFire;
  const live = !pending && !over && at !== null && at !== undefined;
  return (
    <motion.li {...rowMotion(still, i)} className={cn("group relative overflow-hidden border-b last:border-b-0", it.status === "cancelled" && "opacity-60")}>
      {/* The one amber accent: a bar that draws down the left edge while the row waits on you. */}
      <motion.span
        aria-hidden
        className="bg-attention absolute inset-y-2 left-0 w-0.75 origin-top rounded-r-full"
        initial={false}
        animate={{ scaleY: pending ? 1 : 0, opacity: pending ? 1 : 0 }}
        transition={still ? { duration: 0.15 } : { duration: 0.45, ease: EASE, delay: pending ? 0.25 : 0 }}
      />
      <div className="hover:bg-muted/40 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-4 py-3 transition-colors">
        <Leaf it={it} pending={pending} still={still} />
        <div className="min-w-0 flex-1 basis-44">
          <p className="text-foreground flex min-w-0 items-center gap-2 text-meta leading-snug font-medium">
            <span className="truncate" title={it.task}>
              {it.name}
            </span>
            <AnimatePresence>
              {stamped && (
                <motion.span
                  key="stamp"
                  initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -8 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.3 } }}
                  transition={{ type: "spring", bounce: 0.5, duration: 0.5 }}
                  className="bg-foreground text-background inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold"
                >
                  <Check className="size-3" /> Approved
                </motion.span>
              )}
            </AnimatePresence>
          </p>
          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-micro tabular-nums">
            <CategoryChip c={it.category} />
            <Status it={it} />
            {live && at && (
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={countdown(at, now)}
                  initial={still ? { opacity: 0 } : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={still ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="text-foreground font-medium"
                >
                  {countdown(at, now)}
                </motion.span>
              </AnimatePresence>
            )}
          </p>
          {pending && (
            <p className="text-attention-text mt-1.5 flex items-start gap-1.5 text-micro leading-snug">
              <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                {it.why ?? "The agent asked you to confirm it first"} — it stays paused until you approve.
              </span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pending ? (
            <>
              <motion.button
                type="button"
                disabled={busy}
                whileTap={still ? undefined : { scale: 0.95 }}
                className={cn(btn, "bg-foreground text-background hover:bg-foreground/90 shadow-e1")}
                onClick={() => void actions.approve(it).then((ok) => ok && onApproved())}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Check />} {busy ? "Approving…" : "Approve"}
              </motion.button>
              <button type="button" disabled={busy} className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={() => void actions.dismiss(it)}>
                <X /> Dismiss
              </button>
            </>
          ) : (
            <button type="button" className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground opacity-70 group-hover:opacity-100")} onClick={() => actions.openAutopilot(it)}>
              Details <ArrowUpRight />
            </button>
          )}
        </div>
      </div>
    </motion.li>
  );
}

function Status({ it }: { it: ThreadScheduleItem }) {
  if (it.relation === "proposed") return <span>{it.at ? exact(it.at) : it.when}</span>;
  switch (it.status) {
    case "done":
      return <span className="text-foreground/80 inline-flex items-center gap-1 font-medium">Done{it.lastFired && <span className="text-muted-foreground font-normal"> · {exact(it.lastFired)}</span>}</span>;
    case "failed":
      return <span className="text-destructive font-medium">Failed{it.lastOutcome && <span className="font-normal"> · {it.lastOutcome}</span>}</span>;
    case "running":
      return <span className="text-live font-medium">Running now</span>;
    case "cancelled":
      return <span>Cancelled</span>;
    case "paused":
      return <span>Paused · {it.when}</span>;
    default:
      return <span>{it.at ? exact(it.at) : it.nextFire !== null ? `${it.when} · ${exact(it.nextFire)}` : it.when}</span>;
  }
}

/**
 * The calendar leaf: a month band over a big day number, the way a date reads on a wall calendar.
 * Amber band while the row awaits approval, ink once it is on the schedule; a repeating rule shows
 * the repeat mark instead of a day, and a finished one shows how it ended.
 */
function Leaf({ it, pending, still }: { it: ThreadScheduleItem; pending: boolean; still: boolean }) {
  const at = it.at ?? it.nextFire ?? it.lastFired ?? null;
  const d = at !== null ? new Date(at) : null;
  const band = d ? d.toLocaleDateString([], { month: "short" }).replace(".", "") : it.cron ? "every" : "—";
  const body =
    it.status === "done" ? (
      <Check className="size-4.5" aria-label="Done" />
    ) : it.status === "failed" ? (
      <X className="size-4.5" aria-label="Failed" />
    ) : it.status === "cancelled" ? (
      <Minus className="size-4.5" aria-label="Cancelled" />
    ) : it.status === "running" ? (
      <motion.span
        aria-label="Running"
        className="bg-live block size-2.5 rounded-full"
        animate={still ? undefined : { scale: [1, 1.35, 1], opacity: [1, 0.6, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
    ) : d && !it.cron ? (
      <span className="text-[17px] leading-none font-semibold tabular-nums">{d.getDate()}</span>
    ) : (
      <Repeat className="size-4" aria-label="Repeats" />
    );
  return (
    <motion.span
      layout={!still}
      className={cn("shadow-e1 flex w-11 shrink-0 flex-col overflow-hidden rounded-lg text-center select-none", it.status === "done" || it.status === "cancelled" ? "opacity-70" : "")}
      aria-hidden={!d}
      title={d ? exact(d.getTime()) : it.when}
    >
      <span className={cn("py-0.5 text-[9px] leading-[1.3] font-bold tracking-[0.08em] uppercase transition-colors duration-500", pending ? "bg-attention text-attention-ink" : "bg-foreground text-background")}>{band}</span>
      <span className={cn("bg-card text-foreground grid h-8 place-items-center transition-colors duration-500", it.status === "failed" && "text-destructive")}>{body}</span>
    </motion.span>
  );
}

function Rejected({ r, i, still, onRetry }: { r: ThreadScheduleReject; i: number; still: boolean; onRetry: (text: string) => void }) {
  const name = r.task.split(/[.!?](?=\s|$)/)[0].trim();
  return (
    <motion.li {...rowMotion(still, i)} className="overflow-hidden border-b last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-4 py-3">
        <span className={cn("bg-destructive/10 text-destructive grid size-11 shrink-0 place-items-center rounded-lg", !still && "shake-once")} aria-hidden>
          <AlertTriangle className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1 basis-44">
          <p className="text-foreground truncate text-meta leading-snug font-medium" title={r.task}>
            {name}
          </p>
          <p className="text-muted-foreground mt-1 text-micro leading-snug">
            <span className="text-destructive font-medium">Not scheduled</span> · {r.reason}
          </p>
        </div>
        <button
          type="button"
          className={cn(btn, "bg-muted text-foreground hover:bg-muted/70 shrink-0")}
          onClick={() => onRetry(`Schedule this again with an exact time (for example "in 5d" or an ISO date): ${r.task}`)}
        >
          Ask again
        </button>
      </div>
    </motion.li>
  );
}
