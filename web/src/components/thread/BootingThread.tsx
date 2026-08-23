import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { YouItem } from "./TraceItems";

/**
 * The thread shown from the instant a task is delegated until the assigned machine is known.
 *
 * `delegate` does not return a box id until the run reaches a boundary (a question or completion),
 * which can be a minute out — but the user asked for a machine and should be watching it come up,
 * not left on the Hub wondering if the click registered. So this stands in immediately: the task
 * they sent, echoed as their turn, and a booting rail. App swaps it for the real Thread the moment
 * the delegate resolves to a box.
 */
export function BootingThread({ task, onBack }: { task: string; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2.5 md:px-6">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="md:hidden">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="text-ash flex min-w-0 items-center gap-1.5 text-micro">
            <span className="hidden sm:inline">Agent</span>
            <span className="hidden sm:inline opacity-50" aria-hidden>
              /
            </span>
            <span className="text-ink min-w-0 truncate font-medium">Assigning a machine…</span>
          </div>
          <div className="tabular mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="stamp text-ash inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5">
              <span className="breathe">○</span> booting
            </span>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-16 md:px-6">
          <YouItem text={task} label="task" />

          <div className="flex items-start gap-3">
            <span
              className="bg-accent text-accent-foreground mt-0.5 grid size-7 shrink-0 place-items-center rounded-full"
              aria-hidden
            >
              <Loader2 className="size-3.5 animate-spin" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="stamp text-muted-foreground mb-1 block">agent</span>
              <div className="bg-card border-border text-muted-foreground elevate-sm rounded-2xl rounded-tl-sm border px-4 py-3 text-meta">
                Booting a fresh microVM and handing it your task. Its live output will appear here as soon as it starts
                working.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
