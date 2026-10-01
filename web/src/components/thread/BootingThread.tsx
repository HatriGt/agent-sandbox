import { ArrowLeft, GitBranch, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatContainerContent, ChatContainerRoot } from "@/components/ui/chat-container";
import { bootingHeadline } from "@/lib/booting";
import { friendlyName } from "@/lib/format";
import { ThreadSkeleton } from "./Skeletons";
import { YouItem } from "./TraceItems";
import { cn } from "@/lib/utils";

/**
 * The thread shown from the instant a task is sent until its machine surfaces in the fleet.
 *
 * It is a STATIC copy of the live Thread's shell — same header geometry, same scroller, same
 * content column, the Task bubble in its final spot, a thread-shaped skeleton below and a
 * composer frame at the bottom. Nothing in it animates on mount: App swaps it for the real Thread
 * inside one pane key, and because every box lines up pixel for pixel, the swap is invisible —
 * only the skeleton is later replaced by real output (Thread keeps the same skeleton until the
 * first non-empty snapshot). See "Launch: one screen" in web/DESIGN.md before changing the layout.
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
  const name = machine ? friendlyName(machine) : undefined;
  const firstLine = task.trim().split("\n")[0] ?? "";
  const title = firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine || "New task";
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-launch-shell>
      <header className="border-border relative z-10 shrink-0 border-b px-3 py-2.5 md:px-5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="-ml-1 md:hidden">
            <ArrowLeft />
          </Button>
          <h1 className="flex min-w-0 flex-1 items-center">
            <span className="text-foreground block min-w-0 truncate text-h3 font-semibold tracking-[-0.01em]" title={title}>
              {title}
            </span>
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon-sm" disabled aria-label="More actions" className="text-muted-foreground">
              <MoreHorizontal />
            </Button>
          </div>
        </div>
        <div className="text-muted-foreground mt-1 flex min-h-6 min-w-0 flex-nowrap items-center gap-x-2 text-meta">
          <span className="bg-live/10 text-live ring-live/20 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold ring-1 ring-inset">
            <span className="bg-live breathe size-2 rounded-full" aria-hidden />
            Starting
          </span>
          <span className="text-faint" aria-hidden>
            ·
          </span>
          <span className="min-w-0 truncate" role="status">
            {bootingHeadline(warm, name)}
          </span>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 min-w-0 flex-1">
            <div aria-hidden className="thread-glow pointer-events-none absolute inset-0" />
            <ChatContainerRoot className="relative h-full [&>div]:overflow-x-hidden" aria-label="Conversation" aria-busy="true">
              <ChatContainerContent className="mx-auto w-full max-w-3xl gap-5 px-4 pt-7 pb-12 md:px-6">
                <div data-turn="task">
                  <YouItem text={task} label="Task" noEnter />
                </div>
                {inferred && inferred.length > 0 && <AttachedFromTask repos={inferred} />}
                <div className="flex min-w-0 flex-col gap-5">
                  <ThreadSkeleton withTask />
                </div>
              </ChatContainerContent>
            </ChatContainerRoot>
          </div>
          {/* The composer's frame, inert until the machine is listening (Thread's SendBar takes over). */}
          <div className="pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="relative mx-auto min-w-0 max-w-3xl px-3 md:px-6">
              <div className="bg-card raised border-border flex h-[6.3rem] items-start rounded-2xl border p-2" aria-disabled="true">
                <span className="text-faint px-2.5 pt-2 text-body">Starting up — you can type once the machine is ready…</span>
              </div>
              <p className="text-faint mt-1.5 px-2 text-micro">Your task is on its way to a machine.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Repositories attached because the task named them — an inline lifecycle row, rendered right where
 * the reader is already looking (under the task), not a toast. Shared by the booting pane and the
 * fresh Thread so the note survives the pane swap without moving.
 */
export function AttachedFromTask({ repos, className }: { repos: string[]; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 py-0.5", className)}>
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
