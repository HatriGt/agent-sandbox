import * as React from "react";
import { ChevronRight, Eye, PauseCircle, Terminal } from "lucide-react";
import { resultSummary, type TraceEvent } from "@/lib/trace";
import { tokenizeInline } from "@/lib/inline";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { cn } from "@/lib/utils";

/**
 * Thread items, in the ChatGPT treatment (see DESIGN.md):
 *
 *   · the AGENT has no bubble — full column, 18px prose at 1.6, a small label above. Its output is
 *     prose and deserves the measure; a bubble would halve the width for nothing.
 *   · YOU get a rounded surface-shift bubble, right-aligned, with a tail corner. Not azure: azure is
 *     for actions and for the one state that needs a person.
 *   · the CO-PILOT is visually a different voice — dashed edge, azure-text label, restated every
 *     time, because mistaking the read-only observer for the driver is the dangerous error here.
 *   · lifecycle and tool activity are Markers, which is what Marker is for.
 *
 * Composed on the shadcn chat registry components; this file owns the design decisions on top.
 */

/** Agent prose with inline markdown rendered. Tokens become nodes; no HTML string is ever built. */
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
              <code
                key={i}
                className="text-ink rounded-[8px] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-micro"
              >
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

/** A lifecycle moment: a labelled hairline across the column. */
export function LifecycleItem({ label, detail }: { label: string; detail?: string }) {
  return (
    <Marker variant="separator">
      <MarkerContent className="stamp text-ash">
        {label}
        {detail && <span className="ml-2 tracking-normal normal-case opacity-70">{detail}</span>}
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
        <MarkerIcon className="text-ash">
          <Terminal />
        </MarkerIcon>
        <MarkerContent className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={!event.result}
            aria-expanded={event.result ? open : undefined}
            className={cn(
              "flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1 text-left font-mono text-meta -mx-2",
              event.result && "hover:text-ink cursor-pointer hover:bg-[var(--surface)]"
            )}
          >
            <span className="text-ink shrink-0 font-medium">{event.name}</span>
            {event.arg && <span className="text-ash min-w-0 truncate">{event.arg}</span>}
            {event.result && (
              <ChevronRight
                className={cn("ml-auto size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")}
                aria-hidden
              />
            )}
          </button>
        </MarkerContent>
      </Marker>

      {event.result &&
        (open ? (
          <pre className="mt-2 ml-7 max-h-72 overflow-auto rounded-md bg-[var(--trace)] px-4 py-3 font-mono text-micro leading-relaxed whitespace-pre-wrap text-[var(--trace-fg)]">
            {event.result}
          </pre>
        ) : (
          summary && <p className="text-ash ml-7 truncate font-mono text-micro">{summary}</p>
        ))}
    </div>
  );
}

/** The agent speaking: no bubble, full measure, prose type. */
export function SayItem({ text, live }: { text: string; live?: boolean }) {
  return (
    <Message align="start">
      <MessageContent>
        <MessageHeader className="stamp text-ash gap-1.5 px-0">
          <span className={cn("size-1.5 rounded-full bg-current", live && "breathe")} aria-hidden />
          agent
        </MessageHeader>
        <div className="prose-agent text-ink">
          <Prose text={text} />
        </div>
      </MessageContent>
    </Message>
  );
}

/** Your turn: a rounded surface bubble with a tail, right-aligned. */
export function YouItem({ text, label = "you" }: { text: string; label?: string }) {
  return (
    <Message align="end">
      <MessageContent>
        <MessageHeader className="stamp text-ash gap-1.5 px-0">{label}</MessageHeader>
        <div
          className={cn(
            "max-w-[70%] rounded-[22px] rounded-br-[6px] bg-[var(--surface)] px-4.5 py-3",
            "border text-body whitespace-pre-wrap"
          )}
        >
          {text}
        </div>
      </MessageContent>
    </Message>
  );
}

/** The question the machine is blocked on: the blocking control, so it names the release. */
export function AskingItem({ question }: { question: string }) {
  return (
    <Message align="start">
      <MessageContent>
        <MessageHeader className="stamp text-azure-text gap-1.5 px-0">
          <PauseCircle className="size-3.5" aria-hidden />
          the agent is asking
        </MessageHeader>
        <div className="max-w-[70ch] rounded-lg border border-[var(--accent-edge)] bg-[var(--accent-wash)] px-5 py-4">
          <p className="text-ink text-lead leading-[1.55] whitespace-pre-wrap">{question}</p>
          <p className="text-ash mt-2.5 text-meta">
            It has halted and cannot continue until you answer below.
          </p>
        </div>
      </MessageContent>
    </Message>
  );
}

/** A co-pilot exchange: same thread, unmistakably another voice, and it says so every time. */
export function ObserverItem({ question, answer }: { question: string; answer?: string }) {
  return (
    <Message align="start">
      <MessageContent>
        <MessageHeader className="stamp text-azure-text gap-1.5 px-0">
          <Eye className="size-3.5" aria-hidden />
          co-pilot · read-only · the agent never saw this
        </MessageHeader>
        <div className="max-w-[70ch] rounded-lg border border-dashed border-[var(--accent-edge)] px-5 py-4">
          <p className="text-ash text-meta italic">{question}</p>
          {answer ? (
            <p className="text-ink mt-2 text-lead leading-[1.6]">
              <Prose text={answer} />
            </p>
          ) : (
            <p className="text-ash mt-2 flex items-center gap-1.5 text-meta">
              <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
              <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
              <span className="size-1 animate-bounce rounded-full bg-current" />
              reading the box
            </p>
          )}
        </div>
      </MessageContent>
    </Message>
  );
}
