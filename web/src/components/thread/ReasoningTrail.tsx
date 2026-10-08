import * as React from "react";
import { AlertTriangle, ChevronDown, FileSearch, Globe, Lightbulb, PencilLine, Plug, Sparkles, Terminal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";
import { parseMcpName } from "@/lib/mcp";
import type { TraceEvent } from "@/lib/trace";
import { useNow } from "@/hooks/useNow";
import { Density, SPRING, ToolStepsList, formatDuration, notableTools, toolFacts, useExpandAll } from "./TraceItems";

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

/** One stretch of the agent's work between two things it said: thinking, tool calls, server connects. */
export type TrailItem =
  | { kind: "think"; text: string; ms?: number }
  | { kind: "tools"; events: ToolEvent[] }
  | { kind: "mcp-connect"; server: string };

const SHELL = /^(bash|shell|sh|zsh|powershell|pwsh|cmd|terminal|exec)$/i;
const READ = /^(read|glob|grep|search|ls|cat|find|webfetch|websearch|fetch)$/i;
const WRITE = /^(write|edit|multiedit|notebookedit|patch|apply_patch)$/i;

/** The live label for a tool call in progress: present tense, the one thing the agent is doing. */
function doingLabel(e: ToolEvent): { label: string; detail?: string } {
  const mcp = parseMcpName(e.name);
  if (mcp) return { label: `Calling ${mcp.server}`, detail: mcp.tool };
  if (e.name === "Skill") return { label: "Running a skill", detail: e.arg?.match(/^[a-z0-9][a-z0-9-]{0,49}/)?.[0] };
  const first = (e.arg ?? "").split("\n")[0].trim();
  const short = first.length > 44 ? first.slice(0, 42) + "…" : first;
  if (SHELL.test(e.name)) return { label: "Running", detail: short || undefined };
  if (WRITE.test(e.name)) return { label: "Editing", detail: first.split(/\s/)[0].split("/").pop() || undefined };
  if (/^(webfetch|websearch|fetch)$/i.test(e.name)) return { label: "Searching the web" };
  if (READ.test(e.name)) return { label: "Reading", detail: /^[\w./-]+$/.test(first) ? first.split("/").pop() : undefined };
  if (/^(task|agent|delegate)$/i.test(e.name)) return { label: "Delegating", detail: short || undefined };
  if (/^(ask|askuserquestion)$/i.test(e.name)) return { label: "Asking you" };
  return { label: e.name };
}

/** What a finished run of tool calls amounted to, as a short sentence head: "Ran 2 commands", "Read 6 files". */
function didLabel(events: ToolEvent[]): string {
  const n = events.length;
  const shell = events.filter((e) => SHELL.test(e.name)).length;
  const writes = events.filter((e) => WRITE.test(e.name)).length;
  const reads = events.filter((e) => READ.test(e.name)).length;
  const mcp = events.filter((e) => parseMcpName(e.name)).length;
  if (writes && writes === n) return `Edited ${writes === 1 ? "a file" : `${writes} files`}`;
  if (shell && shell === n) return `Ran ${shell === 1 ? "a command" : `${shell} commands`}`;
  if (reads && reads === n) return `Explored ${reads === 1 ? "a file" : `${reads} files`}`;
  if (mcp && mcp === n) return `Made ${mcp === 1 ? "an external call" : `${mcp} external calls`}`;
  return `Took ${n === 1 ? "a step" : `${n} steps`}`;
}

function toolsIcon(events: ToolEvent[]) {
  const names = events.map((e) => e.name);
  if (names.some((n) => parseMcpName(n))) return Plug;
  if (names.some((n) => WRITE.test(n))) return PencilLine;
  if (names.some((n) => SHELL.test(n))) return Terminal;
  if (names.some((n) => /^(webfetch|websearch|fetch)$/i.test(n))) return Globe;
  if (names.every((n) => READ.test(n))) return FileSearch;
  return Sparkles;
}

/**
 * Reasoning text as sections. A line that is only **bold** (or a markdown heading) opens a section
 * and names it; the lines under it are its body. While text is still arriving, a heading that has
 * opened but not closed (`**Checking the`) is held back so a half-typed title never flashes.
 */
export function sectionsOf(text: string, live: boolean): { heading?: string; body: string }[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: { heading?: string; body: string[] }[] = [];
  let cur: { heading?: string; body: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim();
    const bold = l.match(/^\*\*(.+?)\*\*:?$/) ?? l.match(/^#{1,4}\s+(.+?)\s*#*$/);
    if (bold) {
      cur = { heading: bold[1].trim(), body: [] };
      out.push(cur);
      continue;
    }
    // Half-typed heading at the very end while live: hold it back until it closes.
    if (live && i === lines.length - 1 && /^\*\*[^*]*$/.test(l)) break;
    if (!cur) {
      cur = { body: [] };
      out.push(cur);
    }
    cur.body.push(raw);
  }
  return out
    .map((s) => ({ ...(s.heading ? { heading: s.heading } : {}), body: s.body.join("\n").replace(/^\n+|\n+$/g, "") }))
    .filter((s) => s.heading || s.body);
}

/** The animated sphere that marks the agent's reasoning; a still frame when idle or under reduced motion. */
export function ThinkingOrb({ active, className }: { active?: boolean; className?: string }) {
  return <span className={cn("think-orb shrink-0", active && "think-orb-live", className)} aria-hidden />;
}

/**
 * The agent's work between two things it says, as one trail: an orb and a status line that follows
 * each step ("Thinking", "Running npm test", "Editing rateLimit.ts") with a running timer, opening
 * into the full trail of reasoning sections and tool steps. Open while the agent works; collapses to
 * "Worked for 12s" when it finishes, unless someone opened or closed it themselves.
 */
export function ReasoningTrail({ items, live, defaultOpen }: { items: TrailItem[]; live?: boolean; defaultOpen?: boolean }) {
  const still = useReducedMotion();
  const density = React.useContext(Density);
  const tools = React.useMemo(() => items.flatMap((i) => (i.kind === "tools" ? i.events : [])), [items]);
  const thinkOnly = items.every((i) => i.kind === "think");
  const notable = React.useMemo(() => notableTools(tools), [tools]);
  const [open, setOpen] = React.useState(defaultOpen ?? (!!live || notable || density === "trace"));
  // Opened or closed by hand: the auto-collapse at the end of the work keeps its hands off.
  const touched = React.useRef(false);
  const wasLive = React.useRef(!!live);
  React.useEffect(() => {
    if (live && !wasLive.current && !touched.current) setOpen(true);
    if (!live && wasLive.current && !touched.current) setOpen(notable || density === "trace");
    wasLive.current = !!live;
  }, [live, notable, density]);
  React.useEffect(() => {
    if (notable) setOpen(true);
  }, [notable]);
  useExpandAll((v) => {
    touched.current = true;
    setOpen(v);
  });

  // The clock: from the first stamped tool call (or mount, for a trail that is all thought) → now.
  const mounted = React.useRef(Date.now());
  const firstAt = tools.find((e) => e.at !== undefined)?.at ?? mounted.current;
  const now = useNow(!!live);
  const span = React.useMemo(() => {
    if (live) return now - firstAt;
    let total = 0;
    let stamped = false;
    for (const i of items) {
      if (i.kind === "think" && i.ms !== undefined) (total += i.ms), (stamped = true);
      if (i.kind === "tools") {
        const first = i.events.find((e) => e.at !== undefined)?.at;
        const last = [...i.events].reverse().find((e) => e.at !== undefined);
        if (first !== undefined && last?.at !== undefined) (total += last.at + (last.ms ?? 0) - first), (stamped = true);
        else for (const e of i.events) if (e.ms !== undefined) (total += e.ms), (stamped = true);
      }
    }
    return stamped ? total : undefined;
  }, [items, live, now, firstAt]);

  // The live label follows the latest step; the finished one sums the work up.
  const last = items[items.length - 1];
  const running = live && last?.kind === "tools" ? [...last.events].reverse().find((e) => !e.result || e.streaming) : undefined;
  const liveLabel = running ? doingLabel(running) : { label: last?.kind === "think" || !last ? "Thinking" : "Working" };
  const facts = React.useMemo(() => (tools.length ? toolFacts(tools) : []), [tools]);
  const failed = tools.filter((e) => e.failed).length;
  const secs = span !== undefined ? formatDuration(span) : null;

  const swap = still
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 5 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -5 }, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <div className="enter min-w-0" data-trail>
      <button
        type="button"
        onClick={() => {
          touched.current = true;
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className={cn(
          "group/trail -ml-1.5 flex max-w-full cursor-pointer items-center gap-2.5 rounded-md py-1 pr-2 pl-1.5 text-left text-meta transition-colors",
          live ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
        )}
      >
        <ThinkingOrb active={live} />
        <span className="sr-only" role="status">
          {live ? liveLabel.label : `Worked for ${secs ?? "a moment"}`}
        </span>
        <span className="flex min-w-0 items-center gap-2" aria-hidden>
          <AnimatePresence mode="popLayout" initial={false}>
            {live ? (
              <motion.span key={`live-${liveLabel.label}`} {...swap} className="shimmer-text shrink-0 font-medium whitespace-nowrap">
                {liveLabel.label}
              </motion.span>
            ) : (
              <motion.span key="done" {...swap} className="shrink-0 font-medium whitespace-nowrap">
                {thinkOnly ? "Thought" : "Worked"}
                {secs && <span className="text-muted-foreground ml-1 font-normal tabular-nums">for {secs}</span>}
              </motion.span>
            )}
          </AnimatePresence>
          <AnimatePresence mode="popLayout" initial={false}>
            {live && liveLabel.detail && (
              <motion.code key={liveLabel.detail} {...swap} className="text-muted-foreground bg-muted min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-micro">
                {liveLabel.detail}
              </motion.code>
            )}
          </AnimatePresence>
          {live && secs && <span className="text-faint shrink-0 text-micro tabular-nums">{secs}</span>}
          <AnimatePresence initial={false}>
            {!live && facts.length > 0 && (
              <motion.span key="facts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="stamp text-muted-foreground min-w-0 truncate">
                {facts.map((f, i) => (
                  <React.Fragment key={f}>
                    {i > 0 && <span className="mx-1 opacity-50">·</span>}
                    {f}
                  </React.Fragment>
                ))}
              </motion.span>
            )}
            {!live && failed > 0 && (
              <motion.span key="failed" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.18 }} className="text-destructive stamp shrink-0">
                {failed} failed
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <ChevronDown className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]", open && "rotate-180")} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={still ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={still ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            transition={still ? { duration: 0 } : { height: SPRING, opacity: { duration: 0.16, ease: [0.22, 1, 0.36, 1] } }}
            className="overflow-hidden"
          >
            <ol className="mt-1.5 flex flex-col pl-0.5">
              {items.map((item, i) => {
                const isLast = i === items.length - 1;
                const liveHere = !!live && isLast;
                if (item.kind === "think") {
                  const sections = sectionsOf(item.text, liveHere);
                  return sections.map((s, j) => (
                    <TrailRow key={`${i}-${j}`} icon={Lightbulb} last={isLast && j === sections.length - 1} live={liveHere && j === sections.length - 1} index={i + j}>
                      {s.heading && <span className={cn("text-muted-foreground block truncate text-meta", liveHere && j === sections.length - 1 && "shimmer-text")}>{s.heading}</span>}
                      {s.body && (
                        <p className={cn("text-meta leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]", s.heading ? "text-foreground/90" : "text-muted-foreground")}>
                          {s.body}
                          {liveHere && j === sections.length - 1 && <span className="caret-steady text-live" aria-hidden>▍</span>}
                        </p>
                      )}
                    </TrailRow>
                  ));
                }
                if (item.kind === "mcp-connect") {
                  return (
                    <TrailRow key={i} icon={Plug} last={isLast} index={i}>
                      <span className="text-muted-foreground block truncate text-meta">
                        Connected to <span className="stamp text-foreground">{item.server}</span>
                      </span>
                    </TrailRow>
                  );
                }
                return <ToolsRow key={i} events={item.events} live={liveHere} last={isLast} index={i} />;
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** One row of the trail: an icon on the hairline, then the content. */
function TrailRow({ icon: Icon, last, live, index, children }: { icon: React.ComponentType<{ className?: string }>; last?: boolean; live?: boolean; index: number; children: React.ReactNode }) {
  const still = useReducedMotion();
  return (
    <motion.li
      initial={still ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={still ? { duration: 0 } : { ...SPRING, delay: Math.min(index, 6) * 0.03 }}
      className={cn("relative flex gap-3", last ? "pb-0" : "pb-4")}
    >
      <span className="relative flex w-4 shrink-0 flex-col items-center">
        <span className={cn("mt-[3px] grid size-4 place-items-center", live ? "text-live" : "text-muted-foreground")}>
          <Icon className="size-3.5" />
        </span>
        {!last && <span className="bg-border absolute top-6 bottom-0 w-px" aria-hidden />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </motion.li>
  );
}

/** A run of tool calls as one trail row: "Ran 3 commands" opening into the numbered step list. */
function ToolsRow({ events, live, last, index }: { events: ToolEvent[]; live?: boolean; last: boolean; index: number }) {
  const density = React.useContext(Density);
  const notable = React.useMemo(() => notableTools(events), [events]);
  const [open, setOpen] = React.useState(!!live || notable || density === "trace");
  React.useEffect(() => {
    if (live || notable) setOpen(true);
  }, [live, notable]);
  const running = live ? [...events].reverse().find((e) => !e.result || e.streaming) : undefined;
  const head = running ? doingLabel(running) : { label: didLabel(events) };
  const failed = events.filter((e) => e.failed).length;
  const Icon = toolsIcon(events);
  return (
    <TrailRow icon={Icon} last={last} live={live} index={index}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="group/row -ml-1 flex w-fit max-w-full cursor-pointer items-center gap-1.5 rounded px-1 text-left text-meta">
        <span className={cn("min-w-0 truncate", live ? "shimmer-text" : "text-muted-foreground group-hover/row:text-foreground transition-colors")}>
          {head.label}
          {head.detail && <code className="ml-1.5 font-mono text-micro text-foreground/80">{head.detail}</code>}
        </span>
        {!live && failed > 0 && (
          <span className="text-destructive inline-flex shrink-0 items-center gap-1 text-micro">
            <AlertTriangle className="size-3" aria-hidden /> {failed} failed
          </span>
        )}
        <ChevronDown className={cn("text-muted-foreground size-3 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ height: SPRING, opacity: { duration: 0.16 } }} className="overflow-hidden">
            <ToolStepsList events={events} live={live} plain />
          </motion.div>
        )}
      </AnimatePresence>
    </TrailRow>
  );
}
