import * as React from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { api, type BoxView, type WatchSnapshot } from "@/lib/api";
import { POLL_MS, roleLabel, shortName } from "@/lib/format";
import { parseTrace } from "@/lib/trace";
import { usePoll } from "@/hooks/usePoll";
import { Button } from "@/components/ui/button";
import { StateStamp } from "@/components/ui/stamp";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { AskingItem, LifecycleItem, ObserverItem, SayItem, ToolItem, YouItem } from "./TraceItems";
import { SendBar } from "./SendBar";

/** A co-pilot exchange, owned by the parent so it survives switching threads. */
export interface Aside {
  question: string;
  answer?: string;
  error?: string;
}

/**
 * One machine's thread: vitals strip, the trace, the send bar.
 *
 * Scroll behaviour is delegated to the registry's MessageScroller — anchoring to the newest turn,
 * yielding when the reader scrolls up, and offering a way back. That logic is genuinely fiddly and
 * had been hand-written twice here before the components existed.
 */
export function Thread({
  box,
  asides,
  replies,
  onAsk,
  onReplied,
  onBack,
  onNew,
  onTornDown,
}: {
  box: BoxView;
  asides: Aside[];
  replies: string[];
  onAsk: (question: string) => void;
  onReplied: (text: string) => void;
  onBack: () => void;
  onNew: () => void;
  onTornDown: (name: string) => void;
}) {
  const { data: snap } = usePoll<WatchSnapshot>((signal) => api.watch(box.name, signal), POLL_MS, [box.name]);

  const events = React.useMemo(() => parseTrace(snap?.log ?? ""), [snap?.log]);
  const runState = snap?.runState ?? box.runState;
  const question = snap?.question ?? box.question;

  const [armed, setArmed] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  React.useEffect(() => setArmed(false), [box.name]);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const destroy = async () => {
    if (!armed) return setArmed(true);
    setRemoving(true);
    try {
      await api.teardown(box.name);
      onTornDown(box.name);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2.5 md:px-6">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="md:hidden">
          <ArrowLeft />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <StateStamp state={runState} exitCode={snap?.exitCode ?? box.exitCode} />
            <span className="text-ash min-w-0 truncate font-mono text-[12px]">
              <span className="md:hidden">{shortName(box.name)}</span>
              <span className="hidden md:inline">{box.name}</span>
            </span>
          </div>
          <p className="text-ash tabular mt-0.5 flex flex-wrap gap-x-3 font-mono text-[12px]">
            {box.uptime && <span>up {box.uptime}</span>}
            {box.cpu && <span>cpu {box.cpu}</span>}
            {box.mem && <span>mem {box.mem}</span>}
            <span className="opacity-70">{roleLabel(box.role)}</span>
          </p>
        </div>

        <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New task" className="md:hidden">
          <Plus />
        </Button>
        <Button variant="danger" size="sm" onClick={destroy} disabled={removing}>
          <Trash2 className="size-3.5" />
          <span className="hidden sm:inline">{removing ? "destroying" : armed ? "confirm?" : "destroy"}</span>
        </Button>
      </header>

      <MessageScrollerProvider>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="px-4 py-8 md:px-6">
            <MessageScrollerContent className="mx-auto max-w-3xl gap-7">
              {box.task && <YouItem text={box.task} label="task" />}

              {events.map((e, i) =>
                e.kind === "lifecycle" ? (
                  <LifecycleItem key={i} label={e.label} detail={e.detail} />
                ) : e.kind === "tool" ? (
                  <ToolItem key={i} event={e} />
                ) : (
                  <SayItem key={i} text={e.text} live={runState === "running" && i === events.length - 1} />
                )
              )}

              {!events.length && (
                <LifecycleItem
                  label={runState === "idle" ? "machine idle" : "booting"}
                  detail={runState === "idle" ? "no run yet" : "waiting for first output"}
                />
              )}

              {question && runState === "waiting" && <AskingItem question={question} />}

              {/* What you sent back. The agent log does not echo it, so without this your own
                  message would vanish the moment it was delivered. */}
              {replies.map((r, i) => (
                <YouItem key={`reply-${i}`} text={r} label="your answer" />
              ))}

              {asides.map((a, i) => (
                <ObserverItem key={`aside-${i}`} question={a.question} answer={a.error ?? a.answer} />
              ))}

              {runState === "done" && (
                <LifecycleItem label="exited" detail={`code ${snap?.exitCode ?? box.exitCode ?? "?"}`} />
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <SendBar boxName={box.name} runState={runState} onAsk={onAsk} onReplied={onReplied} />
    </div>
  );
}
