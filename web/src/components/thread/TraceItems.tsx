import * as React from "react";
import { ChevronRight, Eye, FileText, PauseCircle, Terminal } from "lucide-react";
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

/** Shell-family tools render as a real command; everything else is a compact labelled row. */
const SHELL_TOOLS = new Set(["Bash", "Shell", "Terminal", "Run", "Exec", "sh", "bash"]);

/**
 * A tool call rendered like real code (this is what the old dashboard got right):
 *
 *   · a Bash/Shell call is a TERMINAL block — a `$ <command>` prompt line on the dark trace ground,
 *     its output printed right below it in the same panel. The command is code, so it reads as code.
 *   · any other tool (Write / Read / Edit / Grep …) is a compact row: tool name + its argument in a
 *     code chip, output folded behind a chevron.
 *
 * Output folds by default — a run emits dozens of calls and expanding every one would bury the
 * reasoning — but a shell command's headline is always visible because the command IS the content.
 */
export function ToolItem({ event }: { event: Extract<TraceEvent, { kind: "tool" }> }) {
  const isShell = SHELL_TOOLS.has(event.name);
  return isShell ? <ShellItem event={event} /> : <FileToolItem event={event} />;
}

/** A shell command as a terminal panel: `$ cmd` then its output, on the dark trace ground. */
function ShellItem({ event }: { event: Extract<TraceEvent, { kind: "tool" }> }) {
  const [open, setOpen] = React.useState(false);
  const hasOutput = !!event.result;
  return (
    <div className="ml-7 min-w-0">
      <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--trace)]">
        {/* title bar — signals "terminal" the way the old panel did */}
        <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--trace-fg)_14%,transparent)] px-3 py-1.5">
          <Terminal className="size-3 shrink-0 text-[color-mix(in_srgb,var(--trace-fg)_60%,transparent)]" aria-hidden />
          <span className="stamp text-[color-mix(in_srgb,var(--trace-fg)_55%,transparent)]">{event.name}</span>
          {hasOutput && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="ml-auto flex cursor-pointer items-center gap-1 text-[color-mix(in_srgb,var(--trace-fg)_60%,transparent)] hover:text-[var(--trace-fg)]"
            >
              <span className="stamp">{open ? "hide" : "output"}</span>
              <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
            </button>
          )}
        </div>
        {/* command line — always visible; the command is the content */}
        <pre className="overflow-x-auto px-3 py-2 font-mono text-micro leading-relaxed text-[var(--trace-fg)]">
          <span className="mr-2 shrink-0 select-none text-[var(--ok)]" aria-hidden>$</span>
          {event.arg ?? ""}
        </pre>
        {hasOutput && open && (
          <pre className="max-h-80 overflow-auto border-t border-[color-mix(in_srgb,var(--trace-fg)_14%,transparent)] px-3 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap text-[color-mix(in_srgb,var(--trace-fg)_82%,transparent)]">
            {event.result}
          </pre>
        )}
      </div>
      {hasOutput && !open && (
        <p className="text-ash mt-1 truncate font-mono text-micro">{resultSummary(event.result)}</p>
      )}
    </div>
  );
}

/** Non-shell tool (Write/Read/Edit/Grep…): compact row, arg as a code chip, output folded. */
function FileToolItem({ event }: { event: Extract<TraceEvent, { kind: "tool" }> }) {
  const [open, setOpen] = React.useState(false);
  const summary = resultSummary(event.result);

  return (
    <div className="min-w-0">
      <Marker>
        <MarkerIcon className="text-ash">
          <FileText />
        </MarkerIcon>
        <MarkerContent className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={!event.result}
            aria-expanded={event.result ? open : undefined}
            className={cn(
              "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-meta -mx-2",
              event.result && "cursor-pointer hover:bg-[var(--surface)]"
            )}
          >
            <span className="text-ink shrink-0 font-medium">{event.name}</span>
            {event.arg && (
              <code className="text-ash min-w-0 truncate rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-micro">
                {event.arg}
              </code>
            )}
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
          <pre className="mt-2 ml-7 max-h-72 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--trace)] px-3 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap text-[color-mix(in_srgb,var(--trace-fg)_82%,transparent)]">
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
