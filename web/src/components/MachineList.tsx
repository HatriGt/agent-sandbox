import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Swap } from "@/components/ui/swap";
import { StatusDot } from "@/components/ui/data-table";
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

export type StateWord = { word: string; tone: "live" | "attention" | "sleep" | "destructive" | "muted" | "ok" };
/** The shared live-state vocabulary: one word and one tone per state, for the sidebar and the Hub alike. */
export function stateWord(state: DisplayState, exitCode?: number, stalled?: boolean): StateWord {
  if (stalled && state === "running") return { word: "Stalled", tone: "destructive" };
  switch (state) {
    case "running":
      return { word: "Working", tone: "live" };
    case "waiting":
      return { word: "Needs you", tone: "attention" };
    case "sleeping":
      return { word: "Asleep", tone: "sleep" };
    case "done":
      return exitCode != null && exitCode !== 0 ? { word: "Failed", tone: "destructive" } : { word: "Done", tone: "ok" };
    default:
      return { word: "Idle", tone: "muted" };
  }
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
  const { word, tone } = stateWord(state, v.exitCode, v.stalled);
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
        "group relative flex h-9 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 text-left text-meta transition-colors duration-150",
        active ? "bg-accent text-foreground" : "hover:bg-muted text-foreground/90",
        v.leaving && "opacity-60"
      )}
    >
      {flashes > 0 && !still && (
        <span key={flashes} className="pointer-events-none absolute inset-0 rounded-md" style={{ animation: "dt-row-flash 1.6s ease-out both" }} aria-hidden />
      )}
      <span className={cn("relative min-w-0 flex-1 truncate", state === "waiting" && "font-medium")}>{threadTitle(v)}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={word}
          className="relative ml-1 shrink-0"
          initial={still ? { opacity: 0 } : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={still ? { opacity: 0 } : { opacity: 0, y: -3 }}
          transition={{ duration: still ? 0 : 0.18, ease: EASE }}
        >
          <StatusDot tone={tone} pulse={state === "running" && !v.stalled ? true : state === "waiting" ? "dot" : false} className="text-micro font-normal">
            {word}
          </StatusDot>
        </motion.span>
      </AnimatePresence>
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

  return (
    <nav aria-label="Machines" className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-fade-y min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Swap state={loading ? "loading" : empty ? (offline ? "offline" : "empty") : "list"}>
          {empty && offline ? (
            // The connection notice above already says what happened; a "Nothing running" here would
            // be a claim about machines we cannot see.
            <p className="text-faint px-2 py-3 text-micro leading-relaxed">Machines reappear here when the connection returns.</p>
          ) : loading ? (
            <div className="space-y-px py-px" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-9 items-center gap-2 px-2">
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
                    className="flex h-9 items-center gap-2 rounded-md px-2 text-meta"
                    title={p.task}
                    aria-busy="true"
                  >
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">{p.task}</span>
                    <StatusDot tone="live" pulse className="shrink-0 text-micro font-normal">
                      Booting
                    </StatusDot>
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
