import * as React from "react";
import { ChevronRight, Eye, PauseCircle, Terminal, User } from "lucide-react";
import { resultSummary, type TraceEvent } from "@/lib/trace";
import { tokenizeInline } from "@/lib/inline";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { cn } from "@/lib/utils";

/**
 * The thread's items, composed from shadcn's chat primitives (Message / Bubble / Marker) rather
 * than hand-rolled equivalents — the registry owns the layout, grouping and alignment mechanics, and
 * this file owns the design decisions on top of them:
 *
 *   · the agent gets Bubble variant="ghost" (no surface, full measure) because its output is prose;
 *   · you get variant="tinted", which resolves to the sodium primary — the only lane that can steer;
 *   · the co-pilot gets variant="outline" with a dashed edge, so an observer can never be mistaken
 *     for the driver;
 *   · lifecycle and tool activity are Markers, which is exactly what Marker is for.
 */

/** Agent prose with its inline markdown rendered. Tokens become nodes; no HTML string is built. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, li) => (
        <React.Fragment key={li}>
          {li > 0 && <br />}
          {tokenizeInline(line).map((t, i) =>
            t.type === "strong" ? (
              <strong key={i} className="text-ink font-semibold">
                {t.value}
              </strong>
            ) : t.type === "code" ? (
              <code key={i} className="bg-muted text-ink-dim rounded px-1 py-px font-mono text-[13px]">
                {t.value}
              </code>
            ) : (
              <React.Fragment key={i}>{t.value}</React.Fragment>
            )
          )}
        </React.Fragment>
      ))}
    </>
  );
}

/** A lifecycle moment: booted, exited. A labelled separator across the thread. */
export function LifecycleItem({ label, detail }: { label: string; detail?: string }) {
  return (
    <Marker variant="separator">
      <MarkerContent className="stamp text-ink-faint">
        {label}
        {detail && <span className="ml-2 normal-case tracking-normal opacity-70">{detail}</span>}
      </MarkerContent>
    </Marker>
  );
}

/** A tool call: one mono row, output folded. A run emits dozens; expanded would bury the reasoning. */
export function ToolItem({ event }: { event: Extract<TraceEvent, { kind: "tool" }> }) {
  const [open, setOpen] = React.useState(false);
  const summary = resultSummary(event.result);

  return (
    <div className="min-w-0">
      <Marker>
        <MarkerIcon className="text-ink-faint">
          <Terminal />
        </MarkerIcon>
        <MarkerContent className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={!event.result}
            aria-expanded={event.result ? open : undefined}
            className={cn(
              "flex w-full min-w-0 items-baseline gap-2 rounded text-left font-mono text-[12.5px]",
              event.result && "hover:text-ink cursor-pointer"
            )}
          >
            <span className="text-ink-dim shrink-0 font-medium">{event.name}</span>
            {event.arg && <span className="text-ink-faint min-w-0 truncate">{event.arg}</span>}
            {event.result && (
              <ChevronRight
                className={cn("ml-auto size-3 shrink-0 transition-transform duration-150", open && "rotate-90")}
                aria-hidden
              />
            )}
          </button>
        </MarkerContent>
      </Marker>

      {event.result &&
        (open ? (
          <pre className="bg-trace text-ink-dim mt-1.5 ml-6 max-h-64 overflow-auto rounded px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
            {event.result}
          </pre>
        ) : (
          summary && <p className="text-ink-faint ml-6 truncate font-mono text-[12px]">{summary}</p>
        ))}
    </div>
  );
}

/** The agent speaking: ghost bubble, full measure, prose type. */
export function SayItem({ text, live }: { text: string; live?: boolean }) {
  return (
    <Message align="start">
      <MessageContent>
        <MessageHeader className="stamp text-ink-faint gap-1.5">
          <span
            className={cn("size-1.5 rounded-full", live ? "bg-live breathe" : "bg-[var(--line-strong)]")}
            aria-hidden
          />
          agent
        </MessageHeader>
        <Bubble variant="ghost">
          <BubbleContent className="text-ink max-w-[68ch] text-[15px] leading-[1.65]">
            <Prose text={text} />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/** Your turn: the task, or an answer that released a halted run. */
export function YouItem({ text, label = "you" }: { text: string; label?: string }) {
  return (
    <Message align="end">
      <MessageContent>
        <MessageHeader className="stamp text-signal/80 gap-1.5">
          <User className="size-3" aria-hidden />
          {label}
        </MessageHeader>
        <Bubble variant="tinted">
          <BubbleContent className="max-w-[62ch] text-[14.5px] whitespace-pre-wrap">{text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/**
 * The question the machine is blocked on. Not a notification — it is the blocking control, so it
 * states the consequence ("halted") and the release ("answer below").
 */
export function AskingItem({ question }: { question: string }) {
  return (
    <Message align="start">
      <MessageContent>
        <MessageHeader className="stamp text-signal gap-1.5">
          <PauseCircle className="size-3" aria-hidden />
          the agent is asking
        </MessageHeader>
        <Bubble variant="outline">
          <BubbleContent className="border-signal/40 bg-[color-mix(in_oklch,var(--signal)_10%,transparent)] max-w-[68ch] border">
            <p className="text-ink text-[15px] leading-[1.6] whitespace-pre-wrap">{question}</p>
            <p className="text-ink-faint mt-2 text-[12.5px]">
              It has halted and cannot continue until you answer below.
            </p>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/**
 * A co-pilot exchange: same thread, unmistakably another voice. The lane distinction is the one
 * thing here that is dangerous to get wrong, so it is restated at every occurrence rather than once
 * in a header the reader has already scrolled past.
 */
export function ObserverItem({ question, answer }: { question: string; answer?: string }) {
  return (
    <Message align="start">
      <MessageContent>
        <MessageHeader className="stamp gap-1.5" style={{ color: "var(--observer)" }}>
          <Eye className="size-3" aria-hidden />
          co-pilot · read-only · the agent never saw this
        </MessageHeader>
        <Bubble variant="outline">
          <BubbleContent className="max-w-[70ch] border border-dashed" style={{ borderColor: "var(--observer)" }}>
            <p className="text-ink-dim text-[13.5px] italic">{question}</p>
            {answer ? (
              <p className="text-ink mt-1.5 text-[14.5px] leading-[1.6]">
                <Prose text={answer} />
              </p>
            ) : (
              <p className="text-ink-faint mt-1.5 flex items-center gap-1.5 text-[13.5px]">
                <span className="bg-ink-faint size-1 animate-bounce rounded-full [animation-delay:-0.3s]" />
                <span className="bg-ink-faint size-1 animate-bounce rounded-full [animation-delay:-0.15s]" />
                <span className="bg-ink-faint size-1 animate-bounce rounded-full" />
                reading the box
              </p>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
