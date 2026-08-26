import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bootingLabel } from "@/lib/booting";
import { WorkingIndicator, YouItem } from "./TraceItems";

/**
 * The thread shown from the instant a task is delegated until the assigned machine is known.
 *
 * `delegate` does not return a box id until the run reaches a boundary, which can be a minute out —
 * but the assigned box surfaces in monitor.json within a poll tick, and App attaches to its real
 * Thread the moment it does. So this only stands in for the brief window before the box id is known.
 *
 * `warm` keeps the copy honest for that window: a warm claim reuses a pre-booted box (no microVM
 * boot); a cold boot is a genuine fresh microVM.
 */
export function BootingThread({ task, warm, onBack }: { task: string; warm: boolean; onBack: () => void }) {
  const label = bootingLabel(warm);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex h-14 items-center gap-2 border-b px-3 md:px-5">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="md:hidden">
          <ArrowLeft />
        </Button>
        <span className="bg-live/12 text-live ring-live/25 inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset">
          <span className="bg-live breathe size-2 rounded-full" aria-hidden />
          assigning
        </span>
        <p className="text-muted-foreground min-w-0 truncate text-meta">Finding a machine for your task…</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 pt-8 pb-16 md:px-6">
          <YouItem text={task} label="Task" />
          <div className="flex flex-col gap-2">
            <WorkingIndicator label={label} />
            <p className="text-muted-foreground text-meta">
              Its live output will appear here the moment it starts working.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
