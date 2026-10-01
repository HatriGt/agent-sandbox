import { ArrowLeft, GitBranch } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useLaunchMorph } from "@/lib/launchMorph";
import { Button } from "@/components/ui/button";
import { bootingHeadline, bootingStage } from "@/lib/booting";
import { friendlyName } from "@/lib/format";
import { WorkingIndicator, YouItem } from "./TraceItems";
import { cn } from "@/lib/utils";

/**
 * The thread shown from the instant a task is delegated until its machine surfaces in the fleet.
 *
 * Staged so the wait visibly progresses instead of repeating one line:
 *   1. assigning — the delegate request is in flight (no machine yet);
 *   2. connecting — the machine is known (named in the pill and the indicator); the real Thread
 *      takes over on the next fleet tick.
 * The layout (task bubble, then a working pill in the same spot) deliberately matches the fresh
 * Thread's launch placeholder, so the swap to the real thread is a content change, not a scene change.
 *
 * `warm` keeps the copy honest: a warm claim reuses a pre-booted box (no microVM boot); a cold boot
 * is a genuine fresh microVM. `inferred` are repos attached because the task named them — shown
 * here, in place, instead of a toast floating over an unrelated corner of the app.
 */
export function BootingThread({
  task,
  warm,
  machine,
  inferred,
  onBack,
}: {
  task: string;
  warm: boolean;
  machine?: string;
  inferred?: string[];
  onBack: () => void;
}) {
  const stage = bootingStage(machine);
  const name = machine ? friendlyName(machine) : undefined;
  const reduce = useReducedMotion();
  const morph = useLaunchMorph<HTMLDivElement>(reduce);
  // Skeleton staggers in under the morphing Task bubble: pill, title, then the working steps.
  const rise = (i: number) =>
    reduce
      ? {}
      : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.22, delay: 0.06 + i * 0.05, ease: [0.22, 1, 0.36, 1] as const } };
  return (
    // Fades in (and, under AnimatePresence, out) so the hand-off to the real Thread — which fades in
    // over the same layout — reads as one continuous view.
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex h-14 items-center gap-2 border-b px-3 md:px-5">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="md:hidden">
          <ArrowLeft />
        </Button>
        <motion.span {...rise(0)} className="bg-live/10 text-live ring-live/20 inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset">
          <span className="bg-live breathe size-2 rounded-full" aria-hidden />
          {stage}
        </motion.span>
        <motion.p {...rise(1)} className="text-muted-foreground min-w-0 truncate text-meta">
          {name ? <>Machine <span className="text-foreground font-medium">{name}</span> is picking up your task…</> : "Finding a machine for your task…"}
        </motion.p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 pt-7 pb-16 md:px-6">
          <div ref={morph} className="will-change-transform">
            <YouItem text={task} label="Task" noEnter />
          </div>
          {inferred && inferred.length > 0 && <AttachedFromTask repos={inferred} />}
          <motion.div {...rise(2)} className="flex flex-col gap-2">
            <WorkingIndicator label={bootingHeadline(warm, name)} />
            <p className="text-muted-foreground text-meta">
              Its live output will appear here the moment it starts working.
            </p>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Repositories attached because the task named them — an inline lifecycle row, rendered right where
 * the reader is already looking (under the task), not a toast. Shared by the booting pane and the
 * fresh Thread so the note survives the pane swap without moving.
 */
export function AttachedFromTask({ repos, className }: { repos: string[]; className?: string }) {
  return (
    <div className={cn("enter flex items-center gap-3 py-0.5", className)}>
      <span className="label text-muted-foreground inline-flex shrink-0 items-center gap-1.5">
        <GitBranch className="size-3" aria-hidden />
        Attached from the task
      </span>
      <span className="text-faint min-w-0 truncate text-micro" title={repos.join(", ")}>
        {repos.join(" · ")}
      </span>
      <span className="bg-border h-px flex-1" aria-hidden />
    </div>
  );
}
