import * as React from "react";
import { AlertTriangle, ChevronRight, Eye, FileText, Loader2, PauseCircle, Terminal, Wrench } from "lucide-react";
import { resultSummary, type TraceEvent } from "@/lib/trace";
import { Markdown } from "@/components/ui/markdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { cn } from "@/lib/utils";

/**
 * Thread items, rendered on the prompt-kit chat vocabulary over the shadcn neutral base:
 *
 *   · the AGENT has no bubble — full column, 16px prose via prompt-kit Markdown, a small label above.
 *     Its output is prose and deserves the measure; a bubble would halve the width for nothing.
 *   · YOU get a rounded secondary bubble, right-aligned, with a tail corner.
 *   · the CO-PILOT is a visibly different voice — dashed edge, restated every time, because mistaking
 *     the read-only observer for the driver is the dangerous error here.
 *   · lifecycle is a labelled hairline; tool activity is a compact row or a terminal block.
 */

/** A lifecycle moment: a labelled hairline across the column. */
export function LifecycleItem({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="stamp text-muted-foreground shrink-0">{label}</span>
      {detail && <span className="text-muted-foreground/70 truncate font-mono text-micro">{detail}</span>}
      <span className="bg-border h-px flex-1" aria-hidden />
    </div>
  );
}

/** Shell-family tools render as a real command; everything else is a compact labelled row. */
const SHELL_TOOLS = new Set(["Bash", "Shell", "Terminal", "Run", "Exec", "sh", "bash"]);

/**
 * A tool call rendered like real code:
 *
 *   · a Bash/Shell call is a TERMINAL block — a `$ <command>` prompt on the dark trace ground, output
 *     printed right below in the same panel. The command is code, so it reads as code.
 *   · any other tool (Write / Read / Edit / Grep …) is a compact row: name + argument in a code chip,
 *     output folded behind a chevron.
 */
/**
 * `live` means the run is in progress AND this is the newest tool with no result yet — i.e. the tool
 * is executing right now. It drives the running-vs-finished visual: a spinner + tinted header while
 * running, the calm finished style once output arrives (or the run moves on).
 */
/** Module-local: only `ToolGroup` (below) renders it; nothing outside this file imports it. */
function ToolItem({ event, live }: { event: Extract<TraceEvent, { kind: "tool" }>; live?: boolean }) {
  const isShell = SHELL_TOOLS.has(event.name);
  return isShell ? <ShellItem event={event} live={live} /> : <FileToolItem event={event} live={live} />;
}

/**
 * A cluster of consecutive tool calls, rendered like the reference's "N tools used" pill: a compact
 * summary chip that expands to the individual tool rows/terminal panels. A single tool renders
 * inline with no pill — there is nothing to summarise.
 *
 * `live` marks the whole group as belonging to the in-progress turn; every tool in a live group whose
 * result has not arrived yet is still executing, so each of those gets the running treatment.
 */
export function ToolGroup({ events, live }: { events: Extract<TraceEvent, { kind: "tool" }>[]; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  // With correlated results any tool in the group can still be outstanding — under parallel tool use
  // the last one often answers first — so "running" is per-tool, not "the last one".
  const anyRunning = !!live && events.some((e) => !e.result);
  if (events.length === 1) return <ToolItem event={events[0]} live={anyRunning} />;

  const names = [...new Set(events.map((e) => e.name))].slice(0, 4).join(", ");
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-left text-meta transition-colors",
          anyRunning
            ? "border-border text-foreground bg-muted/60"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
      >
        {anyRunning ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Wrench className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="font-medium">{anyRunning ? `${events.length} tools · running` : `${events.length} tools used`}</span>
        <span className="text-muted-foreground/70 hidden min-w-0 truncate font-mono text-micro sm:inline">{names}</span>
        <ChevronRight
          className={cn("ml-auto size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")}
          aria-hidden
        />
      </button>
      {open && (
        <div className="mt-2.5 flex flex-col gap-2.5 border-l pl-3">
          {events.map((e, i) => (
            <ToolItem key={i} event={e} live={live && !e.result} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A shell command as a terminal panel: `$ cmd` then its output, on the dark trace ground. */
function ShellItem({ event, live }: { event: Extract<TraceEvent, { kind: "tool" }>; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const hasOutput = !!event.result;
  return (
    <div className="min-w-0">
      <div className={cn("border-border bg-trace overflow-hidden rounded-lg border", live && "ring-1 ring-ok/40")}>
        <div className="border-border/60 flex items-center gap-2 border-b px-3 py-1.5">
          {live ? (
            <Loader2 className="text-ok size-3 shrink-0 animate-spin" aria-hidden />
          ) : event.failed ? (
            <AlertTriangle className="text-destructive size-3 shrink-0" aria-hidden />
          ) : (
            <Terminal className="text-trace-fg/60 size-3 shrink-0" aria-hidden />
          )}
          <span className="stamp text-trace-fg/55">{event.name}</span>
          {live && <span className="stamp text-ok/80">running</span>}
          {!live && event.failed && <span className="stamp text-destructive">failed</span>}
          {hasOutput && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="text-trace-fg/60 hover:text-trace-fg ml-auto flex cursor-pointer items-center gap-1"
            >
              <span className="stamp">{open ? "hide" : "output"}</span>
              <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
            </button>
          )}
        </div>
        <pre className="text-trace-fg overflow-x-auto px-3 py-2 font-mono text-micro leading-relaxed">
          <span className="text-ok mr-2 shrink-0 select-none" aria-hidden>
            $
          </span>
          {event.arg ?? ""}
          {live && !hasOutput && <span className="caret text-ok" aria-hidden>▍</span>}
        </pre>
        {hasOutput && open && (
          <pre className="border-border/60 text-trace-fg/80 max-h-80 overflow-auto border-t px-3 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap">
            {event.result}
          </pre>
        )}
      </div>
      {hasOutput && !open && (
        <p className="text-muted-foreground mt-1 truncate font-mono text-micro">{resultSummary(event.result)}</p>
      )}
    </div>
  );
}

/** Non-shell tool (Write/Read/Edit/Grep…): compact row, arg as a code chip, output folded. */
function FileToolItem({ event, live }: { event: Extract<TraceEvent, { kind: "tool" }>; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const summary = resultSummary(event.result);

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!event.result}
        aria-expanded={event.result ? open : undefined}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-meta",
          event.result && "hover:bg-muted cursor-pointer",
          live && "bg-muted/60"
        )}
      >
        {live ? (
          <Loader2 className="text-foreground size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : event.failed ? (
          <AlertTriangle className="text-destructive size-3.5 shrink-0" aria-hidden />
        ) : (
          <FileText className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        )}
        <span className="text-foreground shrink-0 font-medium">{event.name}</span>
        {event.arg && (
          <code className="text-muted-foreground bg-muted min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-micro">
            {event.arg}
          </code>
        )}
        {event.result && (
          <ChevronRight
            className={cn("text-muted-foreground ml-auto size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")}
            aria-hidden
          />
        )}
      </button>

      {event.result &&
        (open ? (
          <pre className="border-border bg-trace text-trace-fg/80 mt-2 ml-6 max-h-72 overflow-auto rounded-lg border px-3 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap">
            {event.result}
          </pre>
        ) : (
          summary && <p className="text-muted-foreground ml-6 truncate font-mono text-micro">{summary}</p>
        ))}
    </div>
  );
}

/**
 * The agent speaking: full-width prose in the column, Claude-Code style — NO card, NO bubble, NO
 * avatar. The reference renders the assistant turn as plain prose straight in the reading measure
 * (transparent ground, comfortable line-height), reserving fills for the user's one voice. We keep a
 * small, quiet role label above so the turn is still attributable, and a breathing dot beside it
 * while live so the "who is talking / still going" signal survives without a heavy avatar chrome.
 *
 * While `live` the text is revealed with a streaming cadence via `StreamingMarkdown`; a finished say
 * renders as static Markdown. The reveal only animates the not-yet-shown tail, so a re-poll of
 * already-visible text never re-animates. Both paths render through `prose-agent` so static and
 * streaming turns are typographically identical.
 *
 * Memoised on `(text, live)` so an unchanged completed say does not re-render every 3s poll.
 */
export const SayItem = React.memo(function SayItem({ text, live }: { text: string; live?: boolean }) {
  return (
    <div className="enter min-w-0">
      <span className="stamp text-muted-foreground mb-1.5 flex items-center gap-1.5">
        <span className={cn("bg-muted-foreground size-1.5 rounded-full", live && "breathe")} aria-hidden />
        agent
      </span>
      <div className="text-foreground min-w-0">
        {live ? <StreamingMarkdown text={text} /> : <Markdown className="prose-agent">{text}</Markdown>}
      </div>
    </div>
  );
});

/**
 * The "working…" beat: shown while the run is in progress and the agent is between visible outputs
 * (thinking, or a tool is executing without streamed prose). Gives the thread a clear, resolving
 * "the agent is doing something" signal instead of dead air, matching Claude Code web.
 */
export function WorkingIndicator({ label = "working" }: { label?: string }) {
  return (
    <div className="enter flex items-start gap-3" aria-live="polite">
      <span className="bg-accent text-accent-foreground mt-0.5 grid size-7 shrink-0 place-items-center rounded-full" aria-hidden>
        <span className="bg-current breathe size-2 rounded-full" />
      </span>
      <div className="text-muted-foreground flex items-center gap-2 pt-1.5 text-meta">
        <span className="flex items-center gap-1" aria-hidden>
          <span className="dot dot-1 bg-current size-1.5 rounded-full" />
          <span className="dot dot-2 bg-current size-1.5 rounded-full" />
          <span className="dot dot-3 bg-current size-1.5 rounded-full" />
        </span>
        <span>{label}…</span>
      </div>
    </div>
  );
}

/** Your turn: a solid BLUE bubble, right-aligned, with a tail corner — the one filled voice. */
export function YouItem({ text, label = "you" }: { text: string; label?: string }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="stamp text-muted-foreground pr-1">{label}</span>
      <div className="bg-primary text-primary-foreground elevate-sm max-w-[72%] rounded-2xl rounded-br-sm px-4 py-2.5 text-body whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

/**
 * Pull inline answer options out of a clarifying question, matching the reference's
 * "…which one? [Acme Corp] [New Acme Corp]" pattern. Recognises bracketed `[option]` choices and, as
 * a fallback, `1) x` / `2. y` enumerations. Options are capped and de-duplicated; anything long or
 * malformed falls back to free-text reply (returns no options).
 */
function parseChoices(question: string): string[] {
  const bracketed = [...question.matchAll(/\[([^\]]{1,48})\]/g)].map((m) => m[1].trim());
  if (bracketed.length >= 2) return [...new Set(bracketed)].slice(0, 5);
  const enumerated = [...question.matchAll(/(?:^|\n)\s*\d+[.)]\s*([^\n]{1,48})/g)].map((m) => m[1].trim());
  if (enumerated.length >= 2) return [...new Set(enumerated)].slice(0, 5);
  return [];
}

/** The question the machine is blocked on: the blocking control, so it names the release. */
export function AskingItem({ question, onAnswer }: { question: string; onAnswer?: (text: string) => void }) {
  const choices = React.useMemo(() => parseChoices(question), [question]);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="stamp text-attention-text flex items-center gap-1.5">
        <PauseCircle className="size-3.5" aria-hidden />
        the agent is asking
      </span>
      <div className="border-attention/45 bg-attention/10 max-w-[70ch] rounded-xl border px-5 py-4">
        <p className="text-foreground text-lead leading-[1.55] whitespace-pre-wrap">{question}</p>
        {choices.length > 0 && onAnswer ? (
          <>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {choices.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onAnswer(c)}
                  className="bg-card text-foreground hover:bg-attention/15 hover:border-attention/60 cursor-pointer rounded-full border px-3.5 py-1.5 text-meta font-medium transition-colors"
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground mt-2.5 text-micro">
              Pick one to release the run, or type a different answer below.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground mt-2.5 text-meta">It has halted and cannot continue until you answer below.</p>
        )}
      </div>
    </div>
  );
}

/** A co-pilot exchange: same thread, unmistakably another voice, and it says so every time. */
export function ObserverItem({ question, answer }: { question: string; answer?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="stamp text-muted-foreground flex items-center gap-1.5">
        <Eye className="size-3.5" aria-hidden />
        co-pilot · read-only · the agent never saw this
      </span>
      <div className="border-border max-w-[70ch] rounded-lg border border-dashed px-5 py-4">
        <p className="text-muted-foreground text-meta italic">{question}</p>
        {answer ? (
          <div className="text-foreground mt-2 text-lead leading-[1.6]">
            <Markdown>{answer}</Markdown>
          </div>
        ) : (
          <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-meta">
            <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
            <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
            <span className="size-1 animate-bounce rounded-full bg-current" />
            reading the box
          </p>
        )}
      </div>
    </div>
  );
}
