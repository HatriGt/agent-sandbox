import * as React from "react";
import { AlertTriangle, ArrowUpRight, Brain, Check, ChevronDown, ChevronRight, Clock, Copy, FileText, KeyRound, Loader2, MessageCircleQuestion, Play, Terminal, Undo2 } from "lucide-react";
import { CodeNavContext } from "@/components/ui/code-ref";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resultSummary, type TraceEvent } from "@/lib/trace";
export { PlanCard, PlanDock } from "./PlanBoard";
import { parseQuestion } from "@/lib/question";
import { Pause as PauseIcon } from "lucide-react";
import { parseTestReport } from "@/lib/testReport";
import { TestResultsCard } from "./TestResultsCard";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Markdown } from "@/components/ui/markdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { ATTACHMENT_RE, SessionReposContext, useSession } from "@/lib/session-context";
import { SkillMark } from "@/lib/skillGlyph";
import { parseMcpName } from "@/lib/mcp";
import { McpItem } from "./McpItem";
import { PanelFold, TraceOutput, VisualRawSwitch, useOutputVisual } from "./TraceOutput";
import { Lightbox } from "@/components/ui/lightbox";
import { Collapse } from "@/components/ui/collapse";
import { Swap } from "@/components/ui/swap";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Odometer } from "@/components/viz/motion";
import { LiveLogView, useLiveLog } from "@/components/viz/LiveLog";
import { liveKind } from "@/lib/viz-live-log";
import { toolOutputLanguage } from "@/lib/viz-tool-output";
import { useNow } from "@/hooks/useNow";

/**
 * The Execution toolbar's Expand all / Collapse all. `v` bumps on every press so pressing the same
 * button twice re-applies it after a row was toggled by hand; `v === 0` means "never pressed".
 */
export const ExpandAll = React.createContext<{ v: number; open: boolean }>({ v: 0, open: false });

/** Opens/closes a collapsible whenever the toolbar fires. */
export function useExpandAll(setOpen: (open: boolean) => void) {
  const { v, open } = React.useContext(ExpandAll);
  React.useEffect(() => {
    if (v > 0) setOpen(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
}

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

const MEMORY_KIND: Record<string, string> = {
  preference: "Preference",
  rule: "Rule",
  domain: "Domain",
  fact: "Fact",
  decision: "Decision",
  lesson: "Lesson",
  playbook: "Playbook",
};

/**
 * Where the agent saved something for future runs: one quiet hairline row, not a chat message. The
 * mechanics (the `memory add` call, the sentinel) never render; the note itself links to the
 * Memory page, where it can be edited or forgotten.
 */
export function MemoryItem({ notes }: { notes: { note: string; text: string; area?: string; updated?: boolean }[] }) {
  return (
    <div className="enter flex min-w-0 items-start gap-3 py-0.5">
      <a
        href="/dashboard/memory"
        className="label text-muted-foreground hover:text-foreground focus-visible:ring-ring flex shrink-0 items-center gap-1.5 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        <Brain className="size-3" aria-hidden />
        Remembered
      </a>
      <ul className="min-w-0 flex-1 space-y-0.5">
        {notes.map((n, i) => (
          <li key={i} className="text-faint truncate text-micro" title={n.text}>
            <span className="text-muted-foreground">
              {n.updated ? "Updated · " : ""}
              {MEMORY_KIND[n.note] ?? "Note"}
              {n.area ? ` · ${n.area}` : ""}
            </span>{" "}
            · {n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

// eval/python/js: omp's code-running tools print like a shell and stream partial output the same way.
const SHELL_TOOLS = new Set(["Bash", "Shell", "Terminal", "Run", "Exec", "sh", "bash", "eval", "python", "js"]);
type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

/** Tools that change a file: their row carries a diffstat chip and an Open link into the workspace. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** Tools whose result is a hit list: the chip says how many. */
const SEARCH_TOOLS = new Set(["Grep", "Glob", "WebSearch", "WebFetch", "grep", "glob", "find", "web_search", "fetch", "search"]);

/**
 * `+N −M` from the formatter's ⟦diff⟧ block (the tool's own input: old/new strings, or the whole
 * content for a Write). The block is capped at DIFF_MAX_LINES in the box and ends with "… N more
 * lines" when cut; those lines have no sign, so the stat is marked as a lower bound ("+200+").
 */
export function diffStat(diff: string | undefined): { added: number; removed: number; partial: boolean } | null {
  if (!diff) return null;
  let added = 0;
  let removed = 0;
  let partial = false;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+")) added++;
    else if (l.startsWith("-")) removed++;
    else if (/^… \d+ more lines$/.test(l)) partial = true;
  }
  return added || removed ? { added, removed, partial } : null;
}

/** `Exit code 2` — the first line the formatter writes for a failed shell call (src/trace.ts ERR_MARK). */
export function exitCodeOf(result: string | undefined): number | null {
  const m = result?.match(/^\s*Exit code (\d+)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * The env var a failed shell call says it is missing — `DEPLOY_TOKEN is not set`, `NPM_TOKEN: unbound
 * variable`, `Missing env DATABASE_URL` — so the thread can offer to provide it (the Resolve row).
 * Only SCREAMING_CASE names of 3+ characters count; a lowercase word before "is not set" is prose.
 */
export function missingSecretOf(result: string | undefined): string | null {
  if (!result) return null;
  const said = result.match(/\b([A-Z][A-Z0-9_]{2,})\b:? (?:is not set|is unset|not defined|is not defined|missing|unbound variable)/);
  if (said) return said[1];
  const env = result.match(/\bMissing (?:env(?:ironment)?(?: var(?:iable)?)?|required env(?:ironment)?(?: var(?:iable)?)?)[:\s]+\$?([A-Z][A-Z0-9_]{2,})\b/i);
  return env ? env[1] : null;
}

/**
 * How many hits a search/fetch result holds. Grep/Glob list one path per line; WebSearch results
 * carry "N results" / "N sources" / link lines. Null when the shape is not a list.
 */
export function resultCount(name: string, result: string | undefined): number | null {
  if (!result || !SEARCH_TOOLS.has(name)) return null;
  const said = result.match(/\b(\d+)\s+(?:results?|sources?|matches|files?)\b/i);
  if (said) return Number(said[1]);
  if (/^no (matches|files) found/i.test(result.trim())) return 0;
  const lines = result.split("\n").filter((l) => l.trim());
  if (/^(Grep|Glob|grep|glob|find)$/.test(name)) return lines.filter((l) => !/^(Found \d+|\.\.\.|…)/.test(l)).length;
  const links = lines.filter((l) => /https?:\/\//.test(l)).length;
  return links || null;
}

/** A mono result chip: `+26 −1` · `exit 2` · `12 results`. */
function OutcomeChip({ children, tone = "faint", className }: { children: React.ReactNode; tone?: "faint" | "destructive"; className?: string }) {
  return (
    <span className={cn("stamp shrink-0 rounded px-1 text-micro tabular-nums", tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground", className)}>
      {children}
    </span>
  );
}

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
export const SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.8 } as const;

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

/**
 * A watch re-runs the same command every cycle. Every earlier run of a command that runs again later
 * is a "repeat": it folds to one quiet line so the thread does not grow a full card per poll, and
 * only the newest run keeps the live view. Thread.tsx provides the set; nothing is dropped.
 */
export function repeatedPolls(events: readonly TraceEvent[]): WeakSet<object> {
  const out = new WeakSet<object>();
  const later = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "tool" || !SHELL_TOOLS.has(e.name) || !e.arg) continue;
    const key = `${e.name}|${e.arg}`;
    if (later.has(key)) out.add(e);
    else later.add(key);
  }
  return out;
}
export const RepeatedPolls = React.createContext<WeakSet<object>>(new WeakSet());

/**
 * How much of the agent's work the thread shows. "chat" (the default) reads like a conversation:
 * the agent's prose, your messages, questions and results; every stretch of tool work folds to one
 * line unless it is notable (a test run, a PR, a failed external call) or still running. "trace"
 * shows every step as before. Thread.tsx provides it; the header toggles it.
 */
export type ThreadDensity = "chat" | "trace";
export const Density = React.createContext<ThreadDensity>("chat");

/** An earlier run of a repeated command: one line (command · what it printed · time), opens in place. */
function PollRow({ event }: { event: ToolEvent }) {
  const [open, setOpen] = React.useState(false);
  const summary = resultSummary(event.result);
  return (
    <div className="min-w-0" data-poll-row>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-muted flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors"
      >
        <ChevronRight className={cn("text-faint size-3 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        <span className={cn("shrink-0 font-mono text-micro select-none", event.failed ? "text-destructive" : "text-faint")}>$</span>
        <span className="text-muted-foreground min-w-0 shrink truncate font-mono text-micro">{event.arg}</span>
        {summary && <span className="text-faint min-w-0 flex-1 truncate text-micro">· {summary}</span>}
        <span className="ml-auto shrink-0">
          <DurationChip event={event} running={false} />
        </span>
      </button>
      <Collapse open={open}>
        <div className="pt-1.5"><ShellItem event={event} /></div>
      </Collapse>
    </div>
  );
}

function ToolItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const repeat = React.useContext(RepeatedPolls).has(event);
  if (repeat && !live) return <PollRow event={event} />;
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
/** Results worth reading (a test run, a PR URL) or a failure that blocks the run: open those groups. */
export function notableTools(events: ToolEvent[]): boolean {
  return events.some(
    (e) =>
      !!parseTestReport(e.result) ||
      /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(e.result ?? "") ||
      (!!e.failed && (!!parseMcpName(e.name) || (SHELL_TOOLS.has(e.name) && missingSecretOf(e.result) !== null)))
  );
}

/**
 * The facts worth a glance about a run of tool calls: step count, skills fired, files touched (named
 * when one or two), commands run, external calls per server, lookups when nothing else happened.
 */
export function toolFacts(events: ToolEvent[]): string[] {
  const files = new Set(events.filter((e) => /^(write|edit|multiedit|notebookedit)$/i.test(e.name) && e.arg).map((e) => e.arg!.split(/\s/)[0]));
  const commands = events.filter((e) => SHELL_TOOLS.has(e.name)).length;
  const reads = events.filter((e) => /^(read|glob|grep|search|ls|webfetch|websearch)$/i.test(e.name)).length;
  const mcpByServer = new Map<string, number>();
  for (const e of events) {
    const m = parseMcpName(e.name);
    if (m) mcpByServer.set(m.server, (mcpByServer.get(m.server) ?? 0) + 1);
  }
  const skillsUsed = [...new Set(events.filter((e) => e.name === "Skill").map((e) => skillOf(e)).filter(Boolean))] as string[];
  const fileNames = [...files].map((f) => f.split("/").pop() ?? f);
  return [
    `${events.length} ${events.length === 1 ? "step" : "steps"}`,
    ...skillsUsed.map((n) => `/${n}`),
    files.size ? (files.size <= 2 ? fileNames.join(", ") : `${files.size} files`) : null,
    commands ? `${commands} ${commands === 1 ? "command" : "commands"}` : null,
    ...[...mcpByServer].map(([srv, n]) => `${n} ${srv} ${n === 1 ? "call" : "calls"}`),
    !files.size && !commands && !mcpByServer.size && reads ? `${reads} lookups` : null,
  ].filter(Boolean) as string[];
}

export function ToolGroup({ events, live }: { events: ToolEvent[]; live?: boolean }) {
  // Results worth reading (a test run, a PR URL) must not hide behind the fold: open those groups.
  // …and a FAILED external (MCP) call must never hide behind the fold: a server silently missing
  // or erroring is precisely the thing an operator otherwise cannot see. Same for a shell call that
  // failed for want of an env var: its Resolve row is the one thing that unblocks the run.
  const notable = React.useMemo(() => notableTools(events), [events]);
  const anyRunning = !!live && events.some((e) => !e.result || e.streaming);
  const density = React.useContext(Density);
  // Open while the agent works in it; folds when the work ends unless someone toggled it by hand.
  const [open, setOpenRaw] = React.useState(notable || anyRunning || density === "trace");
  const touched = React.useRef(false);
  const setOpen = React.useCallback((v: boolean | ((o: boolean) => boolean)) => {
    touched.current = true;
    setOpenRaw(v);
  }, []);
  const wasRunning = React.useRef(anyRunning);
  React.useEffect(() => {
    if (anyRunning && !wasRunning.current && !touched.current) setOpenRaw(true);
    if (!anyRunning && wasRunning.current && !touched.current) setOpenRaw(notable || density === "trace");
    wasRunning.current = anyRunning;
  }, [anyRunning, notable, density]);
  React.useEffect(() => {
    if (notable) setOpenRaw(true);
  }, [notable]);
  useExpandAll(setOpen);
  const failed = events.filter((e) => e.failed).length;
  const done = events.filter((e) => !!e.result && !e.streaming).length;
  const span = groupSpan(events);
  // While working, the group's clock runs from its first stamped call.
  const firstAt = events.find((e) => e.at !== undefined)?.at;
  const now = useNow(anyRunning && firstAt !== undefined);
  // In chat density a lone finished step folds like any other work — unless it is running, notable,
  // or its output draws as a visual (a table, a request log…): that IS the result, so it stays.
  const drawn = events.length === 1 && !!events[0].result && toolOutputLanguage(events[0].result) !== null;
  if (events.length === 1 && (density === "trace" || anyRunning || notable || drawn)) {
    return <ToolItem event={events[0]} live={anyRunning} />;
  }

  const facts = toolFacts(events);

  return (
    <div className="enter min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "group/steps -ml-1.5 flex max-w-full cursor-pointer items-center gap-2.5 rounded-md py-1 pr-2 pl-1.5 text-left text-meta transition-colors",
          anyRunning ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
        )}
      >
        <span className={cn("think-orb shrink-0", anyRunning && "think-orb-live")} aria-hidden />
        <Swap state={anyRunning} mode="popLayout" className="inline-flex shrink-0">
          {anyRunning ? (
            <span className="flex shrink-0 items-center gap-2 font-medium whitespace-nowrap">
              Working
              <span className="text-muted-foreground font-normal tabular-nums">
                <Odometer text={`${done}/${events.length}`} /> steps
              </span>
              {firstAt !== undefined && <span className="text-faint font-normal text-micro tabular-nums">{formatDuration(now - firstAt)}</span>}
            </span>
          ) : (
            <span className="shrink-0 font-medium whitespace-nowrap">
              Worked
              {span !== undefined && <span className="text-muted-foreground ml-1 font-normal tabular-nums">for {formatDuration(span)}</span>}
            </span>
          )}
        </Swap>
        <AnimatePresence initial={false}>
          {!anyRunning && (
            <motion.span
              key="facts"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="stamp text-muted-foreground min-w-0 truncate"
            >
              {facts.map((f, i) => (
                <React.Fragment key={f}>
                  {i > 0 && <span className="mx-1 opacity-50">·</span>}
                  {f}
                </React.Fragment>
              ))}
            </motion.span>
          )}
          {failed > 0 && !anyRunning && (
            <motion.span
              key="failed"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="text-destructive stamp"
            >
              {failed} failed
            </motion.span>
          )}
        </AnimatePresence>
        <ChevronDown className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <ToolStepsList events={events} live={live} />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The numbered timeline of one run of tool calls: a glyph per step (number, live dot, failed mark)
 * on a hairline, each opening into the real work. Shared by ToolGroup's fold and the reasoning trail.
 */
export function ToolStepsList({ events, live, className, plain }: { events: ToolEvent[]; live?: boolean; className?: string; plain?: boolean }) {
  const still = useReducedMotion();
  return (
    <motion.ol
      initial={still || plain ? false : { height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={still || plain ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
      // Height rides a spring (it tracks content that is still growing without a hard stop);
      // opacity stays a short tween so the fade never lags behind the reveal.
      transition={still ? { duration: 0 } : { height: SPRING, opacity: { duration: 0.16, ease: [0.22, 1, 0.36, 1] } }}
      // Capped: a 60-step group opened by accident must not shove the conversation a screen down.
      // The timeline sits on its own quiet surface, so "work" reads apart from the agent's prose.
      // No `overscroll-contain` here: on a scroll container it blocks scroll chaining even when
      // the list is SHORTER than the cap, so a wheel over an open timeline scrolled nothing.
      className={cn("relative max-h-[32rem] overflow-y-auto", plain ? "mt-1" : "work-surface mt-2", className)}
    >
      {events.map((e, i) => {
        const running = !!live && (!e.result || !!e.streaming);
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
                  {running ? <span className="bg-live breathe size-1.5 rounded-full" /> : e.failed ? <AlertTriangle className="size-2" strokeWidth={3} aria-label="failed" /> : i + 1}
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
  );
}

/** A shell command as a terminal panel: `$ cmd`, then its output, on the dark trace ground. */
function ShellItem({ event, live }: { event: ToolEvent; live?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const hasOutput = !!event.result;
  const exit = event.failed ? exitCodeOf(event.result) : null;
  // A finished failure naming an env var it lacked gets a Resolve row: provide it once, or save it.
  const missing = !live && event.failed ? missingSecretOf(event.result) : null;
  // A test run renders as a results card (summary chips + per-file cases) with the terminal panel
  // demoted to "raw output"; anything else is the plain terminal.
  const report = React.useMemo(() => (live ? null : parseTestReport(event.result)), [event.result, live]);
  // Any other finished output with a recognisable shape (a table, JSON, a commit log, `ls -l`…) is
  // drawn — Visual by default, the terminal one click away under "Raw".
  // A log stream (access log, levelled lines, JSON-lines logs) draws as a live request view while
  // the command runs. Once shown it stays this view after the command ends: same element, same
  // tally, no remount and no replayed entrance.
  const logSticky = React.useRef(false);
  const liveLog = useLiveLog(live || logSticky.current ? (event.result ?? "") : "", !live);
  const isLog = !report && (live || logSticky.current) && liveKind(liveLog) !== null;
  if (isLog) logSticky.current = true;
  const generic = useOutputVisual(report || isLog ? undefined : event.result, live);
  const visual = isLog ? <LiveLogView state={liveLog} live={!!live} /> : generic;
  const [raw, setRaw] = React.useState(false);
  if (!report && visual) {
    return (
      <div className="enter min-w-0 flex flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2 pl-1">
          <p className="stamp text-muted-foreground min-w-0 truncate">
            <span className={cn("mr-1.5 select-none", event.failed ? "text-destructive" : live ? "text-live" : "text-ok")}>$</span>
            {event.arg}
          </p>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {live && <Loader2 className="text-live size-3 animate-spin motion-reduce:animate-none" aria-label="running" />}
            {!live && event.failed && (exit !== null ? <OutcomeChip tone="destructive">exit {exit}</OutcomeChip> : <span className="label text-destructive">failed</span>)}
            <DurationChip event={event} running={live} />
            <VisualRawSwitch raw={raw} onChange={setRaw} />
          </span>
        </div>
        {/* Both stay mounted: flipping to Raw and back must not reset the live view's tally or scroll. */}
        <div className={cn("min-w-0 [&>*]:my-0", raw && "hidden")}>{visual}</div>
        {raw && <TraceOutput text={event.result!} mode="term" className="bg-trace rounded-md border border-white/8" />}
        {missing && <ResolveSecretRow name={missing} />}
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
          {!live && event.failed && (exit !== null ? <OutcomeChip tone="destructive">exit {exit}</OutcomeChip> : <span className="label text-destructive">failed</span>)}
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
        <Collapse open={hasOutput && !open}>
          <button type="button" onClick={() => setOpen(true)} className="text-trace-fg/60 hover:text-trace-fg flex w-full cursor-pointer items-center gap-2 border-t border-white/8 px-3 py-1.5 text-left font-mono text-micro">
            <span className="text-trace-fg/40 select-none">›</span>
            <span className="truncate">{resultSummary(event.result)}</span>
          </button>
        </Collapse>
      </div>
      {missing && <ResolveSecretRow name={missing} />}
    </div>
  );
}

/**
 * `Provide DEPLOY_TOKEN` — under a shell call that failed for want of an env var. One masked input;
 * "Resume with it" hands the value to this turn only (api.resume `secrets`: -e flags, never stored).
 * "Save for this repo" first stores it in the vault granted to the box's first repo, so the next run
 * there has it from the start. The value lives in this input and nowhere else in the page.
 */
function ResolveSecretRow({ name }: { name: string }) {
  const session = useSession();
  const repos = React.useContext(SessionReposContext);
  // Repo setup profiles are keyed owner/name; the box only knows the checkout dir. Match the dir
  // against the connected repos so the grant lands on the real slug (`acme/orders-api`, not `orders-api`).
  const dir = repos[0]?.name;
  const [slug, setSlug] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!dir) return;
    const ctrl = new AbortController();
    api
      .repos(dir, false, ctrl.signal)
      .then((r) => setSlug(r.repos.find((x) => x.fullName.split("/")[1].toLowerCase() === dir.toLowerCase())?.fullName ?? null))
      .catch(() => setSlug(null));
    return () => ctrl.abort();
  }, [dir]);
  const [value, setValue] = React.useState("");
  const [save, setSave] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const submit = async () => {
    if (!session || !value || busy) return;
    setBusy(true);
    try {
      if (save && slug) await api.saveSecret(name, value, slug);
      await api.resume(session, `Provided ${name}; continue.`, { secrets: { [name]: value } });
      setValue("");
      setDone(true);
      toast.success(`Provided ${name}`, { description: save && slug ? `Saved for ${slug} too — the next run there starts with it.` : "This turn only; it is not stored." });
    } catch (e) {
      toast.error(`Could not provide ${name}`, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 pl-1 text-micro" role="status">
        <Check className="text-ok size-3" aria-hidden />
        <span className="font-mono">{name}</span> provided — the agent is continuing.
      </p>
    );
  }
  return (
    <div className="border-attention/30 bg-attention/5 mt-1.5 flex flex-col gap-2 rounded-md border px-3 py-2" data-resolve-row>
      <div className="flex min-w-0 items-center gap-2">
        <KeyRound className="text-attention-ink size-3.5 shrink-0" aria-hidden />
        <span className="text-foreground text-meta font-medium">
          Provide <span className="font-mono">{name}</span>
        </span>
        <span className="text-muted-foreground min-w-0 truncate text-micro">the command stopped without it</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          mono
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={`Value for ${name}`}
          placeholder="paste the value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          disabled={busy}
          className="h-8 min-w-0 flex-1 basis-56 text-micro"
        />
        <Button size="sm" variant="attention" onClick={() => void submit()} loading={busy} disabled={!value || !session}>
          <Play className="size-3.5" />
          Resume with it
        </Button>
      </div>
      <label className={cn("flex w-fit items-center gap-2 text-micro", slug ? "text-muted-foreground cursor-pointer" : "text-faint")}>
        <Switch size="sm" checked={save && !!slug} onCheckedChange={setSave} disabled={!slug} aria-label={slug ? `Save for ${slug}` : "Save for this repo"} />
        {slug ? (
          <>
            Save for <span className="font-mono">{slug}</span> — stored, granted to this repo
          </>
        ) : dir ? (
          <>Save for this repo — could not match {dir} to a connected repository</>
        ) : (
          <>Save for this repo — this machine has no repository attached</>
        )}
      </label>
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
  const nav = React.useContext(CodeNavContext);
  const isEdit = EDIT_TOOLS.has(event.name);
  const stat = isEdit ? diffStat(event.diff) : null;
  const hits = live ? null : resultCount(event.name, event.result);
  // The headline arg of an editing tool is the path; anything with spaces or newlines is not one.
  const filePath = isEdit && event.arg && /^\S+$/.test(event.arg.trim()) ? event.arg.trim() : null;

  return (
    <div className="enter min-w-0">
      <div className="flex min-w-0 items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-meta",
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
        {/* Right-aligned tail: outcome chip, line count, duration, chevron. */}
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-1">
          {stat && (
            <OutcomeChip className={cn(event.failed && "line-through")}>
              <span className="text-ok">+{stat.added}{stat.partial ? "+" : ""}</span> <span className="text-destructive">−{stat.removed}</span>
            </OutcomeChip>
          )}
          {hits !== null && <OutcomeChip>{hits} {hits === 1 ? "result" : "results"}</OutcomeChip>}
          {expandable && lines > 1 && !stat && hits === null && <span className="label text-faint">{lines} lines</span>}
          <DurationChip event={event} running={live} />
          {expandable && (
            <ChevronRight className={cn("text-muted-foreground size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
          )}
        </span>
      </button>
      {/* Beside the row, not inside it (a button cannot hold a button): jump to the file in the workspace. */}
      {nav && filePath && !live && (
        <button
          type="button"
          onClick={() => nav({ path: filePath })}
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex shrink-0 cursor-pointer items-center gap-1 self-start rounded-md px-1.5 py-1 text-micro font-medium"
          title={`Open ${filePath} in the workspace`}
        >
          Open
          <ArrowUpRight className="size-3" aria-hidden />
        </button>
      )}
      </div>

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
      <Collapse open={!!event.result && !open && !!summary}>
        <p className={cn("stamp ml-8 truncate", event.failed ? "text-destructive" : "text-muted-foreground")}>{summary}</p>
      </Collapse>
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
        <Collapse open={!open} className="min-w-0">
          <span className="stamp block min-w-0 truncate">{text.split("\n").find((l) => l.trim())?.trim().slice(0, 80)}</span>
        </Collapse>
      </button>
      <Collapse open={open}>
        <pre className="bg-trace text-trace-fg/80 mt-1.5 max-h-96 overflow-auto rounded-md border border-white/8 px-3 py-2 font-mono text-code whitespace-pre-wrap">{text}</pre>
      </Collapse>
    </div>
  );
}

/** HTML comments (the `<!-- watch: … -->` marker) are instructions for the UI, never prose; a
 *  half-streamed one is hidden too until it closes. */
function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/, "").replace(/\n{3,}/g, "\n\n").trim();
}

export const SayItem = React.memo(function SayItem({ text: raw, live, label = true, at }: { text: string; live?: boolean; label?: boolean; at?: number }) {
  const text = React.useMemo(() => stripComments(raw), [raw]);
  if (!text && !live) return null;
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
    <div className="enter inline-flex max-w-full min-w-0 items-center gap-2.5">
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
        {sending ? "Interrupting the turn to deliver this…" : (
          <>
            <span className="bg-live breathe size-1.5 rounded-full motion-reduce:animate-none" aria-hidden />
            Delivering · the agent reads it at its next step
          </>
        )}
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
 * Extended thinking, folded. Collapsed by default to one line — `Thought for 12s` once settled,
 * `Thinking…` with the live-text shimmer while it is still forming. Expands to the full reasoning in a
 * quieter voice than the agent's prose (height + opacity on the Orbit ease).
 */
export function ThinkingItem({ text, live, ms }: { text: string; live?: boolean; ms?: number }) {
  const [open, setOpen] = React.useState(false);
  useExpandAll(setOpen);
  const still = useReducedMotion();
  const secs = ms !== undefined ? Math.max(1, Math.round(ms / 1000)) : null;
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
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)]", open && "rotate-90")} aria-hidden />
        <Brain className={cn("size-3.5 shrink-0", live && "text-live")} aria-hidden />
        <span className={cn("font-medium", live && "shimmer-text")}>{live ? "Thinking…" : secs !== null ? `Thought for ${secs}s` : "Thought"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: still ? 0.12 : 0.26, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="text-muted-foreground mt-1 ml-2 border-l pl-4 text-meta leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</div>
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
