import * as React from "react";
import { AlertTriangle, Check, ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { describeChanges, shortDuration, shortPath, type DerivedTask, type PlanChanges, type TaskBoard, type TaskEvidence } from "@/lib/planTasks";
import { FileMark } from "@/lib/fileIcon";
import { Collapse } from "@/components/ui/collapse";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useNow";
import "@/styles/plan.css";

/**
 * The agent's plan (TodoWrite) joined to the work it actually did — the thread's spine.
 *
 * ONE board (`PlanBoard`) with two placements (`variant`): docked beside the conversation when the
 * row has room, because the plan is the answer to "where is this run up to" and a card that scrolls
 * away with the transcript cannot answer it; a card in the flow otherwise. Thread.tsx makes that
 * one decision (`useMediaQuery` + which asides are open) and renders the board exactly once.
 *
 * Evidence per step comes from `deriveTaskBoard` — see `lib/planTasks.ts` for the attribution rule.
 */

/** `2 files` — the evidence that fits on the row; the step's duration has its own right-aligned slot. */
function evidenceSummary(e: TaskEvidence): string {
  if (e.files.length) return `${e.files.length} file${e.files.length > 1 ? "s" : ""}`;
  if (e.commands.length) return `${e.commands.length} command${e.commands.length > 1 ? "s" : ""}`;
  if (e.steps) return `${e.steps} step${e.steps > 1 ? "s" : ""}`;
  return "";
}

/**
 * The step's measured time: closed windows summed from the plan snapshots' stamps, plus the open
 * window ticking live while the step is in progress. A row with no stamps shows nothing — the time
 * is observed, never estimated.
 */
function StepDuration({ ms, since, live }: { ms?: number; since?: number; live: boolean }) {
  const ticking = live && since !== undefined;
  const now = useNow(ticking);
  const total = (ms ?? 0) + (ticking ? Math.max(0, now - since) : 0);
  if (total < 1000) return null;
  return (
    <span className={cn("stamp shrink-0 tabular-nums", ticking ? "text-live" : "text-faint")} title={ticking ? "In progress for" : "Took"}>
      {shortDuration(total)}
    </span>
  );
}

const SPRING = { type: "spring", stiffness: 460, damping: 34 } as const;
/** Orbit's ease. */
const EASE = [0.2, 0.8, 0.2, 1] as const;
/** The ease rows collapse out on — a quick start, a long settle, no overshoot. */
const EXIT_EASE = [0.22, 1, 0.36, 1] as const;
/** How long the "Plan changed" note stays, and how fresh a stamped revision must be to count as "just now". */
const NOTE_MS = 8000;
/** Fold finished steps above the active one only on long plans, and only a run worth folding. */
const FOLD_MIN_STEPS = 6;
const FOLD_MIN_RUN = 4;
const BRAILLE = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

/**
 * A revision counts as "just happened" when it landed after this board mounted, or its stamp is
 * within the note's window. A thread opened minutes after a rewrite must not wash every row it shows
 * or announce a change the reader never saw the before of.
 */
function useFreshRevision(board: TaskBoard): boolean {
  const mountRev = React.useRef(board.revisions);
  const arrived = board.revisions > mountRev.current;
  const stamped = board.changes?.at !== undefined && Date.now() - board.changes.at < NOTE_MS;
  return !!board.changes && (arrived || stamped);
}

/** The step texts that arrived with the last revision — new steps and the new wording of reworded ones. */
function arrivals(changes: PlanChanges | undefined): Set<string> {
  const s = new Set<string>();
  if (!changes) return s;
  for (const t of changes.added) s.add(t);
  for (const r of changes.reworded) s.add(r.to);
  return s;
}

/**
 * The inclusive index range of finished steps to fold away above the active one — the current work
 * stays on screen instead of scrolling under a column of ticks. Null when there is nothing to fold.
 */
function foldRange(tasks: DerivedTask[]): [number, number] | null {
  if (tasks.length <= FOLD_MIN_STEPS) return null;
  const active = tasks.findIndex((t) => t.state === "active");
  if (active < 0) return null;
  let start = active;
  while (start > 0 && tasks[start - 1].state === "done") start -= 1;
  return active - start >= FOLD_MIN_RUN ? [start, active - 1] : null;
}

/**
 * One quiet line under the header saying what the last rewrite did, in plain words. Stays ~8s, or
 * until the next revision replaces it. Under reduced motion it appears and disappears without a fade.
 */
function ChangeNote({ board, className }: { board: TaskBoard; className?: string }) {
  const reduce = useReducedMotion();
  const fresh = useFreshRevision(board);
  const { changes, revisions } = board;
  // Keyed on the revision, not the (re-derived on every log line) changes object, so a growing log
  // during the 8s does not keep resetting the timer.
  const latest = React.useRef(changes);
  latest.current = changes;
  const [shown, setShown] = React.useState<{ rev: number; text: string } | null>(null);
  React.useEffect(() => {
    const c = latest.current;
    if (!fresh || !c) {
      setShown(null);
      return;
    }
    setShown({ rev: revisions, text: describeChanges(c) });
    const t = window.setTimeout(() => setShown(null), NOTE_MS);
    return () => window.clearTimeout(t);
  }, [fresh, revisions]);
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          key={shown.rev}
          initial={reduce ? { opacity: 1, height: "auto" } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={reduce ? { opacity: 0, height: "auto", transition: { duration: 0 } } : { opacity: 0, height: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.26, ease: EXIT_EASE }}
          className={cn("overflow-hidden", className)}
          role="status"
        >
          <div className="text-faint truncate text-micro" title={shown.text}>
            Plan changed <span className="text-border mx-1">·</span> {shown.text}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** `4 steps done` — the folded run of finished steps above the active one; click to unfold them. */
function FoldedRow({ n, failed, compact, onOpen }: { n: number; failed: boolean; compact?: boolean; onOpen: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      layout={reduce ? undefined : "position"}
      initial={reduce ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.26, ease: EXIT_EASE }}
      className="hover:bg-muted/40 overflow-hidden rounded-md transition-colors duration-200"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={false}
        title="Show these steps"
        className="flex min-h-7 w-full cursor-pointer items-center gap-2.5 px-2 py-1 text-left"
      >
        <span className={cn("grid size-4 shrink-0 place-items-center", failed ? "text-destructive" : "text-ok")} aria-hidden>
          <Check className="size-3.5" strokeWidth={2.25} />
        </span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-meta">{n} steps done</span>
        {!compact && <span className="text-faint hidden text-micro sm:block">show</span>}
        <ChevronRight className="text-faint size-3.5 shrink-0" aria-hidden />
      </button>
    </motion.li>
  );
}

/**
 * The rows, shared by the card and the dock. Keys are the step TEXT (never the index) so a rewrite
 * that inserts a step above another moves rows instead of re-labelling them: added rows enter with a
 * wash, removed rows collapse out, and a long run of ticks above the active step folds into one row.
 */
function StepList({ board, live, compact, className }: { board: TaskBoard; live?: boolean; compact?: boolean; className?: string }) {
  const { tasks } = board;
  const fresh = useFreshRevision(board);
  const arrived = React.useMemo(() => (fresh ? arrivals(board.changes) : new Set<string>()), [fresh, board.changes]);
  const [unfolded, setUnfolded] = React.useState(false);
  const range = foldRange(tasks);
  const fold = range && !unfolded ? range : null;
  // The fold re-arms itself once the active step moves on: an unfold is a look, not a setting.
  const activeText = tasks.find((t) => t.state === "active")?.text;
  React.useEffect(() => setUnfolded(false), [activeText]);

  const rows: React.ReactNode[] = [];
  tasks.forEach((t, i) => {
    if (fold && i >= fold[0] && i <= fold[1]) {
      if (i === fold[0]) {
        const run = tasks.slice(fold[0], fold[1] + 1);
        rows.push(<FoldedRow key="__fold" n={run.length} failed={run.some((s) => s.evidence.failed)} compact={compact} onOpen={() => setUnfolded(true)} />);
      }
      return;
    }
    rows.push(<TaskRow key={t.text} task={t} live={live} since={t.state === "active" ? board.activeSince : undefined} compact={compact} arrived={arrived.has(t.text)} />);
  });
  return (
    <ol className={className}>
      <AnimatePresence initial={false}>{rows}</AnimatePresence>
    </ol>
  );
}

/** The active step's braille spinner; a still frame under reduced motion or when the run is not live. */
function Braille({ spin }: { spin: boolean }) {
  const now = useNow(spin, 80);
  return <span className="font-mono leading-none">{BRAILLE[Math.floor(now / 80) % BRAILLE.length]}</span>;
}

/**
 * The step marker. A completed step STAMPS in — the one place a spring is louder than a fade.
 *
 * A done step that contained a failed call is NOT drawn as a clean success: a green tick beside a red
 * warning is two signals contradicting each other. The glyph stays a check, because the step really is
 * done — the agent marked it so, and it may well have failed once and then retried — but the palette
 * says "not cleanly", and the words that go with it stay precise.
 */
function StepMark({ state, live, failed }: { state: DerivedTask["state"]; live?: boolean; failed?: boolean }) {
  const reduce = useReducedMotion();
  if (state === "done") {
    // The check DRAWS in (path length), so a step completing is a stroke, not a swap.
    return (
      <span
        title={failed ? "Done, but a call in this step returned an error" : undefined}
        className={cn("grid size-4 shrink-0 place-items-center", failed ? "text-destructive" : "text-ok")}
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path d="M3.5 8.5l3 3 6-7" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.32, ease: EASE }} />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="text-live grid size-4 shrink-0 place-items-center text-meta" aria-label="in progress">
        <Braille spin={!!live && !reduce} />
      </span>
    );
  }
  return (
    <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
      <span className="border-line-strong size-2.5 rounded-full border" />
    </span>
  );
}

/** One thin segment per step: filled when done, shimmering while active, empty otherwise. */
function ProgressRail({ tasks, live, layoutId }: { tasks: DerivedTask[]; live?: boolean; layoutId?: string }) {
  const reduce = useReducedMotion();
  const done = tasks.filter((t) => t.state === "done").length;
  return (
    <motion.div
      layoutId={layoutId}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={tasks.length}
      aria-valuenow={done}
      aria-label={`${done} of ${tasks.length} steps done`}
      className="flex h-1 w-full shrink-0 gap-0.5"
    >
      {tasks.map((t, i) => (
        <span key={t.text} className="bg-border relative h-full flex-1 overflow-hidden rounded-full">
          <motion.span
            className={cn("absolute inset-y-0 left-0 rounded-full", t.state === "done" ? (t.evidence.failed ? "bg-destructive" : "bg-live") : "bg-live/45")}
            // The active segment sweeps (dt-shim's keyframes, in the live hue); reduced motion keeps it still.
            style={t.state === "active" && live && !reduce ? { backgroundImage: "linear-gradient(90deg, transparent 30%, color-mix(in oklab, var(--live) 70%, white) 50%, transparent 70%)", backgroundSize: "300% 100%", animation: "dt-shim 1.4s linear infinite" } : undefined}
            initial={false}
            animate={{ width: t.state === "done" ? "100%" : t.state === "active" ? "100%" : "0%", opacity: t.state === "todo" ? 0 : 1 }}
            transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE, delay: Math.min(i * 0.03, 0.2) }}
          />
        </span>
      ))}
    </motion.div>
  );
}

/** `PLAN  2 of 5` — the Orbit section label with a rolling count. */
function PlanLabel({ done, total }: { done: number; total: number }) {
  return (
    <span className="text-muted-foreground flex shrink-0 items-baseline gap-2 text-micro">
      <span className="label font-semibold tracking-wider uppercase">Plan</span>
      <span className="stamp">
        <RollingCount value={done} /> of {total}
      </span>
    </span>
  );
}

/** The count, rolling when it changes, so a step completing is visible even if you were looking away. */
function RollingCount({ value }: { value: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <span className="tabular-nums">{value}</span>;
  return (
    <span className="relative inline-grid overflow-hidden text-center align-bottom" style={{ minWidth: "1ch", height: "1.15em" }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: "0.9em", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-0.9em", opacity: 0 }}
          transition={SPRING}
          className="tabular-nums"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function TaskRow({ task, live, since, compact, arrived }: { task: DerivedTask; live?: boolean; since?: number; compact?: boolean; arrived?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const reduce = useReducedMotion();
  // Decided once, on mount: the wash is a one-shot CSS keyframe, and the class must not come and go
  // with later renders or it would replay.
  const [wash] = React.useState(() => !!arrived);
  const e = task.evidence;
  const hasDetail = e.files.length > 0 || e.commands.length > 0 || e.steps > 0;
  const active = task.state === "active";
  const summary = evidenceSummary(e);
  // The reason a failed step failed: the call that errored, else whatever it was doing last.
  const reason = e.failed ? (e.failedCall ?? e.latest) : undefined;
  const showLatest = active && live && e.latest && !(reason && reason.name === e.latest.name && reason.arg === e.latest.arg);

  const body = (
    <>
      <StepMark state={task.state} live={live} failed={e.failed} />
      <span className="min-w-0 flex-1">
        <span className="relative inline-block max-w-full align-bottom">
          <span
            className={cn(
              "block truncate text-meta",
              active ? cn("text-foreground font-medium", live && "shimmer-text") : task.state === "done" ? "text-muted-foreground" : "text-foreground/80"
            )}
          >
            {task.text}
          </span>
          {/* The strike is drawn, not a text-decoration, so it can sweep across as the step completes. */}
          {task.state === "done" && (
            <motion.span
              aria-hidden
              className="bg-border absolute inset-x-0 top-1/2 h-px origin-left"
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.35, ease: EASE }}
            />
          )}
        </span>
        {/* What this step is doing RIGHT NOW — the one thing a watcher actually wants mid-run. */}
        {showLatest && e.latest && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-live block truncate text-micro">
            {e.latest.name}
            {e.latest.arg ? <span className="stamp ml-1.5">{shortPath(e.latest.arg)}</span> : null}
          </motion.span>
        )}
        {/* A failed step keeps its reason in view — the command or tool that errored — not just a red mark. */}
        {reason && (
          <span className="text-destructive block truncate text-micro" title={reason.arg ? `${reason.name}: ${reason.arg}` : reason.name}>
            failed <span className="opacity-60">·</span> {reason.name}
            {reason.arg ? <span className="stamp ml-1.5">{shortPath(reason.arg)}</span> : null}
          </span>
        )}
      </span>
      {/* Only where there is no tick to carry it — on a done row the mark itself is already red. */}
      {e.failed && task.state !== "done" && (
        <AlertTriangle className="text-destructive size-3.5 shrink-0" aria-label="a call in this step failed" />
      )}
      {summary && <span className={cn("text-faint stamp shrink-0 tabular-nums", compact ? "hidden" : "hidden sm:block")}>{summary}</span>}
      <StepDuration ms={e.ms} since={since} live={!!(active && live)} />
      {hasDetail && (
        <ChevronRight className={cn("text-faint size-3.5 shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
      )}
    </>
  );

  return (
    // Bouncy-accordion row (after skiper-ui's Skiper103): each step is its OWN raised card — real
    // border, card ground, gap to its neighbours — and expanding is a weighted spring: the open row
    // lifts (shadow + slight scale), its siblings shuffle down on layout springs. The active step
    // carries the live tint on its border, not just a wash.
    <motion.li
      layout={reduce ? undefined : "position"}
      // A row added by a rewrite grows in; a removed one collapses out (height + opacity) — the
      // list's AnimatePresence has `initial={false}`, so the first paint never animates.
      initial={reduce ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.26, ease: EXIT_EASE }}
      className={cn(
        "overflow-hidden rounded-md transition-colors duration-200",
        active && live ? "bg-live/6" : open ? "bg-muted/60" : "hover:bg-muted/40",
        wash && "plan-row-new"
      )}
    >
      {hasDetail ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-7 w-full cursor-pointer items-center gap-2.5 px-2 py-1 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-h-7 w-full items-center gap-2.5 px-2 py-1">{body}</div>
      )}

      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: reduce ? 0 : 0.18, ease: EXIT_EASE } }}
            transition={reduce ? { duration: 0 } : { duration: 0.26, ease: EXIT_EASE }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 px-2 pb-2 pl-8">
              {compact && summary && <div className="text-faint stamp text-micro">{summary}</div>}
              {e.files.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {e.files.map((f, i) => (
                    <motion.span
                      key={f}
                      initial={reduce ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03, duration: 0.18, ease: EASE }}
                      className="bg-muted text-muted-foreground flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-micro"
                      title={f}
                    >
                      <FileMark path={f} className="size-3.5 shrink-0" />
                      <span className="stamp truncate">{shortPath(f)}</span>
                    </motion.span>
                  ))}
                </div>
              )}
              {e.commands.map((c) => (
                <div key={c} className="flex items-start gap-2 text-micro">
                  <span className="text-ok shrink-0 select-none">$</span>
                  <span className="stamp text-muted-foreground min-w-0 break-all">{c}</span>
                </div>
              ))}
              {/* Only what the chips above did NOT already say — a bare "1 tool call" next to the one
                  file it wrote is noise. Reads and searches get named, since a count cannot say what
                  the step spent its time on. */}
              {(e.others.length > 0 || e.failed) && (
                <div className="text-faint flex flex-wrap items-center gap-x-2 gap-y-1 text-micro">
                  {e.others.map((o, i) => (
                    <span key={o.name}>
                      {i > 0 && <span className="text-border mr-2">·</span>}
                      {o.name}
                      {o.n > 1 ? <span className="stamp"> ×{o.n}</span> : null}
                    </span>
                  ))}
                  {e.failed && <span className="text-destructive">a call failed</span>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function BoardHeadline({ complete, live, failed }: { complete: boolean; live?: boolean; failed?: boolean }) {
  // "Plan complete" is true even with a failure — every step is done — but on its own it reads as
  // "all well", which the footer then contradicts. Say both things in the one line.
  if (complete) return <>{failed ? "Complete, not clean" : "Complete"}</>;
  return <span className={cn(live && "shimmer-text")}>{live ? "Working" : "In progress"}</span>;
}

/**
 * The completion moment — one authored flourish, fired once when the last step ticks. A single sweep
 * of light crosses the board; it never repeats and never runs on mount for an already-finished run.
 */
function useCompletionSweep(complete: boolean): boolean {
  const [sweep, setSweep] = React.useState(false);
  const wasComplete = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (wasComplete.current === false && complete) {
      setSweep(true);
      const t = setTimeout(() => setSweep(false), 900);
      return () => clearTimeout(t);
    }
    wasComplete.current = complete;
  }, [complete]);
  return sweep;
}

function Sweep({ on, failed }: { on: boolean; failed?: boolean }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <AnimatePresence>
      {on && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.span
            className="absolute inset-y-0 w-1/3"
            style={{ background: `linear-gradient(90deg, transparent, var(${failed ? "--destructive" : "--ok"}), transparent)`, opacity: 0.14 }}
            initial={{ left: "-35%" }}
            animate={{ left: "105%" }}
            transition={{ duration: 0.85, ease: EASE }}
          />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

const DOCK_KEY = "asb-plan-dock";

export type PlanVariant = "card" | "dock";

/**
 * THE plan board. One component, two placements:
 *  - `card` — in the conversation's flow, where there is no room beside it (or another aside has
 *    the room). Folds under its header.
 *  - `dock` — an aside pinned beside the conversation so the plan never scrolls away; collapses to
 *    a slim rail that still carries the fraction and a pip per step. Remembered per session.
 * The dock is a SIBLING of the conversation+composer column, never an overlay: the column narrows
 * with it, so the composer stays aligned with the text and nothing is covered.
 */
export function PlanBoard({ board, live, variant = "card", className }: { board: TaskBoard; live?: boolean; variant?: PlanVariant; className?: string }) {
  const reduce = useReducedMotion();
  const { tasks, done, complete } = board;
  const failed = tasks.filter((t) => t.evidence.failed).length;
  const sweep = useCompletionSweep(complete);
  // Inline: folded/unfolded for this mount. Dock: remembered for the session.
  const [open, setOpen] = React.useState(() => (variant === "dock" ? sessionStorage.getItem(DOCK_KEY) !== "0" : true));
  const toggle = () =>
    setOpen((v) => {
      if (variant === "dock") sessionStorage.setItem(DOCK_KEY, v ? "0" : "1");
      return !v;
    });

  if (variant === "card") {
    return (
      <section aria-label="Plan" className={cn("enter relative overflow-hidden", className)}>
        <Sweep on={sweep} failed={failed > 0} />
        <button type="button" onClick={toggle} aria-expanded={open} className="flex h-7 w-full cursor-pointer items-center gap-2.5 text-left">
          <PlanLabel done={done} total={tasks.length} />
          <span className="text-faint min-w-0 flex-1 truncate text-micro">
            <BoardHeadline complete={complete} live={live} failed={failed > 0} />
            {board.ms !== undefined ? <span className="stamp"> · {shortDuration(board.ms)}</span> : null}
          </span>
          <ChevronRight className={cn("text-faint size-3.5 shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        </button>
        <ProgressRail tasks={tasks} live={live} />
        <ChangeNote board={board} className="mt-1.5" />
        <Collapse open={open}>
          <StepList board={board} live={live} className="mt-1.5 flex flex-col" />
        </Collapse>
      </section>
    );
  }

  return (
    // The aside only reserves a gutter; the board is a self-sized card centred in it, not a
    // floor-to-ceiling panel.
    <motion.aside
      aria-label="Plan"
      initial={false}
      animate={{ width: open ? "22.5rem" : "3.25rem" }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 36 }}
      className={cn("flex shrink-0 items-center py-4 pr-4 pl-1", className)}
    >
      <motion.div
        layout={!reduce}
        transition={reduce ? { duration: 0 } : SPRING}
        className={cn("bg-card relative flex max-h-[70vh] w-full flex-col overflow-hidden rounded-xl border", !open && "items-center")}
      >
        <Sweep on={sweep} failed={failed > 0} />

        {open ? (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 px-3">
              <PlanLabel done={done} total={tasks.length} />
              <span className="text-faint min-w-0 flex-1 truncate text-micro">
                <BoardHeadline complete={complete} live={live} failed={failed > 0} />
              </span>
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-label="Collapse the plan"
                title="Collapse the plan"
                className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 cursor-pointer place-items-center rounded-md transition-colors"
              >
                <PanelRightClose className="size-4" aria-hidden />
              </button>
            </div>
            <div className="px-3 pb-1">
              <ProgressRail tasks={tasks} live={live} layoutId="plan-rail" />
            </div>
            <ChangeNote board={board} className="px-3 pt-1" />
            <StepList board={board} live={live} compact className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5" />
            {(board.ms !== undefined || failed > 0) && (
              <div className="shrink-0 border-t px-3 py-2 text-micro tabular-nums">
                {board.ms !== undefined && <span className="text-faint stamp">{shortDuration(board.ms)} total</span>}
                {board.ms !== undefined && failed > 0 && <span className="text-border mx-1.5">·</span>}
                {failed > 0 && (
                  <span className="text-destructive">
                    {failed} step{failed === 1 ? "" : "s"} hit a failed call
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          // Collapsed: a slim pill, still centred, still content-height. One pip per step — done
          // fills, the active one breathes — so even at 52px it answers "how far in".
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={`Expand the plan · ${done} of ${tasks.length} steps done`}
            title={`Plan · ${done}/${tasks.length}`}
            className="flex w-full cursor-pointer flex-col items-center gap-1.5 px-2 py-3"
          >
            <PanelRightOpen className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="text-muted-foreground stamp mt-0.5 text-micro tabular-nums">
              {done}/{tasks.length}
            </span>
            <span className="flex flex-col items-center gap-1 pt-0.5">
              {tasks.map((t, i) => (
                <motion.span
                  key={t.text}
                  initial={reduce ? false : { scaleY: 0, opacity: 0 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.24, ease: EASE }}
                  title={t.text}
                  className={cn(
                    "h-3 w-1.5 shrink-0 rounded-full",
                    t.state === "done" ? (t.evidence.failed ? "bg-destructive" : "bg-ok") : t.state === "active" ? cn("bg-live", live && "breathe") : "bg-border"
                  )}
                />
              ))}
            </span>
          </button>
        )}
      </motion.div>
    </motion.aside>
  );
}
