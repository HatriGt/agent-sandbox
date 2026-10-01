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
  // A failure that arrives while you watch gets one soft red wash so it is noticed, then settles.
  const bad = h ? h.status >= 500 : row.level === "error";
  return (
    <div
      data-seq={row.seq}
      className={cn(
        "border-border/50 flex min-w-0 items-center gap-2.5 border-b px-3 py-1 last:border-0",
        bad && entrance.className === "viz-row-new" ? "live-row-alert" : entrance.className
      )}
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

/** The 2xx/3xx/4xx/5xx share of every call seen, as one hairline bar whose segments tween. */
function StatusMix({ byClass, total }: { byClass: LiveLogState["byClass"]; total: number }) {
  if (!total) return null;
  const seg: [keyof LiveLogState["byClass"], string][] = [
    ["2xx", "bg-ok"],
    ["3xx", "bg-muted-foreground/50"],
    ["4xx", "bg-foreground/60"],
    ["5xx", "bg-destructive"],
  ];
  return (
    <div className="bg-muted flex h-1 w-full gap-px overflow-hidden rounded-full" aria-hidden data-status-mix>
      {seg.map(([k, tone]) => (
        <span key={k} className={cn("viz-tween-w h-full", tone)} style={{ width: `${(byClass[k] / total) * 100}%` }} />
      ))}
    </div>
  );
}

const AT_BOTTOM_PX = 16;
const FOLLOW_MS = 220;

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function LiveLogView({ state, live, className }: { state: LiveLogState; live: boolean; className?: string }) {
  const kind = liveKind(state) ?? "levelled";
  const scroller = React.useRef<HTMLDivElement>(null);
  const atBottom = React.useRef(true);
  const lastSeq = state.rows[state.rows.length - 1]?.seq ?? -1;
  const seenSeq = React.useRef(lastSeq);
  const [unseen, setUnseen] = React.useState(0);
  const keys = React.useMemo(() => state.rows.map((r) => String(r.seq)), [state.rows]);
  const entrance = useRowEntrance(keys);

  const [scrolled, setScrolled] = React.useState(false);
  // Following the tail glides instead of jumping. While the glide runs, onScroll must not read the
  // mid-way position as "the reader scrolled up".
  const gliding = React.useRef(0);
  const glide = React.useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    cancelAnimationFrame(gliding.current);
    const from = el.scrollTop;
    if (reducedMotion() || el.scrollHeight - el.clientHeight - from > el.clientHeight * 2) {
      el.scrollTop = el.scrollHeight;
      gliding.current = 0;
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / FOLLOW_MS);
      const to = el.scrollHeight - el.clientHeight; // re-read: rows may land mid-glide
      el.scrollTop = from + (to - from) * (1 - Math.pow(1 - p, 3));
      gliding.current = p < 1 ? requestAnimationFrame(step) : 0;
    };
    gliding.current = requestAnimationFrame(step);
  }, []);
  React.useEffect(() => () => cancelAnimationFrame(gliding.current), []);

  const toBottom = React.useCallback(() => {
    atBottom.current = true;
    setUnseen(0);
    glide();
  }, [glide]);

  // Follow the tail only when the reader is already there; otherwise count what arrived below.
  React.useLayoutEffect(() => {
    const added = lastSeq - seenSeq.current;
    seenSeq.current = lastSeq;
    if (added <= 0) return;
    if (atBottom.current) glide();
    else setUnseen((n) => n + added);
  }, [lastSeq, glide]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setScrolled(el.scrollTop > 2);
    if (gliding.current) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    if (atBottom.current) setUnseen(0);
  };

  const p = p95(state.latencies);
  const hidden = state.lines - state.rows.length;
  return (
    <div data-live-log={kind} data-live={live ? "" : undefined} className={cn("bg-card overflow-hidden rounded-md border", className)}>
      <div className="flex flex-col gap-2 border-b px-3 py-2">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2" aria-live="off">
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
      {kind === "access" && <StatusMix byClass={state.byClass} total={state.total} />}
      </div>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          tabIndex={0}
          role="log"
          aria-label={kind === "access" ? "Incoming requests" : "Log lines"}
          className={cn(
            "focus-visible:ring-ring max-h-80 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset",
            scrolled && "live-fade-top"
          )}
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
            className="pop-in bg-foreground text-background hover:bg-foreground/85 absolute bottom-2 transition-colors left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-micro font-medium shadow-md"
          >
            <ArrowDown className="size-3" aria-hidden />
            {unseen} new
          </button>
        )}
      </div>
    </div>
  );
}
