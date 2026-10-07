import * as React from "react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDot,
  FileText,
  GitPullRequest,
  MoreHorizontal,
  Pause,
  Play,
  Rocket,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { api, type ThreadScheduleItem, type ThreadScheduleReject } from "@/lib/api";
import { useGo } from "@/lib/route";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The thread's schedule pill: what is scheduled as part of this chat, floating at the top-right of
 * the conversation. Absent when nothing is. Collapsed it is one line ("Next in 2h"); open it morphs
 * (one shared layout, spring) into a compact table — type, what, next run, options — and a row opens
 * its detail in place. Ink, not colour: an item awaiting approval is marked by weight, not hue.
 * Reduced motion keeps only the fades.
 */

type Item = ThreadScheduleItem;

export const CATEGORY: Record<Item["category"], { label: string; icon: typeof Rocket }> = {
  ci: { label: "CI", icon: GitPullRequest },
  deploy: { label: "Deploy", icon: Rocket },
  monitor: { label: "Monitor", icon: Activity },
  report: { label: "Report", icon: FileText },
  "follow-up": { label: "Follow-up", icon: BellRing },
  maintenance: { label: "Upkeep", icon: Wrench },
  task: { label: "Task", icon: CircleDot },
};

const ORIGIN: Record<Item["relation"], string> = {
  proposed: "Scheduled by the agent in this chat — runs once you approve it",
  created: "Scheduled by the agent in this chat",
  repeats: "The schedule that started this chat — runs again",
  after: "Runs after this chat's automation finishes",
};

const STATUS_LABEL: Partial<Record<Item["status"], string>> = { done: "Done", failed: "Failed", running: "Running", cancelled: "Cancelled", waiting: "Waiting", paused: "Paused" };

const POLL_MS = 30_000;
const EASE = [0.22, 1, 0.36, 1] as const;

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

function fmtAgo(at: number, now = Date.now()): string {
  const mins = Math.round((now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** The task's first sentence is the name; the rest, if any, is the short description. */
function blurb(it: Item): string {
  const rest = it.task.startsWith(it.name) ? it.task.slice(it.name.length).replace(/^[.!?\s]+/, "") : it.task;
  return rest || it.when;
}

export function useThreadSchedule(box: string, runState: string) {
  const [items, setItems] = React.useState<Item[]>([]);
  const [rejected, setRejected] = React.useState<ThreadScheduleReject[]>([]);
  const load = React.useCallback(
    (signal?: AbortSignal) =>
      api
        .threadSchedule(box, signal)
        .then((r) => (setItems(r.items), setRejected(r.rejected ?? [])))
        .catch(() => {}),
    [box]
  );
  React.useEffect(() => {
    setItems([]);
    setRejected([]);
  }, [box]);
  // On open, on every run-state change (the agent schedules mid-run or at sign-off), on focus, and on a slow poll.
  React.useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const t = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => (ctrl.abort(), window.clearInterval(t), window.removeEventListener("focus", onFocus));
  }, [load, runState]);
  return { items, rejected, reload: load };
}

/** Re-render every 30s so "in 12 min" stays true. */
export function useNow(): number {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** The actions every surface (row menu, detail footer) shares. */
export function useActions(reload: () => void) {
  const go = useGo();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
      reload();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  return {
    busy,
    approve: (it: Item) => run(it.id, () => api.setTriggerEnabled(it.id, true), `Approved — ${it.name} is on the schedule`),
    dismiss: (it: Item) => run(it.id, () => api.deleteTrigger(it.id), "Dismissed"),
    remove: (it: Item) => run(it.id, () => api.deleteTrigger(it.id), `Deleted: ${it.name}`),
    runNow: (it: Item) => run(it.id, () => api.runTrigger(it.id), `Started: ${it.name}`),
    setOn: (it: Item, on: boolean) => run(it.id, () => api.setTriggerEnabled(it.id, on), `${on ? "Resumed" : "Paused"}: ${it.name}`),
    openAutopilot: (it?: Item) => go({ view: it?.scope === "scheduled" ? "scheduled" : "automations" }),
    openBox: (name: string) => go({ view: "box", name }),
  };
}
type Actions = ReturnType<typeof useActions>;

export function SchedulePill({ box, runState, className }: { box: string; runState: string; className?: string }) {
  const { items, reload } = useThreadSchedule(box, runState);
  const [open, setOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const still = useReducedMotion();
  const now = useNow();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const actions = useActions(() => void reload());
  const detail = items.find((i) => i.id === detailId) ?? null;

  React.useEffect(() => {
    if (!items.length) setOpen(false);
  }, [items.length]);
  React.useEffect(() => {
    if (!open) setDetailId(null);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element;
      // The row menu renders in a portal: a click in it is still "inside".
      if (rootRef.current?.contains(el) || el.closest?.("[role=menu]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[role=menu]")) return;
      e.stopPropagation();
      if (detailId) return setDetailId(null);
      setOpen(false);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => (window.removeEventListener("mousedown", onDown), window.removeEventListener("keydown", onKey, true));
  }, [open, detailId]);

  const pending = items.filter((i) => i.relation === "proposed").length;
  const live = items.filter((i) => i.enabled).length;
  const next = items
    .map((i) => i.nextFire)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)[0];
  const summary = pending ? `${pending} awaiting approval` : next ? `Next ${fmtNext(next, now)}` : `${items.length} paused`;

  const spring = still ? { duration: 0.15 } : { type: "spring" as const, bounce: 0.14, duration: 0.45 };
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
          transition={{ duration: 0.2, ease: EASE }}
          style={{ transformOrigin: "100% 0%" }}
          className={cn("absolute top-3 right-3 z-20 flex justify-end md:right-4", className)}
        >
          <motion.div
            layout
            transition={spring}
            style={{ borderRadius: open ? 18 : 999 }}
            className={cn("bg-popover/95 text-popover-foreground overflow-hidden border shadow-e3 backdrop-blur-md", open ? "w-[min(34rem,calc(100vw-1.5rem))]" : "w-auto")}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {open ? (
                <motion.div key="card" {...fade} role="dialog" aria-label="Scheduled in this chat">
                  <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
                    <span className="bg-muted text-foreground grid size-8 shrink-0 place-items-center rounded-lg" aria-hidden>
                      <CalendarClock className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground text-meta leading-tight font-semibold">Scheduled in this chat</p>
                      <p className="text-muted-foreground text-micro tabular-nums">
                        {live} running on schedule
                        {pending > 0 && <span className="text-attention-text"> · {pending} awaiting approval</span>}
                        {next && ` · next ${fmtNext(next, now)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setOpen(false)}
                      aria-label="Close"
                      className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-live/50 grid size-7 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2"
                    >
                      <X className="size-4" />
                    </button>
                  </header>
                  <AnimatePresence mode="wait" initial={false}>
                    {detail ? (
                      <motion.div
                        key={`detail-${detail.id}`}
                        initial={still ? { opacity: 0 } : { opacity: 0, x: 18 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={still ? { opacity: 0 } : { opacity: 0, x: 18 }}
                        transition={{ duration: 0.2, ease: EASE }}
                      >
                        <Detail it={detail} now={now} actions={actions} onBack={() => setDetailId(null)} onLeave={() => setOpen(false)} />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="table"
                        initial={still ? { opacity: 0 } : { opacity: 0, x: -18 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={still ? { opacity: 0 } : { opacity: 0, x: -18 }}
                        transition={{ duration: 0.2, ease: EASE }}
                      >
                        <Table items={items} now={now} still={!!still} actions={actions} onOpen={setDetailId} onLeave={() => setOpen(false)} />
                      </motion.div>
                    )}
                  </AnimatePresence>
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
                  title={`Scheduled in this chat — ${summary}`}
                  aria-label={`Scheduled in this chat: ${summary}`}
                  className="hover:bg-muted/60 focus-visible:ring-live/50 relative flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2 text-meta @[68rem]:pr-3 @[68rem]:pl-2.5 font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2"
                >
                  <CalendarClock className={cn("size-4 shrink-0", pending ? "text-attention-text" : "text-muted-foreground")} aria-hidden />
                  <span className={cn("hidden tabular-nums @[68rem]:inline", pending ? "text-attention-text" : "text-foreground")}>{summary}</span>
                  {items.length > 1 && <span className="hidden @[68rem]:grid bg-muted text-muted-foreground h-4.5 min-w-4.5 place-items-center rounded-full px-1 text-micro tabular-nums">{items.length}</span>}
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

export function CategoryChip({ c }: { c: Item["category"] }) {
  const { label, icon: Icon } = CATEGORY[c];
  return (
    <span className="bg-muted text-foreground/80 inline-flex h-5.5 items-center gap-1 rounded-md px-1.5 text-micro font-medium whitespace-nowrap">
      <Icon className="size-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

const COLS = "grid grid-cols-[5.75rem_minmax(0,1fr)_6.5rem_1.75rem] items-center gap-x-3";

function Table({ items, now, still, actions, onOpen, onLeave }: { items: Item[]; now: number; still: boolean; actions: Actions; onOpen: (id: string) => void; onLeave: () => void }) {
  return (
    <div role="table" aria-label="Scheduled items" className="border-t">
      <div role="row" className={cn(COLS, "text-faint px-4 py-1.5 text-micro font-medium tracking-wide uppercase")}>
        <span role="columnheader">Type</span>
        <span role="columnheader">What</span>
        <span role="columnheader" className="text-right">
          Next
        </span>
        <span role="columnheader" className="sr-only">
          Options
        </span>
      </div>
      <div role="rowgroup" className="max-h-[min(22rem,55vh)] overflow-y-auto pb-1.5">
        {items.map((it, i) => (
          <motion.div
            key={it.id}
            role="row"
            tabIndex={0}
            initial={still ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: still ? 0 : 0.05 + i * 0.03, ease: EASE }}
            onClick={() => onOpen(it.id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onOpen(it.id))}
            className={cn(
              COLS,
              "group hover:bg-muted/60 focus-visible:bg-muted/60 relative mx-1.5 cursor-pointer rounded-lg px-2.5 py-2 outline-none transition-colors",
              !it.enabled && it.relation !== "proposed" && "opacity-60"
            )}
          >
            <span role="cell">
              <CategoryChip c={it.category} />
            </span>
            <span role="cell" className="min-w-0">
              <span className="text-foreground block truncate text-meta leading-snug font-medium">{it.name}</span>
              <span className="text-muted-foreground block truncate text-micro leading-snug">{blurb(it)}</span>
            </span>
            <span role="cell" className="text-right text-micro tabular-nums">
              {it.relation === "proposed" ? (
                <span className="text-attention-text ring-attention/40 inline-flex rounded-full px-2 py-0.5 font-medium ring-1 ring-inset">Pending</span>
              ) : it.status === "done" || it.status === "failed" || it.status === "running" || it.status === "cancelled" ? (
                <span className={cn(it.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{STATUS_LABEL[it.status]}</span>
              ) : it.nextFire !== null ? (
                <span className="text-foreground font-medium">{fmtNext(it.nextFire, now)}</span>
              ) : (
                <span className="text-muted-foreground">{it.enabled ? "after its trigger" : "Paused"}</span>
              )}
            </span>
            <span role="cell" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <RowMenu it={it} actions={actions} onOpen={() => onOpen(it.id)} onLeave={onLeave} />
            </span>
          </motion.div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t px-4 py-2">
        <span className="text-faint text-micro">Click a row for details</span>
        <button type="button" onClick={() => (onLeave(), actions.openAutopilot())} className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-micro font-medium">
          Open Autopilot
          <ArrowUpRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function RowMenu({ it, actions, onOpen, onLeave }: { it: Item; actions: Actions; onOpen: () => void; onLeave: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Options for ${it.name}`}
          disabled={actions.busy === it.id}
          className="text-muted-foreground hover:bg-background hover:text-foreground data-[state=open]:bg-background focus-visible:ring-live/50 grid size-7 cursor-pointer place-items-center rounded-md opacity-70 outline-none group-hover:opacity-100 focus-visible:ring-2 disabled:opacity-40"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {it.relation === "proposed" ? (
          <>
            <DropdownMenuItem onSelect={() => void actions.approve(it)}>
              <Check /> Approve
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.dismiss(it)} destructive>
              <X /> Dismiss
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => void actions.runNow(it)}>
              <Play /> Run now
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.setOn(it, !it.enabled)}>
              {it.enabled ? <Pause /> : <Play />} {it.enabled ? "Pause" : "Resume"}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpen}>
          <ChevronRight /> View details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => (onLeave(), actions.openAutopilot(it))}>
          <ArrowUpRight /> Edit in Autopilot
        </DropdownMenuItem>
        {it.relation === "created" && (
          <DropdownMenuItem onSelect={() => void actions.remove(it)} destructive>
            <Trash2 /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Detail({ it, now, actions, onBack, onLeave }: { it: Item; now: number; actions: Actions; onBack: () => void; onLeave: () => void }) {
  const busy = actions.busy === it.id;
  const btn =
    "focus-visible:ring-live/50 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-micro font-medium outline-none transition-[background-color,scale] active:scale-[0.97] focus-visible:ring-2 disabled:opacity-50 [&_svg]:size-3.5";
  const rows: [string, React.ReactNode][] = [
    ["Schedule", <>{it.when}{it.cron && <code className="text-muted-foreground bg-muted ml-2 rounded px-1.5 py-0.5 font-mono text-[11px]">{it.cron}</code>}</>],
    ["Next run", it.relation === "proposed" ? "After you approve" : it.at && it.nextFire === null ? `Once — ${STATUS_LABEL[it.status] ?? it.status}` : it.nextFire !== null ? fmtNext(it.nextFire, now) : it.enabled ? "When its trigger finishes" : "Paused"],
    [
      "Last run",
      it.lastFired ? (
        <>
          {fmtAgo(it.lastFired, now)}
          {it.lastOutcome && <span className="text-muted-foreground"> · {it.lastOutcome}</span>}
          {it.lastBox && (
            <button type="button" onClick={() => (onLeave(), actions.openBox(it.lastBox!))} className="text-foreground ml-2 inline-flex cursor-pointer items-center gap-0.5 underline-offset-2 hover:underline">
              Open thread <ArrowUpRight className="size-3" />
            </button>
          )}
        </>
      ) : (
        <span className="text-muted-foreground">Not yet</span>
      ),
    ],
    ...(it.repos?.length ? ([[it.repos.length > 1 ? "Repositories" : "Repository", <span className="font-mono text-[12px]">{it.repos.join(", ")}</span>]] as [string, React.ReactNode][]) : []),
    ["Origin", ORIGIN[it.relation]],
  ];
  return (
    <div className="border-t">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <button type="button" onClick={onBack} className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 cursor-pointer items-center gap-1 rounded-full pr-2.5 pl-1.5 text-micro font-medium">
          <ArrowLeft className="size-3.5" />
          All scheduled
        </button>
      </div>
      <div className="max-h-[min(26rem,60vh)] overflow-y-auto px-4 pt-2 pb-3">
        <div className="flex items-start gap-2">
          <h3 className="text-foreground min-w-0 flex-1 text-body leading-snug font-semibold">{it.name}</h3>
          <CategoryChip c={it.category} />
        </div>
        {it.why && (
          <p className="border-attention/30 text-foreground mt-2.5 rounded-lg border px-3 py-2 text-micro leading-snug">
            <span className="font-semibold">Approval required.</span> {it.why}.
          </p>
        )}
        <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-micro">
          {rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-faint">{k}</dt>
              <dd className="text-foreground min-w-0 tabular-nums">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="text-faint mt-3.5 mb-1 text-micro font-medium tracking-wide uppercase">What it will do</p>
        <p className="bg-muted/60 text-foreground/90 rounded-lg px-3 py-2.5 text-micro leading-relaxed whitespace-pre-wrap">{it.task}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2.5">
        {it.relation === "proposed" ? (
          <>
            <button type="button" disabled={busy} className={cn(btn, "bg-foreground text-background hover:bg-foreground/90")} onClick={() => void actions.approve(it)}>
              <Check /> Approve
            </button>
            <button type="button" disabled={busy} className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={() => void actions.dismiss(it).then(onBack)}>
              Dismiss
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} className={cn(btn, "bg-foreground text-background hover:bg-foreground/90")} onClick={() => void actions.runNow(it)}>
              <Play /> Run now
            </button>
            <button type="button" disabled={busy} className={cn(btn, "bg-muted text-foreground hover:bg-muted/70")} onClick={() => void actions.setOn(it, !it.enabled)}>
              {it.enabled ? <Pause /> : <Play />} {it.enabled ? "Pause" : "Resume"}
            </button>
          </>
        )}
        <button type="button" className={cn(btn, "text-muted-foreground hover:bg-muted hover:text-foreground ml-auto")} onClick={() => (onLeave(), actions.openAutopilot(it))}>
          Edit in Autopilot <ArrowUpRight />
        </button>
      </div>
    </div>
  );
}
