import * as React from "react";
import { AlertTriangle, ChevronRight, Eye, FileText, Loader2, Pause, Terminal, Wrench } from "lucide-react";
import { resultSummary, type TraceEvent } from "@/lib/trace";
import { Markdown } from "@/components/ui/markdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { cn } from "@/lib/utils";

/**
 * Thread items. Three voices, never confusable:
 *
 *   · the AGENT has no bubble — full-measure prose, a quiet label above. Its output is prose.
 *   · YOU are the one bubble: a muted fill on the right. Tasks and follow-ups both use it.
 *   · the CO-PILOT is visibly another voice — dashed edge, restated every time — because mistaking
 *     the read-only observer for the driver is the dangerous error in this product.
 *
 * Lifecycle is a labelled hairline; tool activity is a compact step row or a terminal panel.
 */

/** A lifecycle moment: a labelled hairline across the column. */
export function LifecycleItem({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-3 py-0.5">
      <span className="label text-muted-foreground shrink-0">{label}</span>
      {detail && <span className="stamp text-muted-foreground/70 truncate">{detail}</span>}
      <span className="bg-border h-px flex-1" aria-hidden />
    </div>
  );
}

const SHELL_TOOLS = new Set(["Bash", "Shell", "Terminal", "Run", "Exec", "sh", "bash"]);
type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

/** How many lines a result has, for the fold's label. */
function lineCount(result: string): number {
  return result.replace(/\n+$/, "").split("\n").length;
}

function ToolItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  return SHELL_TOOLS.has(event.name) ? <ShellItem event={event} live={live} /> : <StepItem event={event} live={live} />;
}

/**
 * Consecutive tool calls fold into one "N steps" row that expands to the individual panels — the
 * thread reads as prose punctuated by work, not a wall of tool rows. A single tool renders inline.
 *
 * `live` marks the group as belonging to the in-progress turn; any tool in it without a result is
 * still executing (under parallel tool use the last one often answers first), so running is per-tool.
 */
export function ToolGroup({ events, live }: { events: ToolEvent[]; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const anyRunning = !!live && events.some((e) => !e.result);
  const failed = events.filter((e) => e.failed).length;
  if (events.length === 1) return <ToolItem event={events[0]} live={anyRunning} />;

  const names = [...new Set(events.map((e) => e.name))].slice(0, 4).join(" · ");
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex max-w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-meta transition-colors",
          anyRunning
            ? "border-live/30 bg-live/6 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted bg-card"
        )}
      >
        {anyRunning ? (
          <Loader2 className="text-live size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Wrench className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="font-medium">
          {anyRunning ? `${events.length} steps · running` : `${events.length} steps`}
        </span>
        {failed > 0 && !anyRunning && (
          <span className="text-destructive label">{failed} failed</span>
        )}
        <span className="stamp text-muted-foreground/70 hidden min-w-0 truncate sm:inline">{names}</span>
        <ChevronRight
          className={cn("ml-1 size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")}
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

/** A shell command as a terminal panel: `$ cmd`, then its output, on the dark trace ground. */
function ShellItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const hasOutput = !!event.result;
  const lines = event.result ? lineCount(event.result) : 0;
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "bg-trace overflow-hidden rounded-lg border border-white/8",
          live && "ring-live/40 ring-1"
        )}
      >
        <div className="flex items-center gap-2 border-b border-white/8 px-3 py-1.5">
          {live ? (
            <Loader2 className="text-live size-3 shrink-0 animate-spin" aria-hidden />
          ) : event.failed ? (
            <AlertTriangle className="text-destructive size-3 shrink-0" aria-hidden />
          ) : (
            <Terminal className="text-trace-fg/55 size-3 shrink-0" aria-hidden />
          )}
          <span className="label text-trace-fg/60">{event.name}</span>
          {live && <span className="label text-live">running</span>}
          {!live && event.failed && <span className="label text-destructive">failed</span>}
          {hasOutput && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="text-trace-fg/60 hover:text-trace-fg ml-auto flex cursor-pointer items-center gap-1 rounded px-1"
            >
              <span className="label">{open ? "hide output" : lines > 1 ? `${lines} lines` : "output"}</span>
              <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
            </button>
          )}
        </div>
        <pre className="text-trace-fg overflow-x-auto px-3 py-2 font-mono text-micro leading-relaxed">
          <span className="text-ok mr-2 shrink-0 select-none" aria-hidden>
            $
          </span>
          {event.arg ?? ""}
          {live && !hasOutput && <span className="caret text-live" aria-hidden>▍</span>}
        </pre>
        {hasOutput && open && (
          <pre className="text-trace-fg/85 max-h-80 overflow-auto border-t border-white/8 px-3 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap">
            {event.result}
          </pre>
        )}
      </div>
      {hasOutput && !open && (
        <p className="stamp text-muted-foreground mt-1 truncate pl-1">{resultSummary(event.result)}</p>
      )}
    </div>
  );
}

/** Non-shell tool (Write / Read / Edit / Grep …): compact step row, arg as a code chip, output folded. */
function StepItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const summary = resultSummary(event.result);
  const lines = event.result ? lineCount(event.result) : 0;

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
          live && "bg-live/6"
        )}
      >
        {live ? (
          <Loader2 className="text-live size-3.5 shrink-0 animate-spin" aria-hidden />
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
          <>
            {lines > 1 && <span className="label text-muted-foreground/70 ml-auto shrink-0">{lines} lines</span>}
            <ChevronRight
              className={cn(
                "text-muted-foreground size-3.5 shrink-0 transition-transform duration-150",
                lines > 1 ? "ml-1" : "ml-auto",
                open && "rotate-90"
              )}
              aria-hidden
            />
          </>
        )}
      </button>

      {event.result &&
        (open ? (
          <pre className="bg-trace text-trace-fg/85 mt-2 ml-6 max-h-72 overflow-auto rounded-lg border border-white/8 px-3 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap">
            {event.result}
          </pre>
        ) : (
          summary && <p className="stamp text-muted-foreground ml-8 truncate">{summary}</p>
        ))}
    </div>
  );
}

/**
 * The agent speaking: full-width prose, no card, no bubble. A small label above keeps the turn
 * attributable; the dot breathes while live. While `live`, the text reveals with a streaming cadence
 * (only the not-yet-shown tail animates); a finished say renders as static Markdown.
 */
export const SayItem = React.memo(function SayItem({ text, live }: { text: string; live?: boolean }) {
  return (
    <div className="enter min-w-0">
      <span className="label text-muted-foreground mb-1.5 flex items-center gap-1.5">
        <span
          className={cn("size-1.5 rounded-full", live ? "bg-live breathe" : "bg-muted-foreground/60")}
          aria-hidden
        />
        Agent
      </span>
      <div className="text-foreground min-w-0">
        {live ? <StreamingMarkdown text={text} /> : <Markdown className="prose-agent">{text}</Markdown>}
      </div>
    </div>
  );
});

/** The "working…" beat between visible outputs, so the thread never has dead air while a run is live. */
export function WorkingIndicator({ label = "Working" }: { label?: string }) {
  return (
    <div className="enter text-muted-foreground flex items-center gap-2.5 text-meta" aria-live="polite">
      <span className="text-live flex items-center gap-1" aria-hidden>
        <span className="dot dot-1 bg-current size-1.5 rounded-full" />
        <span className="dot dot-2 bg-current size-1.5 rounded-full" />
        <span className="dot dot-3 bg-current size-1.5 rounded-full" />
      </span>
      <span>{label}…</span>
    </div>
  );
}

/** Your turn: the one bubble. A muted fill, right-aligned, so the primary ink stays for actions. */
export function YouItem({ text, label = "You" }: { text: string; label?: string }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="label text-muted-foreground pr-1">{label}</span>
      <div className="bg-muted text-foreground max-w-[min(72%,60ch)] rounded-2xl rounded-br-md px-4 py-2.5 text-body leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

/**
 * Pull inline answer options out of a clarifying question: bracketed `[option]` choices, or a
 * `1) x` / `2. y` enumeration. Capped and de-duplicated; anything long or malformed falls back to a
 * free-text reply (no options).
 */
function parseChoices(question: string): string[] {
  const bracketed = [...question.matchAll(/\[([^\]]{1,48})\]/g)].map((m) => m[1].trim());
  if (bracketed.length >= 2) return [...new Set(bracketed)].slice(0, 5);
  const enumerated = [...question.matchAll(/(?:^|\n)\s*\d+[.)]\s*([^\n]{1,48})/g)].map((m) => m[1].trim());
  if (enumerated.length >= 2) return [...new Set(enumerated)].slice(0, 5);
  return [];
}

/** The question the machine is blocked on — the blocking control, so it names the release. */
export function AskingItem({ question, onAnswer }: { question: string; onAnswer?: (text: string) => void }) {
  const choices = React.useMemo(() => parseChoices(question), [question]);
  return (
    <div className="enter flex flex-col gap-1.5">
      <span className="label text-attention-text flex items-center gap-1.5">
        <Pause className="size-3" strokeWidth={2.5} aria-hidden />
        Paused — the agent needs your answer
      </span>
      <div className="border-attention/50 bg-attention/12 max-w-[70ch] rounded-xl border px-5 py-4">
        <p className="text-foreground text-lead leading-[1.55] whitespace-pre-wrap">{question}</p>
        {choices.length > 0 && onAnswer ? (
          <>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {choices.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onAnswer(c)}
                  className="bg-card text-foreground hover:border-attention hover:bg-attention/15 cursor-pointer rounded-full border px-3.5 py-1.5 text-meta font-medium transition-colors"
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground mt-2.5 text-micro">Pick one, or type a different answer below.</p>
          </>
        ) : (
          <p className="text-muted-foreground mt-2.5 text-meta">
            Nothing happens until you reply below — every tool call is blocked while it waits.
          </p>
        )}
      </div>
    </div>
  );
}

/** A co-pilot exchange: same thread, unmistakably another voice, and it says so every time. */
export function ObserverItem({ question, answer }: { question: string; answer?: string }) {
  return (
    <div className="enter flex flex-col gap-1.5">
      <span className="label text-muted-foreground flex items-center gap-1.5">
        <Eye className="size-3" aria-hidden />
        Co-pilot · read-only · the agent never sees this
      </span>
      <div className="max-w-[70ch] rounded-xl border border-dashed px-5 py-4">
        <p className="text-muted-foreground text-meta italic">{question}</p>
        {answer ? (
          <div className="text-foreground prose-agent mt-2 text-body">
            <Markdown>{answer}</Markdown>
          </div>
        ) : (
          <p className="text-muted-foreground mt-2.5 flex items-center gap-2 text-meta">
            <span className="flex items-center gap-1" aria-hidden>
              <span className="dot dot-1 bg-current size-1.5 rounded-full" />
              <span className="dot dot-2 bg-current size-1.5 rounded-full" />
              <span className="dot dot-3 bg-current size-1.5 rounded-full" />
            </span>
            Reading the box…
          </p>
        )}
      </div>
    </div>
  );
}
