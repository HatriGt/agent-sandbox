import { Clock } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { StableBox } from "@/hooks/useStableBoxes";
import { prefetchWatch } from "@/hooks/useWatchStream";
import { friendlyName, roleLabel, shortName, threadSort, threadTitle } from "@/lib/format";
import { displayState } from "@/lib/lifecycle";
import { questionHeadline } from "@/lib/question";
import { StateStamp } from "@/components/ui/stamp";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * The machines, ordered for triage: anything halted on a question first, then working, finished,
 * sleeping, idle. Rows animate into their new position when a state flips (a machine that just
 * paused rises to the top instead of teleporting), and hovering a row prefetches its thread so the
 * click lands on a warm cache.
 */
export function MachineList({
  boxes,
  pending,
  selected,
  loading,
  onSelect,
}: {
  boxes: StableBox[];
  pending: { id: string; task: string }[];
  selected: string | null;
  loading: boolean;
  onSelect: (name: string) => void;
}) {
  const sorted = [...boxes].sort(threadSort);

  return (
    <nav aria-label="Machines" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {loading && (
        <div className="space-y-1 px-1 py-1" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2.5 rounded-lg px-2 py-2.5">
              <div className="flex justify-between">
                <Bar className="h-2.5 w-16" />
                <Bar className="h-2.5 w-10" />
              </div>
              <Bar className="h-3 w-full" />
              <Bar className="h-3 w-2/3" />
              <Bar className="h-2.5 w-24" />
            </div>
          ))}
        </div>
      )}

      {!loading && !sorted.length && !pending.length && (
        <p className="text-muted-foreground px-3 py-5 text-meta leading-relaxed">
          Nothing is up. Start a task and a machine boots in seconds; idle machines stop themselves.
        </p>
      )}

      <ul className="flex flex-col gap-px">
        {pending.map((p) => (
          <li key={p.id} className="enter rounded-lg px-3 py-2.5" aria-busy="true">
            <p className="label text-live flex items-center gap-1.5">
              <span className="bg-live breathe size-2 rounded-full" aria-hidden />
              booting
            </p>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-meta leading-snug">{p.task}</p>
          </li>
        ))}

        <AnimatePresence initial={false}>
          {sorted.map((v) => {
            const active = selected === v.name;
            const waiting = v.runState === "waiting";
            const state = displayState(v);
            return (
              <motion.li
                key={v.name}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: v.leaving ? 0.5 : 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.8 }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(v.name)}
                  onMouseEnter={() => prefetchWatch(v.name)}
                  onFocus={() => prefetchWatch(v.name)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "group w-full cursor-pointer rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
                    active ? "bg-accent" : "hover:bg-muted"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <StateStamp state={state} exitCode={v.exitCode} />
                    <span className="label text-muted-foreground ml-auto truncate">
                      {v.leaving ? "shutting down" : state === "sleeping" ? "wakes on reply" : roleLabel(v.role)}
                    </span>
                  </div>

                  <p
                    className={cn(
                      "mt-1 line-clamp-2 text-meta leading-snug",
                      waiting ? "text-foreground font-medium" : "text-foreground"
                    )}
                  >
                    {waiting && v.question ? questionHeadline(v.question) : threadTitle(v)}
                  </p>

                  <div className="text-muted-foreground mt-1 flex items-center gap-2 text-micro">
                    <span className="stamp truncate" title={shortName(v.name)}>
                      {friendlyName(v.name)}
                    </span>
                    {v.uptime && (
                      <span className="stamp ml-auto inline-flex shrink-0 items-center gap-1" title={state === "sleeping" ? "ran for" : "uptime"}>
                        <Clock className="size-2.5" aria-hidden />
                        {v.uptime}
                      </span>
                    )}
                  </div>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </nav>
  );
}
