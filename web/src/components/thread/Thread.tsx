import * as React from "react";
import { ArrowLeft, Clock, Cpu, MemoryStick, Plus, Trash2 } from "lucide-react";
import { api, type BoxView, type WatchSnapshot } from "@/lib/api";
import { POLL_MS, roleLabel, shortName, threadTitle } from "@/lib/format";
import { parseTrace } from "@/lib/trace";
import { usePoll } from "@/hooks/usePoll";
import { Button } from "@/components/ui/button";
import { StateStamp } from "@/components/ui/stamp";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import type { TraceEvent } from "@/lib/trace";
import { AskingItem, LifecycleItem, ObserverItem, SayItem, ToolGroup, YouItem } from "./TraceItems";
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
  // Fold consecutive tool calls into one cluster so the thread reads as prose punctuated by
  // "N tools used" pills (the reference pattern), instead of a wall of individual tool rows.
  const groups = React.useMemo(() => groupTrace(events), [events]);
  // A reply is echoed optimistically only until the resume path's ⟦you⟧ line reaches the polled log.
  // Once the trace carries a matching `you` event we drop the local echo, so the message shows once,
  // in order, and from the durable source (so a refresh keeps it).
  const pendingReplies = React.useMemo(() => {
    const persisted = new Set(events.filter((e) => e.kind === "you").map((e) => e.text.trim()));
    return replies.filter((r) => !persisted.has(r.trim()));
  }, [replies, events]);
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

  // One-click answer to a clarifying question: same path as the SendBar reply (optimistic echo +
  // resume), so the buttons in AskingItem release the halted run just like typing a reply does.
  const answer = React.useCallback(
    (text: string) => {
      onReplied(text);
      void api.resume(box.name, text);
    },
    [box.name, onReplied]
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2.5 md:px-6">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to machines" className="md:hidden">
          <ArrowLeft />
        </Button>

        <div className="min-w-0 flex-1">
          {/* Breadcrumb — the reference's "Agent / Rune / <task>" trail, mapped to our machine. */}
          <div className="text-ash flex min-w-0 items-center gap-1.5 text-micro">
            <span className="hidden sm:inline">Agent</span>
            <span className="hidden sm:inline opacity-50" aria-hidden>/</span>
            <span className="shrink-0 font-mono">{shortName(box.name)}</span>
            <span className="opacity-50" aria-hidden>/</span>
            <span className="text-ink min-w-0 truncate font-medium">{threadTitle(box)}</span>
          </div>
          <div className="tabular mt-1.5 flex flex-wrap items-center gap-1.5">
            <StateStamp state={runState} exitCode={snap?.exitCode ?? box.exitCode} />
            {box.uptime && <Vital icon={<Clock className="size-3" />} label="uptime" value={box.uptime} />}
            {box.cpu && <Vital icon={<Cpu className="size-3" />} label="cpu" value={box.cpu} />}
            {box.mem && <Vital icon={<MemoryStick className="size-3" />} label="memory" value={box.mem} />}
            <span className="stamp text-ash rounded-md border px-1.5 py-0.5">{roleLabel(box.role)}</span>
          </div>
        </div>

        <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New task" className="md:hidden">
          <Plus />
        </Button>
        <Button variant="danger" size="sm" onClick={destroy} disabled={removing}>
          <Trash2 className="size-3.5" />
          <span className="hidden sm:inline">{removing ? "destroying" : armed ? "confirm?" : "destroy"}</span>
        </Button>
      </header>

      {/* prompt-kit ChatContainer owns the stick-to-bottom behaviour: it anchors to the newest turn,
          yields when the reader scrolls up, and the ScrollButton offers a way back. */}
      <div className="relative min-h-0 flex-1">
        <ChatContainerRoot className="relative h-full">
          <ChatContainerContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-8 pb-16 md:px-6">
            {box.task && <YouItem text={box.task} label="task" />}

            {groups.map((g, i) =>
              g.kind === "lifecycle" ? (
                <LifecycleItem key={i} label={g.label} detail={g.detail} />
              ) : g.kind === "tools" ? (
                <ToolGroup key={i} events={g.events} />
              ) : g.kind === "you" ? (
                <YouItem key={i} text={g.text} label="you" />
              ) : (
                <SayItem key={i} text={g.text} live={runState === "running" && i === groups.length - 1} />
              )
            )}

            {!events.length && (
              <LifecycleItem
                label={runState === "idle" ? "machine idle" : "booting"}
                detail={runState === "idle" ? "no run yet" : "waiting for first output"}
              />
            )}

            {question && runState === "waiting" && <AskingItem question={question} onAnswer={answer} />}

            {/* Optimistic echo of a reply you JUST sent, shown only until the durable log catches up.
                The resume path stamps each follow-up into .agent.log as a ⟦you⟧ turn, which the trace
                renders inline above its response (correct order) and which survives a refresh — so a
                reply that already appears as a `you` event must not be echoed again here. */}
            {pendingReplies.map((r, i) => (
              <YouItem key={`reply-${i}`} text={r} label="you" />
            ))}

            {asides.map((a, i) => (
              <ObserverItem key={`aside-${i}`} question={a.question} answer={a.error ?? a.answer} />
            ))}

            {runState === "done" &&
              (() => {
                // A clean exit is just "completed" — no scary "code 0". A non-zero exit is a real
                // failure signal, so keep the code (StateStamp already reds it in the header).
                const code = snap?.exitCode ?? box.exitCode;
                return code == null || code === 0 ? (
                  <LifecycleItem label="completed" />
                ) : (
                  <LifecycleItem label="exited" detail={`code ${code}`} />
                );
              })()}
            <ChatContainerScrollAnchor />
          </ChatContainerContent>

          {/* ScrollButton consumes the StickToBottom context, so it must live INSIDE ChatContainerRoot.
              StickToBottom is itself the scroll element, so the button is `sticky` (not absolute) to
              pin to the viewport bottom instead of scrolling away with the content. */}
          <div className="pointer-events-none sticky inset-x-0 bottom-4 z-10 flex justify-center">
            <div className="pointer-events-auto">
              <ScrollButton />
            </div>
          </div>
        </ChatContainerRoot>
      </div>

      <SendBar boxName={box.name} runState={runState} onAsk={onAsk} onReplied={onReplied} />
    </div>
  );
}

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

/** A render group: prose, a user turn, a lifecycle hairline, or a cluster of consecutive tool calls. */
type TraceGroup =
  | { kind: "say"; text: string }
  | { kind: "you"; text: string }
  | { kind: "lifecycle"; label: string; detail?: string }
  | { kind: "tools"; events: ToolEvent[] };

/** Coalesce runs of `tool` events into one `tools` group; pass prose/you/lifecycle through unchanged. */
function groupTrace(events: TraceEvent[]): TraceGroup[] {
  const out: TraceGroup[] = [];
  for (const e of events) {
    if (e.kind === "tool") {
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.events.push(e);
      else out.push({ kind: "tools", events: [e] });
    } else if (e.kind === "lifecycle") {
      out.push({ kind: "lifecycle", label: e.label, detail: e.detail });
    } else if (e.kind === "you") {
      out.push({ kind: "you", text: e.text });
    } else {
      out.push({ kind: "say", text: e.text });
    }
  }
  return out;
}

/**
 * A machine vital as a self-contained chip: icon + value, with the full label in a tooltip. Chips
 * read as discrete facts ("uptime 36m", "cpu 0.01/1c", "mem 81 MiB") instead of a run-on string.
 */
function Vital({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="border-border bg-[var(--surface)] text-ink inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-micro">
          <span className="text-ash" aria-hidden>
            {icon}
          </span>
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
