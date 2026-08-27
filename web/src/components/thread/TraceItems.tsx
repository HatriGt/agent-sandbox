import * as React from "react";
import { AlertTriangle, Brain, Check, ChevronRight, Circle, CircleDot, Clock, FilePen, FilePlus2, FileText, Globe, ListChecks, Loader2, MessageCircleQuestion, Search, Terminal, Wrench } from "lucide-react";
import type { PlanItem as PlanStep } from "@/lib/trace";
import { resultSummary, type TraceEvent } from "@/lib/trace";
import { parseQuestion } from "@/lib/question";
import { Pause as PauseIcon } from "lucide-react";
import { parseTestReport } from "@/lib/testReport";
import { TestResultsCard } from "./TestResultsCard";
import { AnimatePresence, motion } from "motion/react";
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
    <div className="enter flex items-center gap-3 py-0.5">
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

/** One glyph per tool family, so a folded group reads as "what kind of work" before you open it. */
function toolIcon(name: string) {
  const n = name.toLowerCase();
  if (SHELL_TOOLS.has(name)) return Terminal;
  if (n === "write" || n === "notebookedit") return FilePlus2;
  if (n === "edit" || n === "multiedit") return FilePen;
  if (n === "read") return FileText;
  if (n === "glob" || n === "grep" || n === "search" || n === "ls") return Search;
  if (n.startsWith("web")) return Globe;
  if (n === "todowrite" || n === "task") return ListChecks;
  return Wrench;
}

/**
 * Consecutive tool calls fold into one "steps" row that expands to the individual panels — the
 * thread reads as prose punctuated by work, not a wall of tool rows. A single tool renders inline.
 *
 * Folded: a stack of family glyphs, "N steps", then a chip per tool name with its count, a failure
 * badge, and the chevron. Open: a numbered timeline with a connector line; each node completes as
 * its result lands. `live` marks the in-progress turn: tools without a result are still running.
 */
export function ToolGroup({ events, live }: { events: ToolEvent[]; live?: boolean }) {
  // Results worth reading (a test run, a PR URL) must not hide behind the fold: open those groups.
  const notable = React.useMemo(
    () => events.some((e) => !!parseTestReport(e.result) || /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(e.result ?? "")),
    [events]
  );
  const [open, setOpen] = React.useState(notable);
  React.useEffect(() => {
    if (notable) setOpen(true);
  }, [notable]);
  const anyRunning = !!live && events.some((e) => !e.result);
  const failed = events.filter((e) => e.failed).length;
  const done = events.filter((e) => !!e.result).length;
  if (events.length === 1) return <ToolItem event={events[0]} live={anyRunning} />;

  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  const families = [...new Set(events.map((e) => toolIcon(e.name)))].slice(0, 3);

  return (
    <div className="enter min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "group/steps flex max-w-full cursor-pointer items-center gap-2.5 rounded-full border py-1 pr-2.5 pl-1.5 text-left text-meta transition-[background-color,border-color,box-shadow] duration-200",
          anyRunning
            ? "border-live/30 bg-live/6 text-foreground shadow-[0_0_0_3px_oklch(0.62_0.19_255/0.08)]"
            : open
              ? "bg-muted/60 border-line-strong text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted hover:border-line-strong bg-card"
        )}
      >
        {/* Family glyph stack — overlapping discs, like avatars. */}
        <span className="flex -space-x-1.5">
          {families.map((Icon, i) => (
            <span
              key={i}
              className={cn(
                "ring-card grid size-5 place-items-center rounded-full ring-2 transition-transform duration-200 group-hover/steps:translate-x-0",
                anyRunning ? "bg-live/15 text-live" : "bg-muted text-foreground/70"
              )}
              style={{ zIndex: families.length - i }}
            >
              <Icon className="size-3" aria-hidden />
            </span>
          ))}
        </span>
        <span className="font-medium tabular-nums">
          {anyRunning ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="text-live size-3.5 animate-spin" aria-hidden />
              {done}/{events.length} steps
            </span>
          ) : (
            `${events.length} steps`
          )}
        </span>
        <span className="hidden min-w-0 items-center gap-1 sm:flex">
          {[...counts.entries()].slice(0, 4).map(([name, n]) => (
            <span key={name} className="bg-muted text-muted-foreground stamp rounded-md px-1.5 py-px">
              {name}
              {n > 1 && <span className="opacity-60"> ×{n}</span>}
            </span>
          ))}
          {counts.size > 4 && <span className="stamp text-muted-foreground/70">+{counts.size - 4}</span>}
        </span>
        {failed > 0 && !anyRunning && (
          <span className="bg-destructive/10 text-destructive label rounded-md px-1.5 py-px">{failed} failed</span>
        )}
        <ChevronRight
          className={cn("ml-0.5 size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]", open && "rotate-90")}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative mt-2 overflow-hidden pl-1"
          >
            {events.map((e, i) => {
              const running = !!live && !e.result;
              const last = i === events.length - 1;
              return (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(i, 8) * 0.03 }}
                  className="relative flex gap-3 pb-2.5 last:pb-0"
                >
                  {/* Node + connector */}
                  <span className="relative flex w-5 shrink-0 flex-col items-center">
                    <span
                      className={cn(
                        "z-10 mt-1.5 grid size-4 place-items-center rounded-full border text-[9px] font-semibold tabular-nums",
                        running
                          ? "border-live bg-live/15 text-live"
                          : e.failed
                            ? "border-destructive/60 bg-destructive/10 text-destructive"
                            : "border-line-strong bg-card text-muted-foreground"
                      )}
                    >
                      {running ? <span className="bg-live size-1.5 animate-pulse rounded-full" /> : e.failed ? "!" : i + 1}
                    </span>
                    {!last && <span className="bg-border absolute top-5 bottom-0 w-px" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <ToolItem event={e} live={running} />
                  </div>
                </motion.li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A shell command as a terminal panel: `$ cmd`, then its output, on the dark trace ground. */
function ShellItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const hasOutput = !!event.result;
  const lines = event.result ? lineCount(event.result) : 0;
  // A test run renders as a results card (summary chips + per-file cases) with the terminal panel
  // demoted to "raw output"; anything else is the plain terminal.
  const report = React.useMemo(() => (live ? null : parseTestReport(event.result)), [event.result, live]);
  if (report) {
    return (
      <div className="min-w-0 flex flex-col gap-2">
        <p className="stamp text-muted-foreground truncate pl-1">
          <span className="text-ok mr-1.5 select-none">$</span>
          {event.arg}
        </p>
        <TestResultsCard report={report} onRaw={() => setOpen((v) => !v)} rawOpen={open} />
        {open && (
          <pre className="bg-trace text-trace-fg/85 max-h-80 overflow-auto rounded-lg border border-white/8 px-3 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap">
            {event.result}
          </pre>
        )}
      </div>
    );
  }
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
    <div className="enter flex flex-col items-end gap-1.5">
      <span className="label text-muted-foreground pr-1">{label}</span>
      <div className="bg-muted text-foreground max-w-[min(72%,60ch)] rounded-2xl rounded-br-md px-4 py-2.5 text-body leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

/**
 * A follow-up the operator sent while the agent was mid-turn. The controller holds it and delivers it
 * the moment the current turn finishes; until then it sits in the thread, visibly pending, with a way
 * to take it back.
 */
export function QueuedItem({ text, onCancel }: { text: string; onCancel?: () => void }) {
  return (
    <div className="enter flex flex-col items-end gap-1.5">
      <span className="label text-muted-foreground flex items-center gap-1.5 pr-1">
        <Clock className="size-3" aria-hidden />
        Queued · delivers when this turn finishes
        {onCancel && (
          <button type="button" onClick={onCancel} className="hover:text-foreground cursor-pointer underline-offset-2 hover:underline">
            cancel
          </button>
        )}
      </span>
      <div className="text-foreground/80 max-w-[min(72%,60ch)] rounded-2xl rounded-br-md border border-dashed px-4 py-2.5 text-body leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

/**
 * A side question and its answer: a separate read-only helper answering ABOUT the run. Same thread,
 * unmistakably another voice, and it says so every time — the agent never sees this exchange.
 */
export function ObserverItem({ question, answer }: { question: string; answer?: string }) {
  return (
    <div className="enter flex flex-col gap-1.5">
      <span className="label text-muted-foreground flex items-center gap-1.5">
        <MessageCircleQuestion className="size-3" aria-hidden />
        Side question · answered from the sandbox, not by the agent
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

/**
 * Extended thinking, folded. Collapsed by default to a one-line "Thought about …" with the first
 * sentence as a teaser; expands to the full reasoning in a quieter voice than the agent's prose. While
 * live it shows the shimmer of a thought still forming.
 */
export function ThinkingItem({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const words = text.trim().split(/\s+/).length;
  const teaser = text.trim().split(/(?<=[.!?])\s+/)[0]?.slice(0, 120) ?? "";
  return (
    <div className="enter min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "group flex max-w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left text-meta transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
      >
        <Brain className={cn("size-3.5 shrink-0", live && "text-live breathe")} aria-hidden />
        <span className="font-medium">{live ? "Thinking" : "Thought"}</span>
        {!open && <span className="min-w-0 truncate italic opacity-80">{teaser}</span>}
        <span className="label shrink-0 opacity-60">{words} words</span>
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="text-muted-foreground mt-1 ml-2 border-l pl-4 text-meta leading-relaxed whitespace-pre-wrap">{text}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The agent's plan (TodoWrite), rendered as a live checklist: done steps ticked, the active step
 * highlighted with a breathing marker, a progress fraction in the corner. Steps animate as their state
 * flips. Only the LATEST plan is rendered (the thread passes `superseded` for older snapshots).
 */
export function PlanCard({ items, live }: { items: PlanStep[]; live?: boolean }) {
  const done = items.filter((i) => i.state === "done").length;
  const [open, setOpen] = React.useState(true);
  const allDone = done === items.length;
  return (
    <div className="enter bg-card max-w-[60ch] rounded-xl border shadow-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left"
      >
        {allDone ? (
          <Check className="text-ok size-4 shrink-0" strokeWidth={2.5} aria-hidden />
        ) : (
          <Loader2 className={cn("text-live size-4 shrink-0", live && "animate-spin")} aria-hidden />
        )}
        <span className="text-foreground flex-1 text-body font-medium">{allDone ? "Plan complete" : live ? "Agent is working the plan" : "Plan"}</span>
        <span className="text-muted-foreground tabular text-meta">
          {done}/{items.length}
        </span>
        <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t"
          >
            {items.map((it, i) => (
              <motion.li
                key={`${i}-${it.text}`}
                layout
                className={cn(
                  "flex items-center gap-3 px-4 py-2 text-body",
                  it.state === "active" ? "text-foreground font-medium" : it.state === "done" ? "text-muted-foreground" : "text-foreground/80"
                )}
              >
                {it.state === "done" ? (
                  <span className="bg-ok/15 text-ok grid size-5 shrink-0 place-items-center rounded-md">
                    <Check className="size-3" strokeWidth={3} aria-hidden />
                  </span>
                ) : it.state === "active" ? (
                  <span className="bg-live/12 text-live grid size-5 shrink-0 place-items-center rounded-md">
                    <CircleDot className={cn("size-3", live && "breathe")} strokeWidth={2.5} aria-hidden />
                  </span>
                ) : (
                  <span className="text-muted-foreground/60 grid size-5 shrink-0 place-items-center rounded-md border">
                    <Circle className="size-2" aria-hidden />
                  </span>
                )}
                <span className={cn("min-w-0 flex-1", it.state === "done" && "line-through decoration-border")}>{it.text}</span>
                {it.state === "active" && <span className="label text-live shrink-0">in progress</span>}
              </motion.li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A question the agent asked earlier, kept in the transcript with the options it offered and the
 * answer you gave — so scrolling back shows the decision, not just a bare reply. Read-only; the
 * chosen option (or your free-text answer) is highlighted.
 */
export function AnsweredQuestionItem({ question, answer }: { question: string; answer: string }) {
  const parsed = React.useMemo(() => parseQuestion(question), [question]);
  const chosen = parsed.options.findIndex((o) => o.trim().toLowerCase() === answer.trim().toLowerCase());
  return (
    <div className="enter flex flex-col gap-1.5">
      <span className="label text-muted-foreground flex items-center gap-1.5">
        <PauseIcon className="size-3" strokeWidth={2.5} aria-hidden />
        The agent asked — you answered
      </span>
      <div className="bg-card max-w-[72ch] rounded-xl border">
        <div className="px-4 pt-3 pb-2">
          <p className="text-foreground text-body font-medium text-balance">{parsed.title || question}</p>
          {parsed.context && <p className="text-muted-foreground mt-1 line-clamp-3 text-meta whitespace-pre-wrap">{parsed.context}</p>}
        </div>
        {parsed.options.length > 0 && (
          <ul className="flex flex-col gap-1 px-2.5 pb-2">
            {parsed.options.map((opt, i) => {
              const on = i === chosen;
              return (
                <li key={opt} className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-1.5 text-meta", on ? "border-attention bg-attention/12 text-foreground font-medium" : "border-transparent text-muted-foreground")}>
                  <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-attention bg-attention text-attention-ink" : "border-line-strong")} aria-hidden>
                    {on && <Check className="size-2.5" strokeWidth={3} />}
                  </span>
                  {opt}
                </li>
              );
            })}
          </ul>
        )}
        {chosen < 0 && (
          <div className="border-t px-4 py-2">
            <p className="label text-muted-foreground mb-0.5">Your answer</p>
            <p className="text-foreground text-meta whitespace-pre-wrap">{answer}</p>
          </div>
        )}
      </div>
    </div>
  );
}
