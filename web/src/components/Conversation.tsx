import * as React from "react";
import { ArrowDown, ArrowLeft, Trash2 } from "lucide-react";
import { api, type BoxView, type WatchSnapshot } from "@/lib/api";
import { POLL_MS, roleLabel, shortName } from "@/lib/format";
import { parseTrace } from "@/lib/trace";
import { usePoll } from "@/hooks/usePoll";
import { Button } from "@/components/ui/button";
import { StateStamp } from "@/components/ui/stamp";
import { LifecycleEntry, ObserverEntry, SayEntry, ToolEntry, YouEntry } from "@/components/trace/TraceEntry";
import { SendBar } from "@/components/SendBar";

/** A co-pilot exchange, held in the parent so it survives switching threads. */
export interface Aside {
  question: string;
  answer?: string;
  error?: string;
}

/**
 * One machine's thread: vitals strip, the trace, and the send bar.
 *
 * The trace is assembled from three sources into a single chronology: the task you gave it (first
 * entry), the agent's own log parsed into speech and tool calls, and the question it is blocked on
 * (last). Co-pilot exchanges are appended as margin notes — same thread, unmistakably another voice.
 */
export function Conversation({
  box,
  asides,
  onAsk,
  onBack,
  onTornDown,
}: {
  box: BoxView;
  asides: Aside[];
  onAsk: (question: string) => void;
  onBack: () => void;
  onTornDown: (name: string) => void;
}) {
  const { data: snap } = usePoll<WatchSnapshot>((signal) => api.watch(box.name, signal), POLL_MS, [box.name]);

  const scroller = React.useRef<HTMLDivElement>(null);
  const pinned = React.useRef(true);
  const [detached, setDetached] = React.useState(false);

  const events = React.useMemo(() => parseTrace(snap?.log ?? ""), [snap?.log]);
  const runState = snap?.runState ?? box.runState;
  const question = snap?.question ?? box.question;

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    setDetached(!pinned.current);
  };

  // Follow the tail only while the reader is already at the bottom.
  React.useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [events.length, asides.length, question]);

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    pinned.current = true;
    setDetached(false);
  };

  const [armed, setArmed] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  React.useEffect(() => setArmed(false), [box.name]);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const teardown = async () => {
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
    <div className="flex h-full min-h-0 flex-col">
      {/* ── vitals strip: proof there is a real machine behind this ── */}
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-2.5 md:px-6">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to threads" className="md:hidden">
          <ArrowLeft />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <StateStamp state={runState} exitCode={snap?.exitCode ?? box.exitCode} />
            <span className="text-ink-faint font-mono text-[11.5px]">
              <span className="md:hidden">{shortName(box.name)}</span>
              <span className="hidden md:inline">{box.name}</span>
            </span>
          </div>
          <p className="text-ink-faint tabular mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px]">
            {box.uptime && <span>up {box.uptime}</span>}
            {box.cpu && <span>cpu {box.cpu}</span>}
            {box.mem && <span>mem {box.mem}</span>}
            <span className="opacity-70">{roleLabel(box.role)}</span>
          </p>
        </div>

        <Button variant="danger" size="sm" onClick={teardown} disabled={removing}>
          <Trash2 className="size-3.5" />
          {removing ? "destroying" : armed ? "confirm?" : "destroy"}
        </Button>
      </header>

      {/* ── the trace ── */}
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-6 md:px-8">
          <div className="mx-auto max-w-3xl">
            {box.task && <YouEntry text={box.task} stampLabel="task" />}

            {events.map((e, i) =>
              e.kind === "lifecycle" ? (
                <LifecycleEntry key={i} label={e.label} detail={e.detail} />
              ) : e.kind === "tool" ? (
                <ToolEntry key={i} event={e} />
              ) : (
                <SayEntry key={i} text={e.text} live={runState === "running" && i === events.length - 1} />
              )
            )}

            {!events.length && (
              <LifecycleEntry
                label={runState === "idle" ? "machine idle" : "booting"}
                detail={runState === "idle" ? "no run yet" : "waiting for first output"}
              />
            )}

            {question && runState === "waiting" && (
              <div className="border-signal/40 bg-signal-wash mt-1 rounded-md border p-4">
                <p className="stamp text-signal pb-1.5">the agent is asking</p>
                <p className="text-ink max-w-[68ch] whitespace-pre-wrap text-[15px] leading-[1.6]">{question}</p>
                <p className="text-ink-faint mt-2 text-[12.5px]">
                  It has halted and cannot continue until you answer below.
                </p>
              </div>
            )}

            {asides.map((a, i) => (
              <ObserverEntry key={`aside-${i}`} question={a.question} answer={a.error ?? a.answer} />
            ))}

            {runState === "done" && (
              <LifecycleEntry label="exited" detail={`code ${snap?.exitCode ?? box.exitCode ?? "?"}`} />
            )}
          </div>
        </div>

        {detached && (
          <Button
            variant="outline"
            size="sm"
            onClick={toBottom}
            className="bg-surface absolute bottom-4 left-1/2 -translate-x-1/2 shadow-[0_4px_16px_-6px_rgba(0,0,0,.6)]"
          >
            <ArrowDown className="size-3.5" /> Latest
          </Button>
        )}
      </div>

      <SendBar boxName={box.name} runState={runState} onAsk={onAsk} />
    </div>
  );
}
