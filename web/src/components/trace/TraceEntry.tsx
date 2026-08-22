import * as React from "react";
import { ChevronRight } from "lucide-react";
import { resultSummary, type TraceEvent } from "@/lib/trace";
import { tokenizeInline } from "@/lib/inline";
import { cn } from "@/lib/utils";

/**
 * Agent prose, with its inline markdown actually rendered. The agent writes `**bold**` and
 * `` `code` `` because it is a coding agent; leaving the markers on screen reads as broken. Tokens
 * become React nodes — no HTML string is ever built, so model output cannot inject markup.
 */
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
                className="text-ink-dim rounded-xs bg-[var(--surface)] px-1 py-px font-mono text-[13px]"
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

/**
 * One entry on the rail.
 *
 * Everything in a thread hangs off a single hairline running down the left. The node on that
 * hairline says what kind of moment this is; the content sits to its right. This is the layout
 * decision the whole design rests on: a trace has one spine, so the eye has one path down it —
 * unlike alternating bubbles, which make you zig-zag to read a machine's output.
 */
export function RailRow({
  node,
  className,
  children,
  stamp,
}: {
  node: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  stamp?: React.ReactNode;
}) {
  return (
    <div className={cn("relative flex gap-3 pl-1", className)}>
      {/* the hairline itself, drawn behind the node */}
      <div className="absolute bottom-0 left-[7px] top-0 w-px bg-[var(--line)]" aria-hidden />
      <div className="relative z-10 mt-[7px] flex size-3.5 shrink-0 items-center justify-center">{node}</div>
      <div className="min-w-0 flex-1 pb-5">
        {stamp}
        {children}
      </div>
    </div>
  );
}

/** A lifecycle moment: booted, exited, asked. Rendered as a stamp, not a sentence. */
export function LifecycleEntry({ label, detail }: { label: string; detail?: string }) {
  return (
    <RailRow node={<span className="size-1.5 rounded-full bg-[var(--line-strong)]" />}>
      <p className="stamp text-ink-faint pt-1">
        {label}
        {detail && <span className="ml-2 normal-case tracking-normal opacity-70">{detail}</span>}
      </p>
    </RailRow>
  );
}

/**
 * The agent speaking. No bubble, full measure, prose type — because this is prose, and a bubble
 * would cap it at half the width for no reason.
 */
export function SayEntry({ text, live }: { text: string; live?: boolean }) {
  return (
    <RailRow
      node={
        <span
          className={cn(
            "size-2 rounded-full",
            live ? "bg-live breathe" : "bg-[var(--line-strong)]"
          )}
        />
      }
    >
      <p className="text-ink max-w-[68ch] text-[15px] leading-[1.65]">
        <Prose text={text} />
      </p>
    </RailRow>
  );
}

/**
 * A tool call. Collapsed to one monospace line — the verb and its target — with output folded
 * away. A run can make fifty of these; expanded by default they would bury the agent's reasoning.
 */
export function ToolEntry({ event }: { event: Extract<TraceEvent, { kind: "tool" }> }) {
  const [open, setOpen] = React.useState(false);
  const summary = resultSummary(event.result);

  return (
    <RailRow node={<span className="size-1.5 rounded-[1px] bg-[var(--ink-faint)]" />}>
      <div className="max-w-[80ch]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!event.result}
          aria-expanded={event.result ? open : undefined}
          className={cn(
            "group flex w-full items-baseline gap-2 rounded-sm py-0.5 text-left font-mono text-[12.5px]",
            event.result && "cursor-pointer hover:bg-[var(--surface)]"
          )}
        >
          <span className="text-ink-dim shrink-0 font-medium">{event.name}</span>
          {event.arg && <span className="text-ink-faint truncate">{event.arg}</span>}
          {event.result && (
            <ChevronRight
              className={cn(
                "text-ink-faint ml-auto size-3 shrink-0 transition-transform duration-150",
                open && "rotate-90"
              )}
              aria-hidden
            />
          )}
        </button>

        {event.result &&
          (open ? (
            <pre className="bg-trace text-ink-dim mt-1.5 max-h-64 overflow-auto rounded-sm px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
              {event.result}
            </pre>
          ) : (
            summary && <p className="text-ink-faint truncate pl-0 font-mono text-[12px]">{summary}</p>
          ))}
      </div>
    </RailRow>
  );
}

/** Your turn — the task you gave it, or an answer you sent. Accent rail, right-anchored stamp. */
export function YouEntry({ text, stampLabel = "you" }: { text: string; stampLabel?: string }) {
  return (
    <RailRow node={<span className="bg-signal size-2 rounded-full" />}>
      <p className="stamp text-signal/80 pb-1">{stampLabel}</p>
      <p className="text-ink max-w-[68ch] whitespace-pre-wrap border-l-2 border-[var(--signal)] pl-3 text-[15px]">
        {text}
      </p>
    </RailRow>
  );
}

/**
 * A co-pilot exchange. Same thread, deliberately different voice: cool colour, dashed rule, and an
 * explicit note that the agent never saw it. The lane distinction is the one thing about this
 * product that is dangerous to get wrong, so it is restated at every occurrence rather than once in
 * a header the reader has scrolled past.
 */
export function ObserverEntry({ question, answer }: { question: string; answer?: string }) {
  return (
    <RailRow
      node={<span className="size-2 rounded-full border border-[var(--observer)] bg-[var(--bg)]" />}
    >
      <div className="max-w-[70ch] border-l border-dashed border-[var(--observer)] pl-3">
        <p className="stamp pb-1" style={{ color: "var(--observer)" }}>
          co-pilot · read-only
        </p>
        <p className="text-ink-dim text-[14px] italic">{question}</p>
        {answer ? (
          <p className="text-ink mt-1.5 text-[14.5px] leading-[1.6]">
          <Prose text={answer} />
        </p>
        ) : (
          <p className="text-ink-faint mt-1.5 flex items-center gap-1.5 text-[14px]">
            <span className="bg-ink-faint size-1 animate-bounce rounded-full [animation-delay:-0.3s]" />
            <span className="bg-ink-faint size-1 animate-bounce rounded-full [animation-delay:-0.15s]" />
            <span className="bg-ink-faint size-1 animate-bounce rounded-full" />
            reading the box
          </p>
        )}
      </div>
    </RailRow>
  );
}
