import * as React from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { createLiveLog, feedLiveLog, formatMs, liveKind, p95, type LiveLogState, type LiveRow, type LogLevelName } from "@/lib/viz-live-log";
import { RollNumber, useRowEntrance } from "./motion";

/**
 * A command's output drawn AS IT STREAMS (`tail -f`, `kubectl logs -f`): a strip of rolling
 * counters over everything seen, then the newest rows appending at the bottom. The tally is fed
 * incrementally (lib/viz-live-log.ts) and lives in a ref, so a growing source parses only its new
 * lines and the component never remounts when the command finishes. docs/output-visualizers.md
 * "Live (streaming)".
 */

/** The live tally for a growing text; `final` also takes an unterminated last line. */
export function useLiveLog(text: string, final: boolean): LiveLogState {
  const ref = React.useRef<LiveLogState>(createLiveLog());
  return React.useMemo(() => {
    ref.current = feedLiveLog(ref.current, text, { final });
    return ref.current;
  }, [text, final]);
}

const LEVEL_TONE: Record<LogLevelName, string> = {
  error: "text-destructive",
  warn: "text-amber-600 dark:text-amber-300/90",
  info: "text-live",
  debug: "text-faint",
};

function statusTone(status: number): string {
  if (status >= 500) return "text-destructive border-destructive/40 bg-destructive/10";
  if (status >= 400) return "text-foreground border-line-strong bg-muted";
  if (status >= 300) return "text-muted-foreground border-border";
  return "text-ok border-ok/40 bg-ok/10";
}

function Counter({ label, value, tone, title }: { label: string; value: string; tone?: string; title?: string }) {
  return (
    <span className="flex min-w-0 flex-col" title={title}>
      <span className="label text-faint">{label}</span>
      <RollNumber text={value} className={cn("text-meta font-semibold tabular-nums", tone)} />
    </span>
  );
}

function Row({ row, entrance }: { row: LiveRow; entrance: { className: string; style?: React.CSSProperties } }) {
  const h = row.hit;
  return (
    <div
      data-seq={row.seq}
      className={cn("border-border/50 flex min-w-0 items-center gap-2.5 border-b px-3 py-1 last:border-0", entrance.className)}
      style={entrance.style}
    >
      {h ? (
        <>
          <span className="text-muted-foreground w-14 shrink-0 font-mono text-micro font-semibold">{h.method}</span>
          <span className="text-foreground min-w-0 flex-1 truncate font-mono text-code" title={row.text}>
            {h.path}
          </span>
          <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-micro font-semibold tabular-nums", statusTone(h.status))}>{h.status}</span>
          <span className="text-faint w-14 shrink-0 text-right font-mono text-micro tabular-nums">{h.ms !== undefined ? formatMs(h.ms) : ""}</span>
        </>
      ) : (
        <>
          <span className={cn("w-12 shrink-0 font-mono text-micro font-semibold uppercase", row.level ? LEVEL_TONE[row.level] : "text-faint")}>{row.level ?? ""}</span>
          <span className={cn("min-w-0 flex-1 font-mono text-code [overflow-wrap:anywhere]", row.level === "error" ? "text-destructive" : "text-foreground/85")}>{row.text}</span>
        </>
      )}
    </div>
  );
}

const AT_BOTTOM_PX = 16;

export function LiveLogView({ state, live, className }: { state: LiveLogState; live: boolean; className?: string }) {
  const kind = liveKind(state) ?? "levelled";
  const scroller = React.useRef<HTMLDivElement>(null);
  const atBottom = React.useRef(true);
  const lastSeq = state.rows[state.rows.length - 1]?.seq ?? -1;
  const seenSeq = React.useRef(lastSeq);
  const [unseen, setUnseen] = React.useState(0);
  const keys = React.useMemo(() => state.rows.map((r) => String(r.seq)), [state.rows]);
  const entrance = useRowEntrance(keys);

  const toBottom = React.useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setUnseen(0);
  }, []);

  // Follow the tail only when the reader is already there; otherwise count what arrived below.
  React.useLayoutEffect(() => {
    const added = lastSeq - seenSeq.current;
    seenSeq.current = lastSeq;
    if (added <= 0) return;
    if (atBottom.current) {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else setUnseen((n) => n + added);
  }, [lastSeq]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    if (atBottom.current) setUnseen(0);
  };

  const p = p95(state.latencies);
  const hidden = state.lines - state.rows.length;
  return (
    <div data-live-log={kind} data-live={live ? "" : undefined} className={cn("bg-card overflow-hidden rounded-md border", className)}>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 border-b px-3 py-2" aria-live="off">
        {kind === "access" ? (
          <>
            <Counter label="calls" value={String(state.total)} />
            <Counter label="2xx" value={String(state.byClass["2xx"])} tone={state.byClass["2xx"] ? "text-ok" : "text-faint"} />
            <Counter label="3xx" value={String(state.byClass["3xx"])} tone="text-muted-foreground" />
            <Counter label="4xx" value={String(state.byClass["4xx"])} tone={state.byClass["4xx"] ? "text-foreground" : "text-faint"} />
            <Counter label="5xx" value={String(state.byClass["5xx"])} tone={state.byClass["5xx"] ? "text-destructive" : "text-faint"} />
            <Counter label="errors" value={String(state.errors)} tone={state.errors ? "text-destructive" : "text-faint"} />
            <Counter label="p95" value={formatMs(p)} title={p === null ? "No latency in these lines" : `p95 of ${state.latencies.length} timed calls`} />
          </>
        ) : (
          <>
            <Counter label="lines" value={String(state.lines)} />
            <Counter label="errors" value={String(state.errors)} tone={state.errors ? "text-destructive" : "text-faint"} />
            <Counter label="warnings" value={String(state.warns)} tone={state.warns ? "text-foreground" : "text-faint"} />
            {state.total > 0 && <Counter label="calls" value={String(state.total)} />}
          </>
        )}
        <span className="ml-auto flex items-center gap-1.5 self-center">
          {live ? (
            <>
              <span className="bg-live breathe size-1.5 rounded-full" aria-hidden />
              <span className="label text-live">live</span>
            </>
          ) : (
            <span className="label text-faint">ended</span>
          )}
        </span>
      </div>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          tabIndex={0}
          role="log"
          aria-label={kind === "access" ? "Incoming requests" : "Log lines"}
          className="focus-visible:ring-ring max-h-80 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          {hidden > 0 && <div className="text-faint px-3 py-1 text-micro">{hidden} earlier {hidden === 1 ? "line" : "lines"} counted above, not shown</div>}
          {state.rows.map((r) => (
            <Row key={r.seq} row={r} entrance={entrance(String(r.seq))} />
          ))}
        </div>
        {unseen > 0 && (
          <button
            type="button"
            onClick={toBottom}
            className="bg-foreground text-background absolute bottom-2 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-micro font-medium shadow-md"
          >
            <ArrowDown className="size-3" aria-hidden />
            {unseen} new
          </button>
        )}
      </div>
    </div>
  );
}
