import { useRef, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Swap } from "@/components/ui/swap";
import type { StableBox } from "@/hooks/useStableBoxes";
import { prefetchWatch } from "@/hooks/useWatchStream";
import { friendlyName, roleLabel, threadSort, threadTitle } from "@/lib/format";
import { displayState, fmtDuration, type DisplayState } from "@/lib/lifecycle";
import { questionHeadline } from "@/lib/question";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/** Orbit's spring: a slight overshoot that settles, cubic-bezier(.3,1.2,.5,1). */
const SPRING = { type: "spring", stiffness: 420, damping: 30, mass: 0.8 } as const;
const EASE = [0.2, 0.8, 0.2, 1] as const;

// One braille spinner clock shared by every running row: a single 80ms interval, started while at
// least one spinner is mounted.
const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
let frame = 0;
let timer: number | undefined;
const listeners = new Set<() => void>();
function subscribeSpinner(fn: () => void) {
  listeners.add(fn);
  timer ??= window.setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    listeners.forEach((l) => l());
  }, 80);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}
const noop = () => () => {};
function Spinner({ still }: { still: boolean }) {
  const i = useSyncExternalStore(still ? noop : subscribeSpinner, () => frame);
  return (
    <span className="text-live inline-block w-[1ch] font-mono" aria-hidden>
      {FRAMES[still ? 0 : i]}
    </span>
  );
}

type Word = { word: string; tone: "live" | "attention" | "faint" | "destructive" | "muted" | "ok" };
/** The shared live-state vocabulary. */
function stateWord(state: DisplayState, exitCode?: number): Word {
  switch (state) {
    case "running":
      return { word: "Working", tone: "live" };
    case "waiting":
      return { word: "Needs you", tone: "attention" };
    case "sleeping":
      return { word: "Asleep", tone: "faint" };
    case "done":
      return exitCode != null && exitCode !== 0 ? { word: "Failed", tone: "destructive" } : { word: "Done", tone: "ok" };
    default:
      return { word: "Idle", tone: "muted" };
  }
}

const TONE_TEXT: Record<Word["tone"], string> = {
  live: "text-live",
  attention: "text-attention-text",
  faint: "text-faint",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
  ok: "text-muted-foreground",
};
const TONE_TILE: Record<Word["tone"], string> = {
  live: "bg-live/15 text-live",
  attention: "bg-attention/15 text-attention-text",
  faint: "bg-muted text-faint",
  destructive: "bg-destructive/15 text-destructive",
  muted: "bg-muted text-muted-foreground",
  ok: "bg-ok/15 text-ok",
};

function initialOf(v: StableBox): string {
  const src = v.agent || v.harness?.name || threadTitle(v) || v.name;
  return (src.trim()[0] ?? "?").toUpperCase();
}

function tooltipOf(v: StableBox, state: DisplayState, sleepTtlSec?: number): string {
  const lines = [threadTitle(v), friendlyName(v.name)];
  if (state === "waiting" && v.question) lines.push(`Asks: ${questionHeadline(v.question)}`);
  if (v.stalled) lines.push("No output for a while");
  if (v.leaving) lines.push("Shutting down");
  else if (v.kept) lines.push("Kept");
  else if (state === "sleeping") lines.push(sleepTtlSec && v.asleepSec != null ? `Gone in ${fmtDuration(Math.max(0, sleepTtlSec - v.asleepSec))}` : "Wakes on reply");
  if (v.role === "pool-free") lines.push(roleLabel(v.role));
  if (v.uptime) lines.push(`${state === "sleeping" ? "Ran for" : "Uptime"} ${v.uptime}`);
  return lines.join("\n");
}

/** Bumps a counter each time `state` changes after mount: keys the one-shot row flash. */
function useChangeCount(state: string): number {
  const ref = useRef({ state, n: 0 });
  if (ref.current.state !== state) ref.current = { state, n: ref.current.n + 1 };
  return ref.current.n;
}

function AgentRow({
  v,
  active,
  still,
  sleepTtlSec,
  onSelect,
}: {
  v: StableBox;
  active: boolean;
  still: boolean;
  sleepTtlSec?: number;
  onSelect: (name: string) => void;
}) {
  const state = displayState(v);
  const { word, tone } = stateWord(state, v.exitCode);
  const flashes = useChangeCount(`${state}:${word}`);
  return (
    <button
      type="button"
      onClick={() => onSelect(v.name)}
      onMouseEnter={() => prefetchWatch(v.name)}
      onFocus={() => prefetchWatch(v.name)}
      aria-current={active ? "true" : undefined}
      title={tooltipOf(v, state, sleepTtlSec)}
      className={cn(
        "group relative flex h-8 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 text-left text-meta transition-colors duration-150",
        active ? "bg-accent text-foreground" : "hover:bg-muted text-foreground/90",
        v.leaving && "opacity-60"
      )}
    >
      {flashes > 0 && !still && (
        <span key={flashes} className="pointer-events-none absolute inset-0 rounded-md" style={{ animation: "dt-row-flash 1.6s ease-out both" }} aria-hidden />
      )}
      <span className={cn("relative grid size-5 shrink-0 place-items-center rounded-[5px] text-[11px] font-semibold transition-colors duration-200", TONE_TILE[tone])} aria-hidden>
        {initialOf(v)}
      </span>
      <span className={cn("relative min-w-0 flex-1 truncate", state === "waiting" && "font-medium")}>{threadTitle(v)}</span>
      <span className="relative ml-1 flex shrink-0 items-center gap-1.5 text-micro">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={word}
            className={cn("inline-flex items-center gap-1.5", TONE_TEXT[tone])}
            initial={still ? { opacity: 0 } : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={{ duration: still ? 0 : 0.18, ease: EASE }}
          >
            {state === "running" && <Spinner still={still} />}
            {state === "waiting" && <span className="bg-attention dt-ping text-attention size-1.5 rounded-full" aria-hidden />}
            <span className={cn(state === "running" && "shimmer-text")}>{word}</span>
          </motion.span>
        </AnimatePresence>
      </span>
    </button>
  );
}

/**
 * The live agents list, ordered for triage (needs you, working, finished, asleep, idle). Rows spring
 * into their new position when a state flips and flash once; hovering prefetches the thread.
 */
export function MachineList({
  boxes,
  pending,
  selected,
  sleepTtlSec,
  loading,
  offline = false,
  onSelect,
}: {
  boxes: StableBox[];
  pending: { id: string; task: string }[];
  selected: string | null;
  loading: boolean;
  /** The fleet can't be read and nothing was ever received: an empty list is unknown, not "nothing". */
  offline?: boolean;
  onSelect: (name: string) => void;
  /** How long a non-kept sleeping sandbox lives before it is destroyed. */
  sleepTtlSec?: number;
}) {
  const sorted = [...boxes].sort(threadSort);
  const still = useReducedMotion();
  const empty = !loading && !sorted.length && !pending.length;
  const online = boxes.filter((v) => {
    const s = displayState(v);
    return s === "running" || s === "waiting";
  }).length;

  return (
    <nav aria-label="Machines" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center justify-between px-4 text-micro">
        <span className="text-muted-foreground font-medium">Machines</span>
        {!loading && !(empty && offline) && (
          <span className="text-faint tabular-nums" aria-live="polite">
            {online} online
          </span>
        )}
      </div>
      <div className="scroll-fade-y min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Swap state={loading ? "loading" : empty ? (offline ? "offline" : "empty") : "list"}>
          {empty && offline ? (
            // The connection notice above already says what happened; a "Nothing running" here would
            // be a claim about machines we cannot see.
            <p className="text-faint px-2 py-3 text-micro leading-relaxed">Machines reappear here when the connection returns.</p>
          ) : loading ? (
            <div className="space-y-px py-px" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-8 items-center gap-2 px-2">
                  <Bar className="size-5 rounded-[5px]" />
                  <Bar className="h-2.5 flex-1" />
                  <Bar className="h-2.5 w-10" />
                </div>
              ))}
            </div>
          ) : empty ? (
            <div className="px-2 py-3">
              <p className="text-foreground text-meta font-medium">Nothing running</p>
              <p className="text-muted-foreground mt-1 text-micro leading-relaxed">
                Start a task and its machine appears here. Machines that go quiet sleep on their own.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-px">
              <AnimatePresence initial={false}>
                {pending.map((p) => (
                  <motion.li
                    key={p.id}
                    layout
                    initial={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    transition={still ? { duration: 0 } : SPRING}
                    className="flex h-8 items-center gap-2 rounded-md px-2 text-meta"
                    title={p.task}
                    aria-busy="true"
                  >
                    <span className="bg-live/15 text-live breathe grid size-5 shrink-0 place-items-center rounded-[5px] text-[11px] font-semibold" aria-hidden>
                      {(p.task.trim()[0] ?? "?").toUpperCase()}
                    </span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">{p.task}</span>
                    <span className="text-live shimmer-text shrink-0 text-micro">Booting</span>
                  </motion.li>
                ))}
                {sorted.map((v) => (
                  <motion.li
                    key={v.name}
                    layout
                    initial={still ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: v.leaving ? 0.5 : 1, y: 0, scale: 1 }}
                    // A destroyed machine dissolves (drift + collapse) rather than snapping out.
                    exit={{ opacity: 0, filter: still ? "none" : "blur(4px)", x: still ? 0 : 12, height: 0, transition: { duration: still ? 0 : 0.3, ease: [0.4, 0, 1, 1] } }}
                    transition={still ? { duration: 0 } : SPRING}
                  >
                    <AgentRow v={v} active={selected === v.name} still={still} sleepTtlSec={sleepTtlSec} onSelect={onSelect} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Swap>
      </div>
    </nav>
  );
}
