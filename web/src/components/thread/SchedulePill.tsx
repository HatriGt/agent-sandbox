import * as React from "react";
import { ArrowUpRight, CalendarClock, Check, Link2, Play, Repeat, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { api, type ThreadScheduleItem } from "@/lib/api";
import { useGo } from "@/lib/route";
import { cn } from "@/lib/utils";

/**
 * The thread's schedule pill: what is scheduled as part of this chat, floating at the top-right of
 * the conversation. Absent when nothing is scheduled. Collapsed it is one line ("Next · in 2h");
 * open it morphs (one shared layout, spring) into a card listing each item with its next run and
 * the one action that item needs. Ink, not colour: the only amber is the dot on a proposal, which
 * is waiting on you. Reduced motion keeps only the fade.
 */

const RELATION: Record<ThreadScheduleItem["relation"], { label: string; icon: typeof Repeat }> = {
  proposed: { label: "Suggested in this chat · needs your OK", icon: Sparkles },
  created: { label: "Set up from this chat", icon: CalendarClock },
  repeats: { label: "Started this chat · runs again", icon: Repeat },
  after: { label: "Runs after this chat's automation", icon: Link2 },
};

const POLL_MS = 30_000;

/** "in 12 min" · "today 3:00 pm" · "tomorrow 9:00 am" · "Tue 2:00 am" · "12 Oct". */
export function fmtNext(at: number, now = Date.now()): string {
  const d = new Date(at);
  const mins = Math.round((at - now) / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(new Date(now))) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function useThreadSchedule(box: string, runState: string) {
  const [items, setItems] = React.useState<ThreadScheduleItem[]>([]);
  const load = React.useCallback(
    (signal?: AbortSignal) =>
      api
        .threadSchedule(box, signal)
        .then((r) => setItems(r.items))
        .catch(() => {}),
    [box]
  );
  React.useEffect(() => {
    setItems([]);
  }, [box]);
  // On open, on every run-state change (a proposal lands mid-run or at sign-off), on focus, and on a slow poll.
  React.useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const t = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => (ctrl.abort(), window.clearInterval(t), window.removeEventListener("focus", onFocus));
  }, [load, runState]);
  return { items, reload: load };
}

/** Re-render every 30s so "in 12 min" stays true. */
function useNow(): number {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function SchedulePill({ box, runState, className }: { box: string; runState: string; className?: string }) {
  const { items, reload } = useThreadSchedule(box, runState);
  const [open, setOpen] = React.useState(false);
  const still = useReducedMotion();
  const now = useNow();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!items.length) setOpen(false);
  }, [items.length]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => (window.removeEventListener("mousedown", onDown), window.removeEventListener("keydown", onKey, true));
  }, [open]);

  const pending = items.filter((i) => i.relation === "proposed").length;
  const next = items
    .map((i) => i.nextFire)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)[0];
  const summary = pending ? `${pending} to approve` : next ? `Next ${fmtNext(next, now)}` : "Scheduled";

  const spring = still ? { duration: 0.15 } : { type: "spring" as const, bounce: 0.16, duration: 0.42 };
  const fade = { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.16, delay: still ? 0 : 0.08 } }, exit: { opacity: 0, transition: { duration: 0.08 } } };

  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.div
          ref={rootRef}
          key="schedule-pill"
          initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -6 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformOrigin: "100% 0%" }}
          className={cn("absolute top-3 right-3 z-20 flex justify-end md:right-4", className)}
        >
          <motion.div
            layout
            transition={spring}
            style={{ borderRadius: open ? 16 : 999 }}
            className={cn("bg-popover/95 text-popover-foreground overflow-hidden border shadow-e3 backdrop-blur-md", open ? "w-[min(22rem,calc(100vw-2rem))]" : "w-auto")}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {open ? (
                <motion.div key="card" {...fade} role="dialog" aria-label="Scheduled in this chat">
                  <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
                    <CalendarClock className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    <span className="text-foreground flex-1 text-meta font-medium">Scheduled in this chat</span>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setOpen(false)}
                      aria-label="Close"
                      className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-live/50 grid size-7 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <ul className="max-h-[min(24rem,60vh)] divide-y overflow-y-auto">
                    {items.map((it, i) => (
                      <ScheduleRow key={it.id} item={it} now={now} index={i} still={!!still} onChanged={() => void reload()} onNavigate={() => setOpen(false)} />
                    ))}
                  </ul>
                </motion.div>
              ) : (
                <motion.button
                  key="pill"
                  ref={triggerRef}
                  {...fade}
                  type="button"
                  onClick={() => setOpen(true)}
                  aria-expanded={false}
                  aria-haspopup="dialog"
                  title="What's scheduled as part of this chat"
                  className="hover:bg-muted/60 focus-visible:ring-live/50 relative flex h-8 cursor-pointer items-center gap-1.5 rounded-full pr-3 pl-2.5 text-meta font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2"
                >
                  <CalendarClock className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="text-foreground tabular-nums">{summary}</span>
                  {items.length > 1 && <span className="bg-muted text-muted-foreground grid h-4.5 min-w-4.5 place-items-center rounded-full px-1 text-micro tabular-nums">{items.length}</span>}
                  {pending > 0 && <span className="bg-attention absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-[var(--popover)]" aria-hidden />}
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScheduleRow({ item: it, now, index, still, onChanged, onNavigate }: { item: ThreadScheduleItem; now: number; index: number; still: boolean; onChanged: () => void; onNavigate: () => void }) {
  const go = useGo();
  const [busy, setBusy] = React.useState(false);
  const rel = RELATION[it.relation];
  const Icon = rel.icon;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const btn =
    "focus-visible:ring-live/50 inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-micro font-medium outline-none transition-[background-color,scale] active:scale-[0.97] focus-visible:ring-2 disabled:opacity-50 [&_svg]:size-3.5";
  return (
    <motion.li
      initial={still ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: still ? 0 : 0.06 + index * 0.035, ease: [0.22, 1, 0.36, 1] }}
      className="px-3.5 py-3"
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", it.relation === "proposed" ? "bg-attention/15 text-attention-text" : "bg-muted text-muted-foreground")} aria-hidden>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">{it.name}</span>
            {it.nextFire !== null && <span className="text-foreground shrink-0 text-micro font-medium tabular-nums">{fmtNext(it.nextFire, now)}</span>}
          </div>
          <p className="text-muted-foreground truncate text-micro">
            {it.when} · {rel.label}
          </p>
          {it.task && <p className="text-faint mt-1 line-clamp-2 text-micro leading-snug">{it.task}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {it.relation === "proposed" ? (
              <>
                <button type="button" disabled={busy} className={cn(btn, "bg-foreground text-background hover:bg-foreground/90")} onClick={() => void act(() => api.setTriggerEnabled(it.id, true), `Scheduled: ${it.name}`)}>
                  <Check />
                  Approve
                </button>
                <button type="button" disabled={busy} className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={() => void act(() => api.deleteTrigger(it.id), "Dismissed")}>
                  Dismiss
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy} className={cn(btn, "bg-muted text-foreground hover:bg-muted/70")} onClick={() => void act(() => api.runTrigger(it.id), `Started: ${it.name}`)}>
                  <Play />
                  Run now
                </button>
                {it.relation !== "after" && (
                  <button type="button" disabled={busy} className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={() => void act(() => api.setTriggerEnabled(it.id, false), `Paused: ${it.name}`)}>
                    Pause
                  </button>
                )}
              </>
            )}
            <button type="button" className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground ml-auto")} onClick={() => (onNavigate(), go({ view: "automations" }))}>
              Edit
              <ArrowUpRight />
            </button>
          </div>
        </div>
      </div>
    </motion.li>
  );
}
