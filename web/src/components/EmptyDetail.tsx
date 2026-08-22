import { CircleDot, Eye, PauseCircle, Terminal } from "lucide-react";
import type { BoxView } from "@/lib/api";
import { shortName, stateLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The detail pane with nothing selected. On a wide screen this is over half the viewport, so it does
 * real work instead of centring an icon in a void: it answers "does anything need me?" — the
 * question the operator actually opened the page with — and teaches the two lanes, which is the one
 * concept in this product you cannot infer from the UI.
 */
export function EmptyDetail({ boxes, onSelect }: { boxes: BoxView[]; onSelect: (name: string) => void }) {
  const waiting = boxes.filter((b) => b.runState === "waiting");
  const running = boxes.filter((b) => b.runState === "running");
  // A finished run is still a box on the list, so "nothing running" alone read as wrong next to a
  // visible `done` card. Name what is actually there.
  const finished = boxes.filter((b) => b.runState === "done");

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center gap-7 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {waiting.length > 0
            ? `${waiting.length} sandbox${waiting.length > 1 ? "es" : ""} waiting on you`
            : running.length > 0
              ? `${running.length} agent${running.length > 1 ? "s" : ""} working`
              : finished.length > 0
                ? `${finished.length} run${finished.length > 1 ? "s" : ""} finished`
                : "Nothing running"}
        </h1>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          {waiting.length > 0
            ? "A run has paused to ask a question and cannot continue until it gets an answer."
            : running.length > 0
              ? "Pick a run to watch its log, or ask its co-pilot what it is doing."
              : finished.length > 0
                ? "Open a finished run to read its output, or start another from the composer."
                : "Describe a task in the composer to start a sandbox. Boxes stop themselves when idle."}
        </p>
      </div>

      {/* Anything blocked is actionable from here — the operator should never have to hunt for it. */}
      {waiting.length > 0 && (
        <ul className="space-y-2">
          {waiting.map((b) => (
            <li key={b.name}>
              <button
                type="button"
                onClick={() => onSelect(b.name)}
                className="border-attention/40 bg-attention/8 hover:bg-attention/12 focus-visible:ring-ring/50 flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-left outline-none transition-colors focus-visible:ring-[3px]"
              >
                <PauseCircle className="text-attention mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs font-semibold">{shortName(b.name)}</span>
                  {b.question && (
                    <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-relaxed">
                      {b.question}
                    </span>
                  )}
                </span>
                <span className="text-attention shrink-0 text-xs font-medium">Answer →</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {waiting.length === 0 && (running.length > 0 || finished.length > 0) && (
        <ul className="space-y-2">
          {[...running, ...finished].slice(0, 4).map((b) => (
            <li key={b.name}>
              <button
                type="button"
                onClick={() => onSelect(b.name)}
                className="hover:bg-secondary/60 focus-visible:ring-ring/50 flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-[3px]"
              >
                <CircleDot
                  className={cn(
                    "size-3.5 shrink-0",
                    b.runState === "running" ? "text-live animate-pulse" : "text-muted-foreground"
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs font-semibold">{shortName(b.name)}</span>
                  {b.task && (
                    <span className="text-muted-foreground mt-0.5 line-clamp-1 block text-xs">{b.task}</span>
                  )}
                </span>
                <span className="text-muted-foreground tabular shrink-0 text-[11px]">{stateLabel(b)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The lane distinction: the one thing a new operator gets wrong, stated once, where it lands. */}
      <dl className="grid gap-3 border-t pt-6 sm:grid-cols-2">
        <div className="flex gap-2.5">
          <Terminal className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <dt className="text-xs font-semibold">Answering steers the agent</dt>
            <dd className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              A paused run resumes with your answer. It is the only way to change what it does.
            </dd>
          </div>
        </div>
        <div className="flex gap-2.5">
          <Eye className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <dt className="text-xs font-semibold">Asking never interrupts it</dt>
            <dd className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              The co-pilot is a read-only observer in the same box. The agent keeps working and never
              sees the conversation.
            </dd>
          </div>
        </div>
      </dl>

      {boxes.length === 0 && (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => document.getElementById("new-task")?.focus()}
        >
          Describe a task
        </Button>
      )}
    </div>
  );
}
