import * as React from "react";
import { resolvedReduced } from "@/lib/motion-pref";
import { Check, CornerDownRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HttpCall, LogLine, LogLevel, TestReport } from "@/lib/viz-extra";
import { count, VizEmpty, VizFrame, VizSearch } from "./VizFrame";
import { RollNumber, useRowEntrance } from "./motion";
import { Pill, type Tone } from "./tone";

const METHOD_TONE: Record<string, Tone> = { GET: "live", DELETE: "fail", POST: "ok", PUT: "ok", PATCH: "ok" };

function statusTone(status: number): Tone {
  return status < 300 ? "ok" : status < 400 ? "live" : status < 500 ? "warn" : "fail";
}

/** ```http → request list: method chip, path in mono, status chip toned by class, timing on the right. */
export function HttpBlock({ calls, source }: { calls: HttpCall[]; source: string }) {
  const entrance = useRowEntrance(calls.map((c, i) => `${i}|${c.method}|${c.url}`));
  return (
    <VizFrame title={count(calls.length, "request")} source={source}>
      <ul className="m-0 max-h-80 list-none overflow-auto p-0">
        {calls.map((c, i) => {
          const e = entrance(`${i}|${c.method}|${c.url}`);
          return (
            <li key={i} className={cn("flex items-center gap-2.5 px-4 py-1.5", i > 0 && "border-border/60 border-t", e.className)} style={e.style}>
              <Pill tone={METHOD_TONE[c.method] ?? "neutral"} round={false} className="w-14 justify-center font-mono font-semibold">
                {c.method}
              </Pill>
              <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro" title={c.url}>
                {c.url}
              </span>
              {c.status !== undefined && (
                <Pill tone={statusTone(c.status)}>
                  {c.status}
                  {c.statusText ? ` ${c.statusText}` : ""}
                </Pill>
              )}
              {c.time && <span className="text-faint w-14 shrink-0 text-right text-micro tabular-nums">{c.time}</span>}
            </li>
          );
        })}
      </ul>
    </VizFrame>
  );
}

/** ```tests → verdict strip: proportion bar, pass/fail/skip counts with glyphs, failing test names. */
export function TestsBlock({ report, source }: { report: TestReport; source: string }) {
  const total = report.passed + report.failed + report.skipped || 1;
  const ok = report.failed === 0;
  const entrance = useRowEntrance(report.failures);
  return (
    <VizFrame
      title={ok ? "tests passed" : "tests failed"}
      source={source}
      actions={report.duration ? <span className="text-faint mr-1 text-micro tabular-nums">{report.duration}</span> : undefined}
    >
      <div className="px-4 py-3">
        {/* Segments grow from the left once, as one bar; later counts re-flow by width. */}
        <div className="viz-grow-x flex h-1.5 origin-left gap-px overflow-hidden rounded-full" aria-hidden>
          {report.passed > 0 && <span className="viz-tween-w" style={{ width: `${(report.passed / total) * 100}%`, background: "var(--ok)" }} />}
          {report.failed > 0 && <span className="viz-tween-w" style={{ width: `${(report.failed / total) * 100}%`, background: "var(--destructive)" }} />}
          {report.skipped > 0 && <span className="viz-tween-w" style={{ width: `${(report.skipped / total) * 100}%`, background: "var(--muted-foreground)", opacity: 0.4 }} />}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-meta tabular-nums">
          <span className="text-ok inline-flex items-center gap-1 font-medium">
            <Check className="size-3.5" strokeWidth={2} aria-hidden /> <RollNumber text={String(report.passed)} /> passed
          </span>
          {report.failed > 0 && (
            <span className="text-destructive inline-flex items-center gap-1 font-medium">
              <X className="size-3.5" strokeWidth={2} aria-hidden /> <RollNumber text={String(report.failed)} /> failed
            </span>
          )}
          {report.skipped > 0 && <span className="text-muted-foreground">{report.skipped} skipped</span>}
        </div>
      </div>
      {report.failures.length > 0 && (
        <ul className="m-0 flex list-none flex-col border-t p-0">
          {report.failures.map((f, i) => {
            const e = entrance(f);
            return (
              <li key={i} className={cn("text-destructive flex items-start gap-2 px-4 py-1.5 font-mono text-micro", i > 0 && "border-border/60 border-t", e.className)} style={e.style}>
                <X className="mt-0.5 size-3 shrink-0" strokeWidth={2} aria-hidden />
                <span className="min-w-0 break-all">{f}</span>
              </li>
            );
          })}
        </ul>
      )}
    </VizFrame>
  );
}

// The log ground (--trace) is dark in both themes, so the light amber hue is the readable warn ink.
const LEVEL_STYLE: Record<LogLevel, string> = {
  error: "text-destructive",
  warn: "text-warn",
  info: "text-live",
  debug: "text-faint",
  plain: "text-trace-fg",
};

const LEVEL_HUE: Record<Exclude<LogLevel, "plain">, string> = {
  error: "var(--destructive)",
  warn: "var(--warn)",
  info: "var(--live)",
  debug: "var(--faint)",
};

/** A content action, not chrome: always visible, unlike the header's copy/raw/maximize. */
const JUMP_BUTTON =
  "viz-press text-muted-foreground hover:text-foreground hover:bg-muted/70 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md transition-[color,background-color] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

/** ```log → terminal-ground viewer with level coloring and one-click level filters. */
export function LogBlock({ lines, source }: { lines: LogLine[]; source: string }) {
  const [filter, setFilter] = React.useState<LogLevel | null>(null);
  const counts = React.useMemo(() => {
    const c: Partial<Record<LogLevel, number>> = {};
    for (const l of lines) c[l.level] = (c[l.level] ?? 0) + 1;
    return c;
  }, [lines]);
  const [query, setQuery] = React.useState("");
  const [flash, setFlash] = React.useState<number | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  // Keep the original line index so "jump to first error" can find its row under any filter.
  const shown = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => (!filter || l.level === filter) && (!q || l.text.toLowerCase().includes(q)));
  const levels: Exclude<LogLevel, "plain">[] = ["error", "warn", "info", "debug"];
  const firstError = lines.findIndex((l) => l.level === "error");
  const jump = () => {
    if (firstError < 0) return;
    // The error must be visible to scroll to it: drop a filter or search that would hide it.
    if (filter && filter !== "error") setFilter(null);
    if (q && !lines[firstError].text.toLowerCase().includes(q)) setQuery("");
    setFlash(firstError);
    requestAnimationFrame(() => {
      const row = scroller.current?.querySelector<HTMLElement>(`[data-line="${firstError}"]`);
      const box = scroller.current;
      if (row && box) box.scrollTo({ top: row.offsetTop - 12, behavior: resolvedReduced() ? "auto" : "smooth" });
    });
    window.setTimeout(() => setFlash((f) => (f === firstError ? null : f)), 1600);
  };
  return (
    <VizFrame
      title={count(lines.length, "line")}
      source={source}
      rawLanguage="text"
      actions={
        <span className="mr-0.5 flex items-center gap-1">
          {levels.map(
            (lv) =>
              (counts[lv] ?? 0) > 0 && (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setFilter((f) => (f === lv ? null : lv))}
                  aria-pressed={filter === lv}
                  className={cn(
                    "viz-press inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full border px-2 text-micro font-medium tabular-nums transition-[color,background-color,border-color] duration-150 ease-(--viz-ease) outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    filter === lv ? "bg-muted text-foreground border-line-strong" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: LEVEL_HUE[lv] }} />
                  {lv} {counts[lv]}
                </button>
              )
          )}
          {firstError >= 0 && (
            <button type="button" onClick={jump} aria-label="Jump to first error" title="Jump to first error" className={JUMP_BUTTON}>
              <CornerDownRight className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
        </span>
      }
    >
      {lines.length > 3 && (
        <VizSearch
          className="border-b"
          value={query}
          onChange={setQuery}
          placeholder="Search log"
          count={q || filter ? `${shown.length} of ${lines.length}` : undefined}
        />
      )}
      {shown.length === 0 && (
        <VizEmpty
          onClear={() => {
            setQuery("");
            setFilter(null);
          }}
        >
          No lines match.
        </VizEmpty>
      )}
      {/* Stays mounted while empty: "jump to first error" scrolls it in the frame after clearing. */}
      <div ref={scroller} hidden={shown.length === 0} className="bg-trace relative max-h-96 overflow-auto px-4 py-3">
          <pre className="m-0 font-mono text-code whitespace-pre-wrap">
            {shown.map(({ l, i }) => (
              <div
                key={i}
                data-line={i}
                className={cn(
                  // The jump flash lands at once and fades out slowly: it marks where you are, then leaves.
                  "-mx-2 min-w-0 rounded px-2 [overflow-wrap:anywhere]",
                  flash === i ? "bg-destructive/20" : "transition-[background-color] duration-700 ease-(--viz-ease)",
                  LEVEL_STYLE[l.level]
                )}
              >
                {q ? <Mark text={l.text} q={q} /> : l.text || "\u00a0"}
              </div>
            ))}
          </pre>
        </div>
    </VizFrame>
  );
}

/** Search hits get a quiet series-1 wash, never the amber "action needed" hue. */
function Mark({ text, q }: { text: string; q: string }) {
  const out: React.ReactNode[] = [];
  const low = text.toLowerCase();
  let at = 0;
  for (let k = low.indexOf(q); k >= 0; k = low.indexOf(q, at)) {
    if (k > at) out.push(text.slice(at, k));
    out.push(
      <mark key={k} className="text-foreground rounded-[2px] bg-[color-mix(in_oklab,var(--viz-1)_30%,transparent)]">
        {text.slice(k, k + q.length)}
      </mark>
    );
    at = k + q.length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}
