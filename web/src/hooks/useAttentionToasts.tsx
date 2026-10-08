import * as React from "react";
import { toast } from "sonner";
import { CircleHelp, Hourglass, OctagonX, X } from "lucide-react";
import type { BoxView } from "@/lib/api";
import { friendlyName, isFailedExit, threadTitle } from "@/lib/format";
import { questionHeadline } from "@/lib/question";
import { QuestionChoices } from "@/components/QuestionChoices";
import { Button } from "@/components/ui/button";

/**
 * In-app attention cards (sonner) for the moments a machine needs a person while you are on another
 * page: it paused on a question (answerable right in the card), its output stalled, or its run
 * failed. One card per box (sonner id = box name), so a repeat state change replaces rather than
 * stacks. The box whose thread is open is skipped — the thread shows all of this itself — and its
 * card is dismissed the moment you land there. A question card also goes away when the box stops
 * waiting (answered from another tab, or the thread).
 *
 * Questions show on first load too: a waiting machine is a standing fact, not an event you missed.
 * Stalls and failures are transitions and only fire once this tab has seen the state flip.
 */
type Kind = "waiting" | "stalled" | "failed";

export function useAttentionToasts(boxes: BoxView[], openName: string | null, onOpen: (name: string) => void) {
  const prev = React.useRef<Map<string, { runState: string; stalled: boolean }> | null>(null);
  const shown = React.useRef(new Map<string, Kind>());

  React.useEffect(() => {
    const before = prev.current;
    const now = new Map(boxes.map((b) => [b.name, { runState: b.runState as string, stalled: !!b.stalled }]));
    const open = (name: string) => {
      toast.dismiss(name);
      shown.current.delete(name);
      onOpen(name);
    };
    for (const b of boxes) {
      if (b.name === openName) {
        if (shown.current.has(b.name)) (toast.dismiss(b.name), shown.current.delete(b.name));
        continue;
      }
      const was = before?.get(b.name);
      const kind: Kind | null =
        b.runState === "waiting" && (!was || was.runState !== "waiting")
          ? "waiting"
          : b.runState === "running" && b.stalled && was && !was.stalled
            ? "stalled"
            : b.runState === "done" && isFailedExit(b.exitCode) && was && was.runState !== "done"
              ? "failed"
              : null;
      if (kind) {
        shown.current.set(b.name, kind);
        toast.custom((tid) => <AttentionToast box={b} kind={kind} toastId={tid} onOpen={() => open(b.name)} />, {
          id: b.name,
          duration: kind === "waiting" ? Infinity : 12_000,
          className: "!w-[var(--width)]",
          onDismiss: () => shown.current.delete(b.name),
          onAutoClose: () => shown.current.delete(b.name),
        });
      } else if (shown.current.get(b.name) === "waiting" && b.runState !== "waiting") {
        toast.dismiss(b.name);
        shown.current.delete(b.name);
      }
    }
    // A box that vanished from the fleet takes its card with it.
    for (const name of [...shown.current.keys()]) if (!now.has(name)) (toast.dismiss(name), shown.current.delete(name));
    prev.current = now;
  }, [boxes, openName, onOpen]);
}

function AttentionToast({ box, kind, toastId, onOpen }: { box: BoxView; kind: Kind; toastId: string | number; onOpen: () => void }) {
  const who = friendlyName(box.name);
  const title = kind === "waiting" ? `${who} needs your answer` : kind === "stalled" ? `${who} has gone quiet` : `${who} failed`;
  const line =
    kind === "waiting"
      ? box.question
        ? questionHeadline(box.question)
        : threadTitle(box)
      : kind === "stalled"
        ? `No output for a while · ${threadTitle(box)}`
        : `Exited with code ${box.exitCode} · ${threadTitle(box)}`;
  const Icon = kind === "waiting" ? CircleHelp : kind === "stalled" ? Hourglass : OctagonX;
  return (
    <div role="group" aria-label={title} data-attention-toast={box.name} className="text-card-foreground flex w-full min-w-0 items-start gap-2.5 text-meta">
      <Icon className={kind === "failed" ? "text-destructive mt-0.5 size-4 shrink-0" : "text-attention-text mt-0.5 size-4 shrink-0"} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 line-clamp-2 break-words text-micro">{line}</p>
        {kind === "waiting" && box.question && <QuestionChoices box={box.name} question={box.question} className="mt-2" />}
        <div className="mt-2 flex items-center gap-1">
          <Button size="xs" variant={kind === "waiting" ? "outline" : "default"} onClick={onOpen}>
            Open
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(toastId)}
        aria-label="Dismiss"
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring -mt-1 -mr-1.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
