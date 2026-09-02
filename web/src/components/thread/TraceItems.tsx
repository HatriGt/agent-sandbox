import * as React from "react";
import { AlertTriangle, Brain, Check, ChevronRight, Clock, FileText, Loader2, MessageCircleQuestion, Terminal } from "lucide-react";
import { resultSummary, type TraceEvent } from "@/lib/trace";
export { PlanCard, PlanDock } from "./PlanBoard";
import { parseQuestion } from "@/lib/question";
import { Pause as PauseIcon } from "lucide-react";
import { parseTestReport } from "@/lib/testReport";
import { TestResultsCard } from "./TestResultsCard";
import { AnimatePresence, motion } from "motion/react";
import { Markdown } from "@/components/ui/markdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { ATTACHMENT_RE, useSession } from "@/lib/session-context";
import { SkillMark } from "@/lib/skillGlyph";
import { parseMcpName } from "@/lib/mcp";
import { McpItem } from "./McpItem";
import { PanelFold, TraceOutput } from "./TraceOutput";
import { Lightbox } from "@/components/ui/lightbox";

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
      {detail && <span className="text-faint truncate text-micro">{detail}</span>}
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
  const mcp = parseMcpName(event.name);
  if (mcp) return <McpItem event={event} call={mcp} live={live} />;
  return SHELL_TOOLS.has(event.name) ? <ShellItem event={event} live={live} /> : <StepItem event={event} live={live} />;
}

/**
 * Consecutive tool calls fold into one quiet disclosure line — `› Worked · 4 steps · 3 files` — the
 * way a good transcript summarises effort without interrupting the prose. Open, it becomes a
 * numbered timeline of the individual calls. While the turn is live it reads `Working · 2/4 steps`
 * with a breathing dot; failures surface as a red count. A single tool renders inline.
 */
export function ToolGroup({ events, live }: { events: ToolEvent[]; live?: boolean }) {
  // Results worth reading (a test run, a PR URL) must not hide behind the fold: open those groups.
  // …and a FAILED external (MCP) call must never hide behind the fold: a server silently missing
  // or erroring is precisely the thing an operator otherwise cannot see.
  const notable = React.useMemo(
    () =>
      events.some(
        (e) =>
          !!parseTestReport(e.result) ||
          /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(e.result ?? "") ||
          (!!e.failed && !!parseMcpName(e.name))
      ),
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

  // Files touched (Write/Edit targets) and commands run — the two facts worth a glance.
  const files = new Set(events.filter((e) => /^(write|edit|multiedit|notebookedit)$/i.test(e.name) && e.arg).map((e) => e.arg!.split(/\s/)[0]));
  const commands = events.filter((e) => SHELL_TOOLS.has(e.name)).length;
  const reads = events.filter((e) => /^(read|glob|grep|search|ls|webfetch|websearch)$/i.test(e.name)).length;
  // External calls, grouped by server — "3 hana-qa calls" is a headline fact, not a footnote.
  const mcpByServer = new Map<string, number>();
  for (const e of events) {
    const m = parseMcpName(e.name);
    if (m) mcpByServer.set(m.server, (mcpByServer.get(m.server) ?? 0) + 1);
  }
  const facts = [
    `${events.length} steps`,
    files.size ? `${files.size} ${files.size === 1 ? "file" : "files"}` : null,
    commands ? `${commands} ${commands === 1 ? "command" : "commands"}` : null,
    ...[...mcpByServer].map(([srv, n]) => `${n} ${srv} ${n === 1 ? "call" : "calls"}`),
    !files.size && !commands && !mcpByServer.size && reads ? `${reads} lookups` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="enter min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "group/steps -ml-1.5 flex max-w-full cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-1.5 text-left text-meta transition-colors",
          anyRunning ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
        )}
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]", open && "rotate-90")}
          aria-hidden
        />
        {anyRunning ? (
          <span className="flex items-center gap-2 font-medium">
            <span className="bg-live breathe size-1.5 rounded-full" aria-hidden />
            Working
            <span className="text-muted-foreground font-normal tabular-nums">
              {done}/{events.length} steps
            </span>
          </span>
        ) : (
          <span className="font-medium">Worked</span>
        )}
        {!anyRunning && (
          <span className="stamp text-muted-foreground min-w-0 truncate">
            {facts.map((f, i) => (
              <React.Fragment key={f}>
                {i > 0 && <span className="mx-1 opacity-50">·</span>}
                {f}
              </React.Fragment>
            ))}
          </span>
        )}
        {failed > 0 && !anyRunning && <span className="text-destructive stamp">{failed} failed</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative mt-1.5 overflow-hidden pl-0.5"
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
                  className="relative flex gap-3 pb-2 last:pb-0"
                >
                  <span className="relative flex w-4 shrink-0 flex-col items-center">
                    <span
                      className={cn(
                        "z-10 mt-2 grid size-3.5 place-items-center rounded-full border text-[8.5px] font-semibold tabular-nums",
                        running
                          ? "border-live bg-live/20 text-live"
                          : e.failed
                            ? "border-destructive/60 bg-destructive/10 text-destructive"
                            : "border-line-strong bg-card text-muted-foreground"
                      )}
                    >
                      {running ? <span className="bg-live size-1.5 animate-pulse rounded-full" /> : e.failed ? "!" : i + 1}
                    </span>
                    {!last && <span className="bg-border absolute top-[1.4rem] bottom-0 w-px" aria-hidden />}
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
        {open && <TraceOutput text={event.result!} mode="term" className="bg-trace rounded-md border border-white/8" />}
      </div>
    );
  }
  return (
    <div className="enter min-w-0">
      <div
        className={cn(
          "bg-trace overflow-hidden rounded-md border border-white/8",
          live && "ring-live/40 ring-1"
        )}
      >
        <div className="flex items-center gap-2 border-b border-white/8 px-3 py-1.5">
          {live ? (
            <Loader2 className="text-live size-3 shrink-0 animate-spin" aria-hidden />
          ) : event.failed ? (
            <AlertTriangle className="text-destructive size-3 shrink-0" aria-hidden />
          ) : (
            <Terminal className="text-trace-fg/60 size-3 shrink-0" aria-hidden />
          )}
          <span className="label text-trace-fg/60">{event.name}</span>
          {live && <span className="label text-live">running</span>}
          {!live && event.failed && <span className="label text-destructive">failed</span>}
          {hasOutput && <PanelFold open={open} text={event.result!} onToggle={() => setOpen((v) => !v)} />}
        </div>
        <pre className="text-trace-fg px-3 py-2 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]">
          <span className="text-ok mr-2 shrink-0 select-none" aria-hidden>
            $
          </span>
          {event.arg ?? ""}
          {live && !hasOutput && <span className="caret text-live" aria-hidden>▍</span>}
        </pre>
        {hasOutput && open && <TraceOutput text={event.result!} mode="term" className="border-t border-white/8" />}
        {hasOutput && !open && (
          <button type="button" onClick={() => setOpen(true)} className="text-trace-fg/60 hover:text-trace-fg flex w-full cursor-pointer items-center gap-2 border-t border-white/8 px-3 py-1.5 text-left font-mono text-micro">
            <span className="text-trace-fg/40 select-none">›</span>
            <span className="truncate">{resultSummary(event.result)}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Non-shell tool (Write / Read / Edit / Grep …): compact step row, arg as a code chip, output folded. */
function StepItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const summary = resultSummary(event.result);
  const lines = event.result ? lineCount(event.result) : 0;

  return (
    <div className="enter min-w-0">
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
            {lines > 1 && <span className="label text-faint ml-auto shrink-0">{lines} lines</span>}
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
          <pre className="bg-trace text-trace-fg/80 mt-2 ml-6 max-h-72 overflow-auto rounded-md border border-white/8 px-3 py-2 font-mono text-code whitespace-pre-wrap">
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
/**
 * Some "speech" is really a dump the formatter could not attribute to a tool — a diff, a `cat -n`
 * listing, a here-doc. Rendered as markdown it becomes bullet salad. Detect it by shape and show a
 * collapsed raw block instead.
 */
export function looksLikeDump(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 6) return /(^|\n)(diff --git|<<PROMPT_EOF|@@ -\d)/.test(text);
  const dumpish = lines.filter((l) => /^\s*(\d{1,5}[\s\t]|[+-]{3}\s|@@ |diff --git|index [0-9a-f]{6,}|[{}[\];]\s*$|<<|\$ )/.test(l) || /^\s{4,}\S/.test(l)).length;
  return dumpish / lines.length >= 0.5;
}

function DumpItem({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const n = text.split("\n").length;
  return (
    <div className="enter min-w-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="group -ml-1.5 flex max-w-full cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-1.5 text-left text-meta text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-90")} aria-hidden />
        <FileText className="size-3.5 shrink-0" aria-hidden />
        <span className="font-medium">Raw output</span>
        <span className="stamp">{n} lines</span>
        {!open && <span className="stamp min-w-0 truncate">{text.split("\n").find((l) => l.trim())?.trim().slice(0, 80)}</span>}
      </button>
      {open && <pre className="bg-trace text-trace-fg/80 mt-1.5 max-h-96 overflow-auto rounded-md border border-white/8 px-3 py-2 font-mono text-code whitespace-pre-wrap">{text}</pre>}
    </div>
  );
}

export const SayItem = React.memo(function SayItem({ text, live, label = true }: { text: string; live?: boolean; label?: boolean }) {
  if (!live && looksLikeDump(text)) return <DumpItem text={text} />;
  return (
    <div className="enter min-w-0">
      {(label || live) && (
        <span className="label text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", live ? "bg-live breathe" : "bg-faint")} aria-hidden />
          Agent
        </span>
      )}
      <div className="text-foreground min-w-0">
        {live ? <StreamingMarkdown text={text} /> : <Markdown className="prose-agent">{text}</Markdown>}
      </div>
    </div>
  );
});

/**
 * The "working…" beat between visible outputs — a live status pill, not dead air. It names what the
 * agent is doing right now (`Bash npm test`, `thinking`), morphs as that changes (the old detail
 * slides out, the new one in), and carries an elapsed counter so a stall is visible as a number that
 * keeps climbing next to a detail that stopped changing.
 */
export function WorkingIndicator({ label = "Working", detail }: { label?: string; detail?: string | null }) {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const start = Date.now();
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);
  const mins = Math.floor(elapsed / 60);
  const time = elapsed < 5 ? null : mins > 0 ? `${mins}m ${elapsed % 60}s` : `${elapsed}s`;
  return (
    <div className="enter flex items-center gap-2.5" aria-live="polite">
      <div className="bg-card inline-flex max-w-full items-center gap-2.5 rounded-full border py-1.5 pr-3.5 pl-3 text-meta shadow-e1">
        <span className="text-live flex shrink-0 items-center gap-1" aria-hidden>
          <span className="dot dot-1 bg-current size-1.5 rounded-full" />
          <span className="dot dot-2 bg-current size-1.5 rounded-full" />
          <span className="dot dot-3 bg-current size-1.5 rounded-full" />
        </span>
        <span className="text-foreground shrink-0 font-medium">{label}</span>
        <AnimatePresence mode="popLayout" initial={false}>
          {detail && (
            <motion.code
              key={detail}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="text-muted-foreground bg-muted min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-micro"
            >
              {detail}
            </motion.code>
          )}
        </AnimatePresence>
        {time && (
          <span className="text-faint shrink-0 text-micro tabular-nums" aria-label={`elapsed ${time}`}>
            {time}
          </span>
        )}
      </div>
    </div>
  );
}

/** Your turn: the one bubble. A muted fill, right-aligned, so the primary ink stays for actions. */
export function YouItem({ text, label = "You" }: { text: string; label?: string }) {
  // Image attachments ride in the message as in-box paths; show them as thumbnails, not as text.
  const attachments = React.useMemo(() => [...new Set(text.match(ATTACHMENT_RE) ?? [])], [text]);
  const body = React.useMemo(() => (attachments.length ? text.replace(/\n*Attached images? \(open with the Read tool\):[\s\S]*$/, "").trim() : text), [text, attachments.length]);
  // A leading /skill token renders as a tinted tag, not prose — the same face it had in the composer.
  const skillMatch = body.match(/^\/([a-z0-9][a-z0-9-]{0,49})(?:\s+([\s\S]*))?$/);
  const skillName = skillMatch?.[1] ?? null;
  const rest = skillMatch ? (skillMatch[2] ?? "").trim() : body;
  return (
    <div className="enter flex flex-col items-end gap-1.5">
      <span className="label text-muted-foreground pr-1">{label}</span>
      {attachments.length > 0 && (
        <div className="flex max-w-[min(72%,60ch)] flex-wrap justify-end gap-1.5">
          {attachments.map((p) => (
            <AttachmentImage key={p} path={p} />
          ))}
        </div>
      )}
      {body && (
        <div className="bg-muted text-foreground max-w-[min(72%,60ch)] rounded-xl rounded-br-md px-4 py-2.5 text-lead whitespace-pre-wrap">
          {skillName ? (
            <>
              <span className="border-live/30 bg-live/10 text-live stamp mr-1.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-md border px-1.5 py-0.5 align-middle text-micro font-semibold">
                <SkillMark name={skillName} size={13} />
                /{skillName}
              </span>
              {rest}
            </>
          ) : (
            body
          )}
        </div>
      )}
    </div>
  );
}

/** A pasted image, fetched through the token-guarded artifact route; click to open full size. */
function AttachmentImage({ path }: { path: string }) {
  const session = useSession();
  const [src, setSrc] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (!session) return;
    let url: string | null = null;
    let cancelled = false;
    api
      .artifactBlob(session, path.replace(/^\/workspace\//, ""))
      .then((b) => {
        if (cancelled) return; // resolved after unmount / path change: nothing to show, nothing to leak
        url = URL.createObjectURL(b);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [session, path]);
  const name = path.slice(path.lastIndexOf("/") + 1);
  const [open, setOpen] = React.useState(false);
  if (failed) return <span className="stamp text-muted-foreground rounded-md border px-2 py-1">{name}</span>;
  return (
    <>
      <button type="button" onClick={() => src && setOpen(true)} title={name} aria-label={`Open ${name}`} className={cn("bg-muted hover:border-line-strong block max-h-56 max-w-[16rem] cursor-zoom-in overflow-hidden rounded-xl border transition-[border-color,transform] hover:scale-[1.01]", !src && "size-24 animate-pulse")}>
        {src && <img src={src} alt={name} className="max-h-56 max-w-[16rem] object-contain" />}
      </button>
      <Lightbox src={src} name={name} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * A follow-up the operator sent while the agent was mid-turn. The controller holds it and delivers it
 * the moment the current turn finishes; until then it sits in the thread, visibly pending, with a way
 * to take it back.
 */
export function QueuedItem({
  text,
  onCancel,
  onSendNow,
  sending,
}: {
  text: string;
  onCancel?: () => void;
  onSendNow?: () => void;
  sending?: boolean;
}) {
  // Send-now interrupts the running turn, so it arms on the first click and fires on the second.
  const [armed, setArmed] = React.useState(false);
  return (
    <div className="enter flex flex-col items-end gap-1.5">
      <span className="label text-muted-foreground flex items-center gap-1.5 pr-1">
        <Clock className="size-3" aria-hidden />
        {sending ? "Interrupting the turn to deliver this…" : "Queued · delivers when this turn finishes"}
        {!sending && onSendNow && (
          <button
            type="button"
            onClick={() => (armed ? onSendNow() : setArmed(true))}
            onBlur={() => setArmed(false)}
            title="Stop the current turn and deliver this message immediately"
            className={
              armed
                ? "text-destructive cursor-pointer font-medium underline underline-offset-2"
                : "hover:text-foreground cursor-pointer underline-offset-2 hover:underline"
            }
          >
            {armed ? "stop the turn & send?" : "send now"}
          </button>
        )}
        {!sending && onCancel && (
          <button type="button" onClick={onCancel} className="hover:text-foreground cursor-pointer underline-offset-2 hover:underline">
            cancel
          </button>
        )}
      </span>
      <div className="text-foreground max-w-[min(72%,60ch)] rounded-xl rounded-br-md border border-dashed px-4 py-2.5 text-body leading-relaxed whitespace-pre-wrap">
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
          "group -ml-1.5 flex max-w-full cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-1.5 text-left text-meta transition-colors",
          live ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
        )}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]", open && "rotate-90")} aria-hidden />
        <Brain className={cn("size-3.5 shrink-0", live && "text-live breathe")} aria-hidden />
        <span className={cn("font-medium", live && "shimmer-text")}>{live ? "Thinking" : "Thought"}</span>
        {!open && <span className={cn("stamp min-w-0 truncate", live ? "shimmer-text" : "text-muted-foreground")}>{teaser}</span>}
        <span className="stamp text-muted-foreground shrink-0">{words} words</span>
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
      <div className="bg-card max-w-[72ch] rounded-xl shadow-e1">
        <div className="px-4 pt-3 pb-2">
          <p className="text-foreground text-body font-medium text-balance">{parsed.title || question}</p>
          {parsed.context && <p className="text-muted-foreground mt-1 line-clamp-3 text-meta whitespace-pre-wrap">{parsed.context}</p>}
        </div>
        {parsed.options.length > 0 && (
          <ul className="flex flex-col gap-1 px-2.5 pb-2">
            {parsed.options.map((opt, i) => {
              const on = i === chosen;
              return (
                <li key={opt} className={cn("flex items-center gap-2.5 rounded-md border px-3 py-1.5 text-meta", on ? "border-attention bg-attention/10 text-foreground font-medium" : "border-transparent text-muted-foreground")}>
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
