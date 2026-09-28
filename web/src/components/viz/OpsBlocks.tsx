import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HttpCall, LogLine, LogLevel, TestReport } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";

/** ```http → request list: method chip, path in mono, status toned by class, timing on the right. */
export function HttpBlock({ calls, source }: { calls: HttpCall[]; source: string }) {
  return (
    <VizFrame title={`${calls.length} ${calls.length === 1 ? "request" : "requests"}`} source={source}>
      <div className="max-h-80 overflow-auto px-3 py-1.5">
        {calls.map((c, i) => (
          <div key={i} className="border-border/50 flex items-center gap-2.5 border-b py-1.5 last:border-0">
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
            <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro">{c.url}</span>
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
              <li key={i} className="text-destructive flex items-start gap-1.5 font-mono text-micro">
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
  const shown = filter ? lines.filter((l) => l.level === filter || (filter === "error" && l.level === "error")) : lines;
  const levels: LogLevel[] = ["error", "warn", "info", "debug"];
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
        </span>
      }
    >
      <div className="bg-trace max-h-96 overflow-auto px-4 py-3">
        <pre className="m-0 font-mono text-code whitespace-pre-wrap">
          {shown.map((l, i) => (
            <div key={i} className={cn("min-w-0 [overflow-wrap:anywhere]", LEVEL_STYLE[l.level])}>
              {l.text || " "}
            </div>
          ))}
        </pre>
      </div>
    </VizFrame>
  );
}
