import * as React from "react";
import { AlertTriangle, Check, ChevronRight, Circle, CircleDot, Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { shortDuration, shortPath, type DerivedTask, type TaskBoard, type TaskEvidence } from "@/lib/planTasks";
import { FileMark } from "@/lib/fileIcon";
import { cn } from "@/lib/utils";

/**
 * The agent's plan (TodoWrite) joined to the work it actually did — the thread's spine.
 *
 * Two presentations of ONE board. On wide screens it is a docked aside (`PlanDock`) pinned beside the
 * conversation, because the plan is the answer to "where is this run up to" and a card that scrolls
 * away with the transcript cannot answer it. Below `xl` there is no room for a second column, so the
 * same board renders in flow (`PlanCard`) where it always did.
 *
 * The dock is a SIBLING of the conversation+composer column, not an overlay: the whole column narrows
 * together, so the composer stays aligned with the text it belongs to (the constraint that killed the
 * old right-hand PR column) and nothing is ever covered.
 *
 * Evidence per step comes from `deriveTaskBoard` — see `lib/planTasks.ts` for the attribution rule.
 */

/** `2 files · 9s` — the facts that fit on the row, in the same voice as the Worked line. */
function evidenceSummary(e: TaskEvidence): string {
  const parts: string[] = [];
  if (e.files.length) parts.push(`${e.files.length} file${e.files.length > 1 ? "s" : ""}`);
  else if (e.commands.length) parts.push(`${e.commands.length} command${e.commands.length > 1 ? "s" : ""}`);
  else if (e.steps) parts.push(`${e.steps} step${e.steps > 1 ? "s" : ""}`);
  if (e.ms !== undefined) parts.push(shortDuration(e.ms));
  return parts.join(" · ");
}

const SPRING = { type: "spring", stiffness: 460, damping: 34 } as const;
const EASE = [0.22, 1, 0.36, 1] as const;

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
    return (
      <motion.span
        initial={reduce ? false : { scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={SPRING}
        title={failed ? "Done, but a call in this step returned an error" : undefined}
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-md",
          failed ? "bg-destructive/15 text-destructive" : "bg-ok/20 text-ok"
        )}
      >
        <Check className="size-3" strokeWidth={3} aria-hidden />
      </motion.span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative grid size-5 shrink-0 place-items-center">
        {/* A halo behind the live marker, so the eye lands on the step in progress first. */}
        {live && !reduce && (
          <motion.span
            className="bg-live/20 absolute inset-0 rounded-md"
            animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <span className="bg-live/10 text-live relative grid size-5 place-items-center rounded-md">
          <CircleDot className={cn("size-3", live && "breathe")} strokeWidth={2.5} aria-hidden />
        </span>
      </span>
    );
  }
  return (
    <span className="text-faint grid size-5 shrink-0 place-items-center rounded-md border">
      <Circle className="size-2" aria-hidden />
    </span>
  );
}

/** Determinate progress, and the card's structural divider in one 2px line. */
function ProgressRail({ done, total, complete, failed, layoutId }: { done: number; total: number; complete: boolean; failed?: boolean; layoutId?: string }) {
  const pct = total ? (done / total) * 100 : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${done} of ${total} steps done`}
      className="bg-border relative h-0.5 w-full shrink-0 overflow-hidden"
    >
      <motion.div
        layoutId={layoutId}
        className={cn("absolute inset-y-0 left-0", complete ? (failed ? "bg-destructive" : "bg-ok") : "bg-live")}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: EASE }}
      />
    </div>
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

function TaskRow({ task, live, compact }: { task: DerivedTask; live?: boolean; compact?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const reduce = useReducedMotion();
  const e = task.evidence;
  const hasDetail = e.files.length > 0 || e.commands.length > 0 || e.steps > 0;
  const active = task.state === "active";
  const summary = evidenceSummary(e);

  const body = (
    <>
      <StepMark state={task.state} live={live} failed={e.failed} />
      <span className="min-w-0 flex-1">
        <span className="relative inline-block max-w-full align-bottom">
          <span
            className={cn(
              "block truncate text-body",
              active ? "text-foreground font-medium" : task.state === "done" ? "text-muted-foreground" : "text-foreground"
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
        {active && live && e.latest && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-live block truncate text-micro">
            {e.latest.name}
            {e.latest.arg ? <span className="stamp ml-1.5">{shortPath(e.latest.arg)}</span> : null}
          </motion.span>
        )}
      </span>
      {/* Only where there is no tick to carry it — on a done row the mark itself is already red. */}
      {e.failed && task.state !== "done" && (
        <AlertTriangle className="text-destructive size-3.5 shrink-0" aria-label="a call in this step failed" />
      )}
      {summary && <span className={cn("text-faint stamp shrink-0 text-micro", compact ? "hidden" : "hidden sm:block")}>{summary}</span>}
      {hasDetail && (
        <ChevronRight className={cn("text-faint size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden />
      )}
    </>
  );

  return (
    // Bouncy-accordion row (after skiper-ui's Skiper103): each step is its OWN raised card — real
    // border, card ground, gap to its neighbours — and expanding is a weighted spring: the open row
    // lifts (shadow + slight scale), its siblings shuffle down on layout springs. The active step
    // carries the live tint on its border, not just a wash.
    <motion.li
      layout={reduce ? undefined : true}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 28 }}
      whileHover={hasDetail && !reduce && !open ? { scale: 1.012 } : undefined}
      className={cn(
        "overflow-hidden rounded-xl border transition-[box-shadow,border-color,background-color] duration-200",
        active && live
          ? "border-live/40 bg-live/6 shadow-[0_0_0_3px_color-mix(in_oklch,var(--live)_8%,transparent)]"
          : open
            ? "border-line-strong bg-card shadow-e2"
            : "bg-card/60 hover:bg-card hover:shadow-e1 border-transparent",
        task.state === "done" && !open && "opacity-85"
      )}
    >
      {hasDetail ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 px-3 py-2.5">{body}</div>
      )}

      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.18, ease: EASE } }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 26, mass: 0.9 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 px-3 pb-3 pl-11">
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
  if (complete) return <>{failed ? "Complete, not clean" : "Plan complete"}</>;
  return <>{live ? "Working the plan" : "Plan"}</>;
}

function BoardIcon({ complete, live, failed }: { complete: boolean; live?: boolean; failed?: boolean }) {
  const reduce = useReducedMotion();
  if (complete)
    return (
      <motion.span
        initial={reduce ? false : { scale: 0.4, rotate: -18, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={SPRING}
        className="shrink-0"
      >
        <Check className={cn("size-4", failed ? "text-destructive" : "text-ok")} strokeWidth={2.5} aria-hidden />
      </motion.span>
    );
  return <Loader2 className={cn("text-live size-4 shrink-0", live && "animate-spin")} aria-hidden />;
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

/** In-flow board, for screens with no room for the dock. */
export function PlanCard({ board, live }: { board: TaskBoard; live?: boolean }) {
  const [open, setOpen] = React.useState(true);
  const { tasks, done, complete } = board;
  const failed = tasks.filter((t) => t.evidence.failed).length;
  const sweep = useCompletionSweep(complete);
  return (
    <div className="enter bg-card relative max-w-[72ch] overflow-hidden rounded-xl border shadow-e1">
      <Sweep on={sweep} failed={failed > 0} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <BoardIcon complete={complete} live={live} failed={failed > 0} />
        <span className="text-foreground flex-1 truncate text-body font-medium">
          <BoardHeadline complete={complete} live={live} failed={failed > 0} />
        </span>
        <span className="text-muted-foreground stamp flex shrink-0 items-baseline text-micro">
          <RollingCount value={done} /> of {tasks.length}
          {board.ms !== undefined ? ` · ${shortDuration(board.ms)}` : ""}
        </span>
        <ChevronRight className={cn("text-faint size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden />
      </button>

      <ProgressRail done={done} total={tasks.length} complete={complete} failed={failed > 0} />

      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="bg-muted/40 flex flex-col gap-1.5 border-t p-2">
              {tasks.map((t, i) => (
                <TaskRow key={`${i}-${t.text}`} task={t} live={live} />
              ))}
            </div>
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

const DOCK_KEY = "asb-plan-dock";

/**
 * The docked board: pinned beside the conversation so the plan never scrolls away. Collapses to a slim
 * rail that still carries the fraction and a pip per step, so even collapsed it answers "how far in".
 */
export function PlanDock({ board, live }: { board: TaskBoard; live?: boolean }) {
  const [open, setOpen] = React.useState(() => sessionStorage.getItem(DOCK_KEY) !== "0");
  const reduce = useReducedMotion();
  const { tasks, done, complete } = board;
  const failed = tasks.filter((t) => t.evidence.failed).length;
  const sweep = useCompletionSweep(complete);
  const toggle = () =>
    setOpen((v) => {
      sessionStorage.setItem(DOCK_KEY, v ? "0" : "1");
      return !v;
    });

  return (
    // The aside is a SIBLING in the thread's flex row, so the conversation column narrows rather than
    // being covered — but it only reserves a gutter. The board itself is a self-sized card centred in
    // that gutter (`items-center`), not a floor-to-ceiling panel.
    <motion.aside
      aria-label="Plan"
      initial={false}
      animate={{ width: open ? "22.5rem" : "3.25rem" }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 36 }}
      className="hidden shrink-0 items-center py-4 pr-4 pl-1 xl:flex"
    >
      <motion.div
        layout={!reduce}
        transition={reduce ? { duration: 0 } : SPRING}
        className={cn(
          "bg-card relative flex max-h-[70vh] w-full flex-col overflow-hidden rounded-xl border shadow-e4",
          !open && "items-center"
        )}
      >
        <Sweep on={sweep} failed={failed > 0} />

        {open ? (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 px-3">
              <BoardIcon complete={complete} live={live} failed={failed > 0} />
              <span className="text-foreground min-w-0 flex-1 truncate text-meta font-semibold">
                <BoardHeadline complete={complete} live={live} failed={failed > 0} />
              </span>
              <span className="text-muted-foreground stamp flex shrink-0 items-baseline text-micro">
                <RollingCount value={done} />/{tasks.length}
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
            <ProgressRail done={done} total={tasks.length} complete={complete} failed={failed > 0} layoutId="plan-rail" />
            <ol className="bg-muted/40 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
              {tasks.map((t, i) => (
                <TaskRow key={`${i}-${t.text}`} task={t} live={live} compact />
              ))}
            </ol>
            {(board.ms !== undefined || failed > 0) && (
              <div className="shrink-0 border-t px-3 py-2 text-micro">
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
            <span className="text-muted-foreground stamp mt-0.5 text-micro">
              {done}/{tasks.length}
            </span>
            <span className="flex flex-col items-center gap-1 pt-0.5">
              {tasks.map((t, i) => (
                <motion.span
                  key={`${i}-${t.text}`}
                  initial={reduce ? false : { scaleY: 0, opacity: 0 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.24, ease: EASE }}
                  title={t.text}
                  className={cn(
                    "h-3 w-1.5 shrink-0 rounded-full",
                    t.state === "done"
                      ? t.evidence.failed
                        ? "bg-destructive"
                        : "bg-ok"
                      : t.state === "active"
                        ? cn("bg-live", live && "breathe")
                        : "bg-border"
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
