import * as React from "react";
import { AlertTriangle, Brain, Check, ChevronRight, Clock, Copy, FileText, Loader2, MessageCircleQuestion, Terminal, Undo2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resultSummary, type TraceEvent } from "@/lib/trace";
export { PlanCard, PlanDock } from "./PlanBoard";
import { parseQuestion } from "@/lib/question";
import { Pause as PauseIcon } from "lucide-react";
import { parseTestReport } from "@/lib/testReport";
import { TestResultsCard } from "./TestResultsCard";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Markdown } from "@/components/ui/markdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { ATTACHMENT_RE, useSession } from "@/lib/session-context";
import { SkillMark } from "@/lib/skillGlyph";
import { parseMcpName } from "@/lib/mcp";
import { McpItem } from "./McpItem";
import { PanelFold, TraceOutput, VisualRawSwitch, useOutputVisual } from "./TraceOutput";
import { Lightbox } from "@/components/ui/lightbox";
import { Collapse } from "@/components/ui/collapse";

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

/* ── Timing ──────────────────────────────────────────────────────────────────────────────────────
 * Times come from the formatter's ⟦at⟧ stamps (see src/trace.ts). Every field is optional: a log
 * written before the stamps renders exactly as it always did, just without times. */

/** `840ms` · `1.2s` · `14s` · `3m 4s` · `1h 12m` — compact enough for a chip. */
export function formatDuration(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 1000) return `${Math.round(v)}ms`;
  const s = v / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.floor(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.floor(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `just now` · `4m ago` · `2h ago`, then the clock time (and the date once it is not today). */
function relativeTime(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 6 * 3_600_000) return `${Math.floor(d / 3_600_000)}h ago`;
  const t = new Date(at);
  const time = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return t.toDateString() === new Date(now).toDateString() ? time : `${t.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

// One shared interval per cadence, not one per mounted row: a 60-step group must not run 60 timers.
const tickers = new Map<number, { subs: Set<() => void>; id: number }>();
function subscribeTick(every: number, cb: () => void) {
  let t = tickers.get(every);
  if (!t) {
    const subs = new Set<() => void>();
    t = { subs, id: window.setInterval(() => subs.forEach((f) => f()), every) };
    tickers.set(every, t);
  }
  t.subs.add(cb);
  return () => {
    t!.subs.delete(cb);
    if (!t!.subs.size) {
      window.clearInterval(t!.id);
      tickers.delete(every);
    }
  };
}
/** Wall clock that re-renders every `every` ms while `active`; frozen (and timer-free) otherwise. */
function useNow(active: boolean, every = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    return subscribeTick(every, () => setNow(Date.now()));
  }, [active, every]);
  return now;
}

/** A quiet time next to a label: relative text, the full date and time on hover. */
function TimeStamp({ at, className }: { at: number; className?: string }) {
  const now = useNow(true, 30_000);
  const full = new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
  return (
    <time dateTime={new Date(at).toISOString()} title={full} className={cn("stamp text-faint tabular-nums", className)}>
      {relativeTime(at, now)}
    </time>
  );
}

/**
 * A step's duration chip. Done: the measured `ms`. Running: a live elapsed that ticks each second,
 * counted from the call's own stamp (or from when the row mounted, for a log without stamps).
 */
function DurationChip({ event, running, className }: { event: ToolEvent; running?: boolean; className?: string }) {
  const mounted = React.useRef(Date.now());
  const now = useNow(!!running);
  const ms = running ? now - (event.at ?? mounted.current) : event.ms;
  if (ms === undefined) return null;
  return (
    <span
      className={cn("text-micro shrink-0 tabular-nums", running ? "text-live" : event.failed ? "text-destructive/80" : "text-faint", className)}
      title={running ? "Running for" : "Took"}
    >
      {formatDuration(ms)}
    </span>
  );
}

/** Wall-clock span of a group: first call issued → last result in. Parallel calls are not double-counted. */
function groupSpan(events: ToolEvent[]): number | undefined {
  const timed = events.filter((e) => e.at !== undefined && e.ms !== undefined);
  if (!timed.length) return undefined;
  const start = Math.min(...timed.map((e) => e.at!));
  const end = Math.max(...timed.map((e) => e.at! + e.ms!));
  return end - start;
}

/** Spring for disclosure height and row entry: settles quickly, no visible overshoot. */
const SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.8 } as const;

/**
 * A status glyph that pops (scale 0.6 → 1) when it CHANGES — running → done, running → failed —
 * so the moment a step lands is felt, not just seen. `state` keys the swap; reduced motion swaps flat.
 */
function StatusGlyph({ state, children, className }: { state: string; children: React.ReactNode; className?: string }) {
  const still = useReducedMotion();
  return (
    <span className={cn("grid shrink-0 place-items-center", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          className="col-start-1 row-start-1 grid place-items-center"
          initial={still ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={still ? { opacity: 0, transition: { duration: 0 } } : { scale: 0.6, opacity: 0, transition: { duration: 0.1 } }}
          transition={still ? { duration: 0 } : { type: "spring", stiffness: 600, damping: 22 }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** How many lines a result has, for the fold's label. */
function lineCount(result: string): number {
  return result.replace(/\n+$/, "").split("\n").length;
}

function ToolItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const mcp = parseMcpName(event.name);
  if (mcp) return <McpItem event={event} call={mcp} live={live} />;
  if (event.name === "Skill") return <SkillItem event={event} live={live} />;
  return SHELL_TOOLS.has(event.name) ? <ShellItem event={event} live={live} /> : <StepItem event={event} live={live} />;
}

/** The skill name of a Skill tool event: the arg when the formatter carried it, else the result's "Launching skill: X". */
function skillOf(event: ToolEvent): string | null {
  const fromArg = event.arg?.match(/^[a-z0-9][a-z0-9-]{0,49}/)?.[0];
  if (fromArg) return fromArg;
  return event.result?.match(/Launching skill:\s*([a-z0-9][a-z0-9-]{0,49})/i)?.[1] ?? null;
}

/**
 * A skill firing is a MODE CHANGE, not another tool step: from here on the agent follows that
 * playbook. So it renders as a section marker — a compact pill sitting on a hairline rule — not as
 * one more icon row competing with the tool timeline. The pill carries the skill's own glyph and
 * its /name; the rule says "the steps below belong to this". Failure turns the pill red with the
 * reason; while launching the glyph gives way to a spinner. Any real launch output folds under it.
 */
function SkillItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const name = skillOf(event);
  const extra = (event.result ?? "").replace(/^\s*Launching skill:.*$/im, "").trim();
  const [open, setOpen] = React.useState(false);
  return (
    <div className="enter min-w-0">
      <div className="flex min-w-0 items-center gap-3" role={extra ? undefined : "note"}>
        <span className={cn("rule-draw rule-draw-r h-px w-6 shrink-0", event.failed ? "bg-destructive/30" : "bg-live/30")} aria-hidden />
        <button
          type="button"
          onClick={() => extra && setOpen((v) => !v)}
          disabled={!extra}
          aria-expanded={extra ? open : undefined}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-full border py-1 pr-3 pl-2",
            event.failed ? "border-destructive/30 bg-destructive/5" : "border-live/25 bg-live/5",
            extra && "cursor-pointer hover:bg-muted"
          )}
        >
          <span className={cn("grid size-4.5 shrink-0 place-items-center", event.failed ? "text-destructive" : "text-live")} aria-hidden>
            {live ? <Loader2 className="size-3.5 animate-spin" /> : event.failed ? <AlertTriangle className="size-3.5" /> : name ? <SkillMark name={name} size={14} /> : <ChevronRight className="size-3.5" />}
          </span>
          <span className={cn("shrink-0 font-mono text-meta font-semibold", event.failed ? "text-destructive" : "text-foreground")}>
            {name ? `/${name}` : "skill"}
          </span>
          <span className={cn("min-w-0 truncate text-micro", event.failed ? "text-destructive/80" : "text-faint")}>
            {live ? "loading…" : event.failed ? "failed to launch" : "playbook"}
          </span>
          {extra && <ChevronRight className={cn("text-muted-foreground size-3 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden />}
        </button>
        <span className={cn("rule-draw h-px min-w-6 flex-1", event.failed ? "bg-destructive/30" : "bg-live/30")} aria-hidden />
      </div>
      <Collapse open={open && !!extra}>
        <pre className="bg-trace text-trace-fg/80 mt-2 ml-9 max-h-72 overflow-auto rounded-md border border-white/8 px-3 py-2 font-mono text-code whitespace-pre-wrap">{extra}</pre>
      </Collapse>
    </div>
  );
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
  const still = useReducedMotion();
  React.useEffect(() => {
    if (notable) setOpen(true);
  }, [notable]);
  const anyRunning = !!live && events.some((e) => !e.result);
  const failed = events.filter((e) => e.failed).length;
  const done = events.filter((e) => !!e.result).length;
  const span = groupSpan(events);
  // While working, the group's clock runs from its first stamped call.
  const firstAt = events.find((e) => e.at !== undefined)?.at;
  const now = useNow(anyRunning && firstAt !== undefined);
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
  // Skills that fired inside the fold: named, because "the playbook ran" is the headline fact.
  const skillsUsed = [...new Set(events.filter((e) => e.name === "Skill").map((e) => skillOf(e)).filter(Boolean))] as string[];
  // One or two edited files are named outright — "rateLimit.ts, rateLimit.test.ts" says more than
  // "2 files" and costs no more width; beyond that the count keeps the line short.
  const fileNames = [...files].map((f) => f.split("/").pop() ?? f);
  const facts = [
    `${events.length} steps`,
    ...skillsUsed.map((n) => `/${n}`),
    files.size ? (files.size <= 2 ? fileNames.join(", ") : `${files.size} files`) : null,
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
          <span className="flex shrink-0 items-center gap-2 font-medium whitespace-nowrap">
            <span className="bg-live breathe size-1.5 rounded-full" aria-hidden />
            Working
            <span className="text-muted-foreground font-normal tabular-nums">
              {done}/{events.length} steps
            </span>
            {firstAt !== undefined && <span className="text-faint font-normal text-micro tabular-nums">{formatDuration(now - firstAt)}</span>}
          </span>
        ) : (
          <span className="shrink-0 font-medium whitespace-nowrap">
            Worked
            {span !== undefined && <span className="text-muted-foreground ml-1 font-normal tabular-nums">for {formatDuration(span)}</span>}
          </span>
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
            initial={still ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={still ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            // Height rides a spring (it tracks content that is still growing without a hard stop);
            // opacity stays a short tween so the fade never lags behind the reveal.
            transition={still ? { duration: 0 } : { height: SPRING, opacity: { duration: 0.16, ease: [0.22, 1, 0.36, 1] } }}
            // Capped: a 60-step group opened by accident must not shove the conversation a screen down.
            // The timeline sits on its own quiet surface, so "work" reads apart from the agent's prose.
            // No `overscroll-contain` here: on a scroll container it blocks scroll chaining even when
            // the list is SHORTER than the cap, so a wheel over an open timeline scrolled nothing.
            className="work-surface relative mt-2 max-h-[32rem] overflow-y-auto"
          >
            {events.map((e, i) => {
              const running = !!live && !e.result;
              const last = i === events.length - 1;
              const state = running ? "running" : e.failed ? "failed" : "done";
              // Step and shell rows carry their own chip; MCP / skill rows get one here.
              const ownChip = !parseMcpName(e.name) && e.name !== "Skill";
              return (
                <motion.li
                  key={i}
                  initial={still ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={still ? { duration: 0 } : { ...SPRING, delay: Math.min(i, 8) * 0.03 }}
                  className="relative flex gap-3 pb-2 last:pb-0"
                >
                  <span className="relative flex w-4 shrink-0 flex-col items-center">
                    <span
                      className={cn(
                        "z-10 mt-2 grid size-3.5 place-items-center rounded-full border text-[8.5px] font-semibold tabular-nums transition-colors duration-200",
                        running
                          ? "border-live bg-live/20 text-live"
                          : e.failed
                            ? "border-destructive/60 bg-destructive/10 text-destructive"
                            : "border-line-strong bg-card text-muted-foreground"
                      )}
                    >
                      <StatusGlyph state={state}>
                        {running ? <span className="bg-live size-1.5 animate-pulse rounded-full" /> : e.failed ? <AlertTriangle className="size-2" strokeWidth={3} aria-label="failed" /> : i + 1}
                      </StatusGlyph>
                    </span>
                    {!last && <span className="bg-border absolute top-[1.4rem] bottom-0 w-px" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <ToolItem event={e} live={running} />
                  </div>
                  {!ownChip && <DurationChip event={e} running={running} className="mt-1.5" />}
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
  // Any other finished output with a recognisable shape (a table, JSON, a commit log, `ls -l`…) is
  // drawn — Visual by default, the terminal one click away under "Raw".
  const visual = useOutputVisual(report ? undefined : event.result, live);
  const [raw, setRaw] = React.useState(false);
  if (!report && visual) {
    return (
      <div className="enter min-w-0 flex flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2 pl-1">
          <p className="stamp text-muted-foreground min-w-0 truncate">
            <span className={cn("mr-1.5 select-none", event.failed ? "text-destructive" : "text-ok")}>$</span>
            {event.arg}
          </p>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {event.failed && <span className="label text-destructive">failed</span>}
            <DurationChip event={event} />
            <VisualRawSwitch raw={raw} onChange={setRaw} />
          </span>
        </div>
        {raw ? (
          <TraceOutput text={event.result!} mode="term" className="bg-trace rounded-md border border-white/8" />
        ) : (
          <div className="min-w-0 [&>*]:my-0">{visual}</div>
        )}
      </div>
    );
  }
  if (report) {
    return (
      <div className="min-w-0 flex flex-col gap-2">
        <p className="stamp text-muted-foreground truncate pl-1">
          <span className="text-ok mr-1.5 select-none">$</span>
          {event.arg}
        </p>
        <TestResultsCard report={report} onRaw={() => setOpen((v) => !v)} rawOpen={open} />
        <Collapse open={open}>
          <TraceOutput text={event.result!} mode="term" className="bg-trace rounded-md border border-white/8" />
        </Collapse>
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
          <StatusGlyph state={live ? "running" : event.failed ? "failed" : "done"}>
            {live ? (
              <Loader2 className="text-live size-3 animate-spin" aria-hidden />
            ) : event.failed ? (
              <AlertTriangle className="text-destructive size-3" aria-hidden />
            ) : (
              <Terminal className="text-trace-fg/60 size-3" aria-hidden />
            )}
          </StatusGlyph>
          <span className="label text-trace-fg/60">{event.name}</span>
          {live && <span className="label text-live">running</span>}
          {!live && event.failed && <span className="label text-destructive">failed</span>}
          <DurationChip event={event} running={live} className={cn("ml-auto", !live && !event.failed && "text-trace-fg/45")} />
          {hasOutput && <PanelFold open={open} text={event.result!} onToggle={() => setOpen((v) => !v)} />}
        </div>
        <pre className="text-trace-fg px-3 py-2 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]">
          <span className="text-ok mr-2 shrink-0 select-none" aria-hidden>
            $
          </span>
          {event.arg ?? ""}
          {live && !hasOutput && <span className="caret text-live" aria-hidden>▍</span>}
        </pre>
        <Collapse open={hasOutput && open}>
          <TraceOutput text={event.result!} mode="term" className="border-t border-white/8" />
        </Collapse>
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

/** The per-edit ⟦diff⟧ block: -old/+new lines from the formatter, tinted like a diff. */
function EditDiff({ diff }: { diff: string }) {
  return (
    <pre className="bg-trace mt-2 ml-6 max-h-72 overflow-auto rounded-md border border-white/8 px-3 py-2 font-mono text-code whitespace-pre-wrap">
      {diff.split("\n").map((l, i) => (
        <div
          key={i}
          className={
            l.startsWith("+") ? "bg-emerald-500/10 text-emerald-300" : l.startsWith("-") ? "bg-red-500/10 text-red-300" : "text-trace-fg/70"
          }
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

/** Non-shell tool (Write / Read / Edit / Grep …): compact step row, arg as a code chip, output folded. */
function StepItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const summary = resultSummary(event.result);
  const lines = event.result ? lineCount(event.result) : 0;
  const expandable = !!event.result || !!event.diff;
  // Folded like any step, but a recognisable output (JSON, a table…) opens drawn, "Raw" beside it.
  const visual = useOutputVisual(event.diff ? undefined : event.result, live);
  const [raw, setRaw] = React.useState(false);

  return (
    <div className="enter min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-meta",
          expandable && "hover:bg-muted cursor-pointer",
          live && "bg-live/6"
        )}
      >
        <StatusGlyph state={live ? "running" : event.failed ? "failed" : "done"}>
          {live ? (
            <Loader2 className="text-live size-3.5 animate-spin" aria-hidden />
          ) : event.failed ? (
            <AlertTriangle className="text-destructive size-3.5" aria-hidden />
          ) : (
            <FileText className="text-muted-foreground size-3.5" aria-hidden />
          )}
        </StatusGlyph>
        <span className="text-foreground shrink-0 font-medium">{event.name}</span>
        {event.arg && (
          <code className="text-muted-foreground bg-muted min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-micro">
            {event.arg}
          </code>
        )}
        {/* Right-aligned tail: line count, duration, chevron. */}
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-1">
          {expandable && lines > 1 && <span className="label text-faint">{lines} lines</span>}
          <DurationChip event={event} running={live} />
          {expandable && (
            <ChevronRight className={cn("text-muted-foreground size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
          )}
        </span>
      </button>

      <Collapse open={open && expandable}>
        {event.diff && <EditDiff diff={event.diff} />}
        {event.result && visual && (
          <div className="mt-2 ml-6 flex justify-end">
            <VisualRawSwitch raw={raw} onChange={setRaw} />
          </div>
        )}
        {event.result && visual && !raw ? (
          <div className="mt-1.5 ml-6 min-w-0 [&>*]:my-0">{visual}</div>
        ) : (
          event.result && <TraceOutput text={event.result} mode="term" className="bg-trace mt-2 ml-6 overflow-hidden rounded-md border border-white/8" />
        )}
      </Collapse>
      {event.result && !open && summary && <p className={cn("stamp ml-8 truncate", event.failed ? "text-destructive" : "text-muted-foreground")}>{summary}</p>}
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
      <Collapse open={open}>
        <pre className="bg-trace text-trace-fg/80 mt-1.5 max-h-96 overflow-auto rounded-md border border-white/8 px-3 py-2 font-mono text-code whitespace-pre-wrap">{text}</pre>
      </Collapse>
    </div>
  );
}

export const SayItem = React.memo(function SayItem({ text, live, label = true, at }: { text: string; live?: boolean; label?: boolean; at?: number }) {
  if (!live && looksLikeDump(text)) return <DumpItem text={text} />;
  return (
    <div className="enter group/say min-w-0">
      {(label || live) && <AgentLabel live={live} at={at} />}
      <div className="text-foreground min-w-0">
        <StreamingMarkdown text={text} live={!!live} />
      </div>
      {!live && <CopyMessage text={text} at={label ? undefined : at} />}
    </div>
  );
});

/**
 * The agent's byline, once per turn, so where the operator stops and the agent starts is never a guess.
 * With `at`, a quiet time follows the name — revealed on hover of the reply, always shown on touch.
 */
export function AgentLabel({ live, at }: { live?: boolean; at?: number }) {
  return (
    <span className="label text-muted-foreground mb-1.5 flex items-center gap-2">
      {/* The agent's mark: a small sphere in the live hue. It breathes only while the agent works. */}
      <span className={cn("agent-mark", live && "agent-mark-live")} aria-hidden />
      Agent
      {at !== undefined && (
        <TimeStamp at={at} className="ml-0.5 normal-case tracking-normal opacity-0 transition-opacity duration-150 group-hover/say:opacity-100 [@media(hover:none)]:opacity-100" />
      )}
    </span>
  );
}

/**
 * Per-reply copy: fades in under the reply on hover; always shown on touch, where there is no hover.
 * A reply without its own byline (a continuation) carries its time here instead.
 */
function CopyMessage({ text, at }: { text: string; at?: number }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="mt-1 -ml-1.5 flex h-7 items-center opacity-0 transition-opacity duration-150 group-hover/say:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked: nothing to signal */
          }
        }}
        aria-label={copied ? "Copied" : "Copy reply"}
        className="text-muted-foreground hover:text-foreground hover:bg-muted flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-micro"
      >
        {copied ? <Check className="text-ok size-3.5" strokeWidth={2.5} aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
      {at !== undefined && <TimeStamp at={at} className="ml-1.5" />}
    </div>
  );
}

/**
 * The "working…" beat between visible outputs — a live status pill, not dead air. It names what the
 * agent is doing right now (`Bash npm test`, `thinking`), morphs as that changes (the old detail
 * slides out, the new one in), and carries an elapsed counter so a stall is visible as a number that
 * keeps climbing next to a detail that stopped changing.
 */
export function WorkingIndicator({ label = "Working", detail }: { label?: string; detail?: string | null }) {
  const still = useReducedMotion();
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const start = Date.now();
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);
  const mins = Math.floor(elapsed / 60);
  const time = elapsed < 5 ? null : mins > 0 ? `${mins}m ${elapsed % 60}s` : `${elapsed}s`;
  const swap = still
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const } };
  return (
    <div className="enter flex items-center gap-2.5">
      {/* Screen readers hear the stage when it changes, never the ticking timer. */}
      <span className="sr-only" role="status">
        {label}
      </span>
      {/* One pill that morphs between stages (Dynamic-Island style) instead of pills swapping in and out. */}
      <motion.div
        layout={!still}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="bg-card inline-flex max-w-full items-center gap-2.5 overflow-hidden rounded-full border py-1.5 pr-3.5 pl-2 text-meta shadow-e1"
        aria-hidden
      >
        <span className="orb shrink-0" />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={label} {...swap} className="shimmer-text shrink-0 font-medium">
            {label}
          </motion.span>
        </AnimatePresence>
        <AnimatePresence mode="popLayout" initial={false}>
          {detail && (
            <motion.code key={detail} {...swap} className="text-muted-foreground bg-muted min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-micro">
              {detail}
            </motion.code>
          )}
        </AnimatePresence>
        {time && <span className="text-faint shrink-0 text-micro tabular-nums">{time}</span>}
      </motion.div>
    </div>
  );
}

/**
 * Your turn: the one bubble. A muted fill, right-aligned, so the primary ink stays for actions.
 * When `onRevert` is set, hovering the row reveals a ⟲ control BEFORE the bubble (left of it,
 * fading in like the output-panel copy button): revert the box to the state before this message
 * was delivered. Confirmation happens upstream (Thread owns the dialog).
 *
 * `noEnter` drops the CSS entrance for callers that animate the row in themselves (Thread's `Rise`
 * around pending replies) — otherwise the bubble would rise twice.
 */
export function YouItem({ text, label = "You", onRevert, at, noEnter = false }: { text: string; label?: string; onRevert?: () => void; at?: number; noEnter?: boolean }) {
  // Image attachments ride in the message as in-box paths; show them as thumbnails, not as text.
  const attachments = React.useMemo(() => [...new Set(text.match(ATTACHMENT_RE) ?? [])], [text]);
  const body = React.useMemo(() => (attachments.length ? text.replace(/\n*Attached images? \(open with the Read tool\):[\s\S]*$/, "").trim() : text), [text, attachments.length]);
  // A leading /skill token renders as a tinted tag, not prose — the same face it had in the composer.
  const skillMatch = body.match(/^\/([a-z0-9][a-z0-9-]{0,49})(?:\s+([\s\S]*))?$/);
  const skillName = skillMatch?.[1] ?? null;
  const rest = skillMatch ? (skillMatch[2] ?? "").trim() : body;
  return (
    <div className={cn(!noEnter && "enter", "group/you flex flex-col items-end gap-1.5")}>
      <span className="label text-muted-foreground flex items-center gap-1.5 pr-1">
        {/* The time sits BEFORE the label so the label keeps its right edge; hover-revealed like revert. */}
        {at !== undefined && (
          <TimeStamp at={at} className="normal-case tracking-normal opacity-0 transition-opacity duration-150 group-hover/you:opacity-100 [@media(hover:none)]:opacity-100" />
        )}
        {label}
      </span>
      {attachments.length > 0 && (
        <div className="flex max-w-[min(72%,60ch)] flex-wrap justify-end gap-1.5">
          {attachments.map((p) => (
            <AttachmentImage key={p} path={p} />
          ))}
        </div>
      )}
      {/* w-full, not fit-content: the bubble's 72% max-width must resolve against the whole column.
          Against a shrink-to-fit row, the percentage is circular and (with overflow-wrap:anywhere
          making min-content one character) the browser may collapse a short message onto two lines. */}
      <div className="flex w-full items-center justify-end gap-2">
        {onRevert && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onRevert}
                aria-label="Revert the sandbox to before this message"
                className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border opacity-0 transition-opacity duration-150 group-hover/you:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <Undo2 className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Revert to before this message</TooltipContent>
          </Tooltip>
        )}
      {body && (
        <div className="you-bubble text-foreground min-w-0 max-w-[min(72%,60ch)] rounded-2xl rounded-br-md px-4 py-2.5 text-lead break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
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
      <div className="text-foreground min-w-0 max-w-[min(72%,60ch)] rounded-xl rounded-br-md border border-dashed px-4 py-2.5 text-body leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
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
      <Collapse open={open}>
        <div className="text-muted-foreground mt-1 ml-2 border-l pl-4 text-meta leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</div>
      </Collapse>
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
        {answer.trim() ? "The agent asked — you answered" : "The agent asked"}
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
            {answer.trim() ? (
              <>
                <p className="label text-muted-foreground mb-0.5">Your answer</p>
                <p className="text-foreground text-meta whitespace-pre-wrap [overflow-wrap:anywhere]">{answer}</p>
              </>
            ) : (
              <p className="text-muted-foreground text-meta">No answer was recorded — the run moved on without one.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
