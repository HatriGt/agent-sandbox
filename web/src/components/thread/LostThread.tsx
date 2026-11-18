import * as React from "react";
import { ArchiveRestore, ArrowLeft, Check, RotateCw } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api, type RescueSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChatContainerContent, ChatContainerRoot } from "@/components/ui/chat-container";
import { useNow } from "@/hooks/useNow";
import { fmtAgo, friendlyName } from "@/lib/format";
import { YouItem } from "./TraceItems";
import { cn } from "@/lib/utils";

/**
 * A thread whose machine is gone — reaped, crashed, removed — but whose copy the controller kept
 * (src/rescue.ts). The page keeps the thread's URL and shape (the same shell as BootingThread: the
 * task bubble where it always is), says plainly what happened, and offers ONE action: bring the
 * machine back. The restore boots a fresh sandbox under the same name and puts the copy in; the
 * fleet then lists the box and App swaps this pane for the live Thread, transcript and all.
 */
const STAGES = [
  { at: 0, text: "finding a host" },
  { at: 6, text: "starting a machine" },
  { at: 14, text: "putting the copy back" },
  { at: 24, text: "almost there" },
];

function fmtSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(bytes >= 10 * 1048576 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function LostThread({ name, rescue, onBack }: { name: string; rescue: RescueSummary; onBack: () => void }) {
  const [restore, setRestore] = React.useState<{ startedAt: number; done: boolean; error: string | null } | null>(null);
  const now = useNow(!!restore && !restore.done && !restore.error, 500);
  const elapsed = restore ? Math.max(0, Math.floor((now - restore.startedAt) / 1000)) : 0;
  const stage = Math.min(STAGES.length - 1, STAGES.filter((s) => elapsed >= s.at).length - 1);
  const task = rescue.task ?? "";
  const firstLine = task.trim().split("\n")[0] ?? "";
  const title = rescue.title || (firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine) || friendlyName(name);
  const nothingKept = !!rescue.tooBig && !rescue.bytes;

  const bringBack = () => {
    setRestore({ startedAt: Date.now(), done: false, error: null });
    api
      .restoreThread(name)
      .then(() => {
        setRestore((r) => (r ? { ...r, done: true } : r));
        toast.success("The machine is back", { description: "Files, transcript and the agent's session were restored from the kept copy." });
      })
      .catch((e: unknown) => setRestore((r) => (r ? { ...r, error: e instanceof Error ? e.message : String(e) } : r)));
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-lost-thread>
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
        </div>
        <div className="text-muted-foreground mt-1 flex min-h-6 min-w-0 flex-nowrap items-center gap-x-2 text-meta">
          <span className="bg-foreground/6 text-muted-foreground inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold">
            <span className="bg-current size-2 rounded-full opacity-60" aria-hidden />
            Machine gone
          </span>
          <span className="text-faint" aria-hidden>
            ·
          </span>
          <span className="min-w-0 truncate" role="status">
            {friendlyName(name)} · a copy of the thread is kept
          </span>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 min-w-0 flex-1">
            <ChatContainerRoot className="relative h-full [&>div]:overflow-x-hidden" aria-label="Conversation">
              <ChatContainerContent className="mx-auto w-full max-w-3xl gap-5 px-4 pt-7 pb-12 md:px-6">
                {task && (
                  <div data-turn="task">
                    <YouItem text={task} label="Task" noEnter />
                  </div>
                )}
                <motion.section
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="surface px-5 py-4"
                  aria-labelledby="lost-title"
                >
                  <p id="lost-title" className="label text-muted-foreground flex items-center gap-1.5">
                    <span className="bg-muted-foreground/60 size-1.5 rounded-full" aria-hidden />
                    The machine behind this thread is gone
                  </p>
                  {nothingKept ? (
                    <p className="text-foreground mt-2 text-body">
                      Its last checkpoint was {fmtSize(rescue.tooBig ?? 0)}, over the copy limit, so nothing could be kept. The archived record of each turn is still in History.
                    </p>
                  ) : (
                    <>
                      <p className="text-foreground mt-2 text-body">
                        A copy taken after turn {rescue.turn} ({fmtAgo(Math.round(rescue.at / 1000))}, {fmtSize(rescue.bytes)}) is kept: the files in the workspace, the transcript, and the agent's memory of the
                        conversation. Bringing it back starts a fresh machine under the same name and puts all of that into it — your next message continues the same session.
                      </p>
                      <p className="text-muted-foreground mt-1.5 text-meta">
                        Installed dependencies are not in the copy; the agent reinstalls them when it needs them.
                        {rescue.tooBig ? ` A later checkpoint was ${fmtSize(rescue.tooBig)} and could not be kept, so the copy is of an earlier turn.` : ""}
                      </p>
                    </>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {!nothingKept && !restore && (
                      <Button size="sm" onClick={bringBack}>
                        <ArchiveRestore />
                        Bring it back
                      </Button>
                    )}
                    {restore && (
                      <div className="bg-card inline-flex max-w-full items-center gap-2.5 rounded-full border py-1.5 pr-3.5 pl-3 text-meta shadow-e1" role="status" aria-live="polite">
                        <span className={cn("flex shrink-0 items-center gap-1", restore.error ? "text-destructive" : "text-live")} aria-hidden>
                          {restore.done && !restore.error ? (
                            <Check className="size-3.5" strokeWidth={3} />
                          ) : (
                            <>
                              <span className={cn("bg-current size-1.5 rounded-full", !restore.error && "dot dot-1")} />
                              <span className={cn("bg-current size-1.5 rounded-full", !restore.error && "dot dot-2")} />
                              <span className={cn("bg-current size-1.5 rounded-full", !restore.error && "dot dot-3")} />
                            </>
                          )}
                        </span>
                        <span className={cn("shrink-0 font-medium", restore.error ? "text-destructive" : "text-foreground")}>
                          {restore.error ? "Could not bring it back" : restore.done ? "Back" : "Bringing it back"}
                        </span>
                        {!restore.error && (
                          <code className="text-muted-foreground bg-muted min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-micro">{restore.done ? "the transcript follows" : STAGES[stage].text}</code>
                        )}
                        {restore.error && <span className="text-muted-foreground min-w-0 truncate text-micro">{restore.error}</span>}
                        {!restore.done && !restore.error && (
                          <span className="text-faint shrink-0 text-micro tabular-nums" aria-hidden>
                            {elapsed}s
                          </span>
                        )}
                        {restore.error && (
                          <button type="button" onClick={bringBack} className="bg-live/10 text-live hover:bg-live/20 -mr-1 flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-micro font-semibold transition-colors">
                            <RotateCw className="size-3" aria-hidden />
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onBack}>
                      Back
                    </Button>
                  </div>
                </motion.section>
              </ChatContainerContent>
            </ChatContainerRoot>
          </div>
        </div>
      </div>
    </div>
  );
}
