import * as React from "react";
import { Check, CornerDownRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HttpCall, LogLine, LogLevel, TestReport } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";

/** ```http → request list: method chip, path in mono, status toned by class, timing on the right. */
export function HttpBlock({ calls, source }: { calls: HttpCall[]; source: string }) {
  return (
    <VizFrame title={`${calls.length} ${calls.length === 1 ? "request" : "requests"}`} source={source}>
      <div className="max-h-80 overflow-auto px-3 py-1.5">
        {calls.map((c, i) => (
          <div key={i} className="border-border/50 stagger-item flex items-center gap-2.5 border-b py-1.5 last:border-0" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
            <span
              className={cn(
                "w-14 shrink-0 rounded-md border px-1 py-0.5 text-center font-mono text-micro font-semibold",
                c.method === "GET" && "text-live border-live/40",
                c.method === "DELETE" && "text-destructive border-destructive/40",
                (c.method === "POST" || c.method === "PUT" || c.method === "PATCH") && "text-ok border-ok/40",
                !["GET", "DELETE", "POST", "PUT", "PATCH"].includes(c.method) && "text-muted-foreground"
              )}
            >
              {c.method}
            </span>
            <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro" title={c.url}>{c.url}</span>
            {c.status !== undefined && (
              <span
                className={cn(
                  "shrink-0 text-micro font-medium tabular-nums",
                  c.status < 300 ? "text-ok" : c.status < 400 ? "text-live" : c.status < 500 ? "text-attention-text" : "text-destructive"
                )}
              >
                {c.status}
                {c.statusText ? ` ${c.statusText}` : ""}
              </span>
            )}
            {c.time && <span className="text-faint w-14 shrink-0 text-right text-micro tabular-nums">{c.time}</span>}
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

/** ```tests → verdict strip: proportion bar, pass/fail/skip counts with glyphs, failing test names. */
export function TestsBlock({ report, source }: { report: TestReport; source: string }) {
  const total = report.passed + report.failed + report.skipped || 1;
  const ok = report.failed === 0;
  return (
    <VizFrame
      title={ok ? "tests passed" : "tests failed"}
      source={source}
      actions={report.duration ? <span className="text-faint mr-1 text-micro tabular-nums">{report.duration}</span> : undefined}
    >
      <div className="px-4 py-3">
        <div className="flex h-1.5 gap-px overflow-hidden rounded-full" aria-hidden>
          {report.passed > 0 && <span style={{ width: `${(report.passed / total) * 100}%`, background: "var(--ok)" }} />}
          {report.failed > 0 && <span style={{ width: `${(report.failed / total) * 100}%`, background: "var(--destructive)" }} />}
          {report.skipped > 0 && <span style={{ width: `${(report.skipped / total) * 100}%`, background: "var(--muted-foreground)", opacity: 0.4 }} />}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta">
          <span className="text-ok inline-flex items-center gap-1 font-medium">
            <Check className="size-3.5" aria-hidden /> {report.passed} passed
          </span>
          {report.failed > 0 && (
            <span className="text-destructive inline-flex items-center gap-1 font-medium">
              <X className="size-3.5" aria-hidden /> {report.failed} failed
            </span>
          )}
          {report.skipped > 0 && <span className="text-muted-foreground">{report.skipped} skipped</span>}
        </div>
        {report.failures.length > 0 && (
          <ul className="mt-2 flex list-none flex-col gap-0.5 border-t pt-2">
            {report.failures.map((f, i) => (
              <li key={i} className="text-destructive stagger-item flex items-start gap-1.5 font-mono text-micro" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                <X className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span className="min-w-0 break-all">{f}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </VizFrame>
  );
}

const LEVEL_STYLE: Record<LogLevel, string> = {
  error: "text-destructive",
  warn: "text-attention-text",
  info: "text-live",
  debug: "text-faint",
  plain: "text-trace-fg",
};

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
  const levels: LogLevel[] = ["error", "warn", "info", "debug"];
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
      if (row && box) box.scrollTo({ top: row.offsetTop - 12, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    window.setTimeout(() => setFlash((f) => (f === firstError ? null : f)), 1600);
  };
  return (
    <VizFrame
      title={`${lines.length} lines`}
      source={source}
      rawLanguage="text"
      actions={
        <span className="mr-1 flex items-center gap-1">
          {levels.map(
            (lv) =>
              (counts[lv] ?? 0) > 0 && (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setFilter((f) => (f === lv ? null : lv))}
                  aria-pressed={filter === lv}
                  className={cn(
                    "cursor-pointer rounded-full border px-1.5 py-0.5 text-micro font-medium tabular-nums",
                    filter === lv ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {lv} {counts[lv]}
                </button>
              )
          )}
          {firstError >= 0 && (
            <button
              type="button"
              onClick={jump}
              aria-label="Jump to first error"
              title="Jump to first error"
              className="text-muted-foreground hover:text-foreground grid size-6 cursor-pointer place-items-center rounded-md"
            >
              <CornerDownRight className="size-3.5" />
            </button>
          )}
        </span>
      }
    >
      {lines.length > 3 && (
        <label className="flex items-center gap-2 border-b px-3 py-1.5">
          <Search className="text-faint size-3.5 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Search log"
            aria-label="Search log"
            className="text-foreground placeholder:text-faint min-w-0 flex-1 bg-transparent text-meta outline-none"
          />
          {(q || filter) && (
            <span className="text-faint shrink-0 text-micro tabular-nums" aria-live="polite">
              {shown.length} of {lines.length}
            </span>
          )}
        </label>
      )}
      <div ref={scroller} className="bg-trace relative max-h-96 overflow-auto px-4 py-3">
        <pre className="m-0 font-mono text-code whitespace-pre-wrap">
          {shown.length === 0 && <div className="text-faint font-sans text-micro">No lines match.</div>}
          {shown.map(({ l, i }) => (
            <div
              key={i}
              data-line={i}
              className={cn(
                "-mx-2 min-w-0 rounded px-2 transition-colors duration-500 motion-reduce:transition-none [overflow-wrap:anywhere]",
                LEVEL_STYLE[l.level],
                flash === i && "bg-destructive/15"
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

/** Search hits get a quiet series-1 wash \u2014 never the amber "needs you" hue. */
function Mark({ text, q }: { text: string; q: string }) {
  const out: React.ReactNode[] = [];
  const low = text.toLowerCase();
  let at = 0;
  for (let k = low.indexOf(q); k >= 0; k = low.indexOf(q, at)) {
    if (k > at) out.push(text.slice(at, k));
    out.push(
      <mark key={k} className="text-foreground rounded-[2px] bg-[color-mix(in_oklch,var(--viz-1)_30%,transparent)]">
        {text.slice(k, k + q.length)}
      </mark>
    );
    at = k + q.length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}
