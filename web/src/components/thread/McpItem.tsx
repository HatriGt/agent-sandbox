import * as React from "react";
import { AlertTriangle, Check, ChevronRight, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { analyzeResult, argIsCode, mcpSummary, TABLE_PREVIEW_ROWS, type McpCall, type McpResultView } from "@/lib/mcp";
import type { TraceEvent } from "@/lib/trace";
import { cn } from "@/lib/utils";

/**
 * An MCP call in the thread — visibly a THIRD thing beside the step row (local file work) and the
 * terminal panel (shell): this step left the sandbox. The server is a color-stable chip (hue hashed
 * from its name), the wire name is humanized, and the result renders as DATA — a table for row
 * sets, a key/value grid for records, pretty JSON otherwise — never a one-line blob.
 *
 * Motion: while in flight, energy flows chip→tool along a dashed line and the card carries the live
 * ring; on arrival the result summary counts up and the body reveals with the shared spring ease.
 * All of it sits under `motion-reduce:` so the reduced-motion crowd gets a calm static card.
 */

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

const EASE = [0.22, 1, 0.36, 1] as const;

/** The server chip: identity by hue. Same server, same tint, every run, both themes. */
function ServerChip({ server, hue, live }: { server: string; hue: number; live?: boolean }) {
  const style = {
    "--srv": `oklch(0.62 0.14 ${hue})`,
    "--srv-soft": `oklch(0.62 0.14 ${hue} / 0.12)`,
    "--srv-line": `oklch(0.62 0.14 ${hue} / 0.35)`,
  } as React.CSSProperties;
  return (
    <span
      style={style}
      className="relative inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--srv-line)] bg-[var(--srv-soft)] px-1.5 py-0.5 text-micro font-semibold text-[var(--srv)]"
    >
      <span className="relative grid size-3.5 place-items-center" aria-hidden>
        {live && <span className="absolute inset-0 rounded-full bg-[var(--srv)] opacity-30 mcp-ping motion-reduce:hidden" />}
        <Zap className="size-3" strokeWidth={2.5} />
      </span>
      {server}
    </span>
  );
}

/** The dashed connector between chip and tool label: energy flows while the call is in flight. */
function Connector({ live, failed }: { live?: boolean; failed?: boolean }) {
  return (
    <svg className="h-2 w-6 shrink-0" viewBox="0 0 24 8" aria-hidden>
      <path
        d="M1 4 H23"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="3 4"
        className={cn(
          live ? "text-live flow-dash motion-reduce:animate-none" : failed ? "text-destructive/60" : "text-muted-foreground/40"
        )}
      />
    </svg>
  );
}

export function McpItem({ event, call, hue, live }: { event: ToolEvent; call: McpCall; hue: number; live?: boolean }) {
  const view = React.useMemo(() => analyzeResult(event.result), [event.result]);
  const hasResult = !!event.result;
  const summary = mcpSummary(view);
  // A failed external call is exactly what the operator must see: open it by default.
  const [open, setOpen] = React.useState(!!event.failed);
  React.useEffect(() => {
    if (event.failed) setOpen(true);
  }, [event.failed]);
  const codeArg = argIsCode(event.arg);

  return (
    <div className="enter min-w-0">
      <div
        className={cn(
          "bg-card overflow-hidden rounded-lg border transition-shadow duration-300",
          live ? "border-live/35 shadow-[0_0_0_3px_color-mix(in_oklch,var(--live)_10%,transparent)]" : "shadow-e1",
          event.failed && !live && "border-destructive/40"
        )}
      >
        {/* header: chip ~~ tool · status */}
        <button
          type="button"
          onClick={() => hasResult && setOpen((v) => !v)}
          disabled={!hasResult}
          aria-expanded={hasResult ? open : undefined}
          className={cn(
            "flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left",
            hasResult && "hover:bg-muted/50 cursor-pointer transition-colors"
          )}
        >
          <ServerChip server={call.server} hue={hue} live={live} />
          <Connector live={live} failed={event.failed} />
          <span className="text-foreground min-w-0 truncate text-meta font-medium">{call.label}</span>
          {!codeArg && event.arg && (
            <code className="text-muted-foreground bg-muted min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-micro">{event.arg}</code>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {live ? (
              <span className="text-live flex items-center gap-1.5 text-micro font-medium">
                <span className="bg-live breathe size-1.5 rounded-full" aria-hidden />
                calling
              </span>
            ) : event.failed ? (
              <span className="text-destructive flex items-center gap-1 text-micro font-medium">
                <AlertTriangle className="size-3" aria-hidden /> failed
              </span>
            ) : hasResult ? (
              <motion.span
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="text-muted-foreground flex items-center gap-1 text-micro tabular-nums"
              >
                <Check className="text-ok size-3" strokeWidth={2.5} aria-hidden />
                {summary}
              </motion.span>
            ) : null}
            {hasResult && (
              <ChevronRight className={cn("text-muted-foreground size-3.5 transition-transform duration-200", open && "rotate-90")} aria-hidden />
            )}
          </span>
        </button>

        {/* a code-shaped arg (SQL / JSON / multiline) gets its own mono strip, always visible */}
        {codeArg && (
          <pre className="bg-trace text-trace-fg/90 border-t border-white/8 px-3 py-2 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]">
            {event.arg}
            {live && !hasResult && <span className="caret text-live" aria-hidden>▍</span>}
          </pre>
        )}

        {/* in-flight body: shimmer bars where the data will land, so arrival feels like a settle */}
        {live && !hasResult && !codeArg && (
          <div className="border-t px-3 py-2.5 motion-reduce:hidden" aria-hidden>
            <div className="flex flex-col gap-1.5">
              <div className="shimmer h-2 w-3/5 rounded" />
              <div className="shimmer h-2 w-2/5 rounded" style={{ animationDelay: "0.15s" }} />
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {hasResult && open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="overflow-hidden border-t"
            >
              <ResultBody view={view} raw={event.result!} />
            </motion.div>
          )}
        </AnimatePresence>
        {hasResult && !open && !event.failed && view.kind !== "empty" && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-2 border-t px-3 py-1.5 text-left text-micro transition-colors"
          >
            <span className="text-faint select-none">›</span>
            <span className="truncate">{summary}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── result renderers ───────────────────────────── */

function ResultBody({ view, raw }: { view: McpResultView; raw: string }) {
  switch (view.kind) {
    case "table":
      return <ResultTable view={view} />;
    case "kv":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 py-2.5">
          {view.entries.map(([k, v], i) => (
            <motion.div
              key={k}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18, delay: Math.min(i, 8) * 0.03 }}
              className="contents"
            >
              <dt className="text-muted-foreground truncate font-mono text-micro leading-5">{k}</dt>
              <dd className="text-foreground min-w-0 truncate text-meta leading-5" title={v}>
                {v || <span className="text-faint">—</span>}
              </dd>
            </motion.div>
          ))}
        </dl>
      );
    case "json":
      return (
        <pre className="text-foreground/85 max-h-80 overflow-auto px-3 py-2 font-mono text-code whitespace-pre-wrap">{view.pretty}</pre>
      );
    case "text":
      return <pre className="text-foreground/85 max-h-80 overflow-auto px-3 py-2 font-mono text-code whitespace-pre-wrap">{view.text}</pre>;
    case "empty":
      return <p className="text-faint px-3 py-2 text-micro">{raw.trim() ? raw.trim().slice(0, 200) : "no data returned"}</p>;
  }
}

/** Row set as a real table: sticky header, staggered row reveal, capped preview with a "+N more". */
function ResultTable({ view }: { view: Extract<McpResultView, { kind: "table" }> }) {
  const [all, setAll] = React.useState(false);
  const rows = all ? view.rows : view.rows.slice(0, TABLE_PREVIEW_ROWS);
  const hidden = view.rows.length - rows.length;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full border-collapse text-meta">
        <thead>
          <tr className="bg-card sticky top-0 z-10">
            {view.columns.map((c) => (
              <th key={c} className="text-muted-foreground border-b px-3 py-1.5 text-left font-mono text-micro font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <motion.tr
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, delay: Math.min(i, 10) * 0.025 }}
              className="hover:bg-muted/40 border-b border-border/50 last:border-0"
            >
              {r.map((v, j) => (
                <td key={j} className="text-foreground max-w-[28ch] truncate px-3 py-1 tabular-nums" title={v}>
                  {v || <span className="text-faint">—</span>}
                </td>
              ))}
            </motion.tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="text-muted-foreground hover:text-foreground w-full cursor-pointer border-t px-3 py-1.5 text-left text-micro transition-colors"
        >
          + {hidden} more {hidden === 1 ? "row" : "rows"}
        </button>
      )}
    </div>
  );
}
