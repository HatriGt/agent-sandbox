import * as React from "react";
import { motion } from "motion/react";
import { api, type LedgerRow, type LedgerTotals } from "@/lib/api";
import { runDuration, tokensOf } from "@/lib/history-format";
import { fmtDuration } from "@/lib/lifecycle";
import { fmtTokens } from "@/components/thread/OutcomeCard";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

const DAYS = 14;

/**
 * Home's pulse: four numbers about the fleet's last two weeks, each over a 14-day bar line. Runs
 * today, success over 7 days, tokens over 7 days, median run time over 7 days. Hovering a bar puts
 * that day's figure and date in the tile. Days are the viewer's local days. Nothing shows until the
 * account has a finished run in the window: an empty strip is a claim, not a picture.
 *
 * Sources: /history/activity.json (every finish and whether it failed, so counts and rates are
 * exact), /history/ledger.json totals since 7 days (exact tokens) and its rows (up to 200, for
 * per-day tokens and run times).
 */
export function HubPulse() {
  const [data, setData] = React.useState<Pulse | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    const days = dayStarts();
    const since14 = days[0];
    const since7 = days[DAYS - 7];
    Promise.all([
      api.historyActivity(since14, ctrl.signal),
      api.ledger({ since: since14, limit: 200 }, ctrl.signal),
      api.ledger({ since: since7, limit: 1 }, ctrl.signal),
    ]).then(
      ([act, rows14, week]) => setData(build(days, act.runs, rows14.rows, week.totals)),
      () => {
        if (!ctrl.signal.aborted) setData(null);
      }
    );
    return () => ctrl.abort();
  }, []);
  if (!data || data.total === 0) return null;
  return (
    <motion.section
      aria-label="Fleet pulse, last 14 days"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="@container/pulse"
    >
      <div className="bg-card grid grid-cols-2 overflow-hidden rounded-xl border @md/pulse:grid-cols-4 [&>*]:border-border [&>*:nth-child(odd)]:border-r @md/pulse:[&>*]:border-r @md/pulse:[&>*:last-child]:border-r-0 [&>*:nth-child(-n+2)]:border-b @md/pulse:[&>*]:border-b-0">
        {data.tiles.map((t) => (
          <Tile key={t.label} tile={t} days={data.days} />
        ))}
      </div>
    </motion.section>
  );
}

interface TileData {
  label: string;
  value: string;
  sub: React.ReactNode;
  /** One per day, oldest first; null for a day with nothing to measure. */
  bars: (number | null)[];
  /** The day's figure in the tile while its bar is hovered, and what to say under it beside the date. */
  dayValue: (i: number) => { value: string; note?: string };
  /** The part of each bar (same unit) drawn in the destructive tone on top: a day's failed runs. */
  bad?: number[];
}

interface Pulse {
  days: number[];
  total: number;
  tiles: TileData[];
}

function Tile({ tile, days }: { tile: TileData; days: number[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const still = useReducedMotion();
  const max = Math.max(1, ...tile.bars.map((b) => b ?? 0));
  const day = hover === null ? null : new Date(days[hover]);
  const hovered = hover === null ? null : tile.dayValue(hover);
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 pt-3.5 pb-3" aria-label={`${tile.label}: ${tile.value}`}>
      <span className="text-muted-foreground truncate text-micro">{tile.label}</span>
      <span className="text-foreground tabular text-h2 leading-none font-semibold tracking-[-0.02em]">{hovered ? hovered.value : tile.value}</span>
      <span className="text-faint min-h-4 truncate text-micro">
        {day ? [day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), hovered?.note].filter(Boolean).join(" · ") : tile.sub}
      </span>
      <div className="mt-1.5 flex h-7 items-end gap-[3px]" onMouseLeave={() => setHover(null)} aria-hidden>
        {tile.bars.map((b, i) => {
          const today = i === tile.bars.length - 1;
          const h = b === null ? 0 : Math.max(0.08, b / max);
          const bad = b ? Math.min(1, (tile.bad?.[i] ?? 0) / b) : 0;
          const lit = hover === i || (hover === null && today);
          return (
            <span key={i} className="flex h-full min-w-0 flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
              <motion.span
                initial={still ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.45, delay: still ? 0 : 0.15 + i * 0.022, ease: [0.22, 1, 0.36, 1] }}
                style={{ height: b === null ? 2 : `${h * 100}%`, transformOrigin: "bottom" }}
                className={cn(
                  "flex w-full flex-col overflow-hidden rounded-[2px] transition-colors duration-150",
                  b === null ? "bg-border" : lit ? "bg-foreground/80" : "bg-foreground/22"
                )}
              >
                {bad > 0 && <span className={cn("block w-full transition-colors duration-150", lit ? "bg-destructive" : "bg-destructive/70")} style={{ height: `${bad * 100}%` }} />}
              </motion.span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Local midnights, oldest first, ending with today. */
function dayStarts(): number[] {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const out: number[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(x.getTime());
  }
  return out;
}

function dayOf(days: number[], t: number): number {
  for (let i = days.length - 1; i >= 0; i--) if (t >= days[i]) return i;
  return -1;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function build(days: number[], act: { t: number; failed: boolean }[], rows: LedgerRow[], week: LedgerTotals): Pulse {
  const runs = new Array<number>(DAYS).fill(0);
  const fails = new Array<number>(DAYS).fill(0);
  for (const r of act) {
    const i = dayOf(days, r.t);
    if (i < 0) continue;
    runs[i]++;
    if (r.failed) fails[i]++;
  }
  const tokens = new Array<number>(DAYS).fill(0);
  const durs: number[][] = Array.from({ length: DAYS }, () => []);
  for (const r of rows) {
    const i = dayOf(days, r.endedAt ?? r.archivedAt);
    if (i < 0) continue;
    tokens[i] += tokensOf(r) ?? 0;
    const d = runDuration(r);
    if (d != null) durs[i].push(d);
  }
  const sum = (xs: number[], from: number, to: number) => xs.slice(from, to).reduce((a, b) => a + b, 0);
  const rate = (from: number, to: number) => {
    const n = sum(runs, from, to);
    return n ? (n - sum(fails, from, to)) / n : null;
  };
  const thisWeek = rate(DAYS - 7, DAYS);
  const lastWeek = rate(0, DAYS - 7);
  const pts = thisWeek !== null && lastWeek !== null ? Math.round((thisWeek - lastWeek) * 100) : null;
  const weekTokens = week.inputTokens + week.outputTokens;
  const weekDurs = durs.slice(DAYS - 7).flat();
  const med = median(weekDurs);
  const dayMed = durs.map(median);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return {
    days,
    total: sum(runs, 0, DAYS),
    tiles: [
      {
        label: "Runs today",
        value: String(runs[DAYS - 1]),
        sub: `${runs[DAYS - 2]} yesterday`,
        bars: runs,
        dayValue: (i) => ({ value: String(runs[i]) }),
      },
      {
        label: "Success · 7 days",
        value: thisWeek === null ? "—" : pct(thisWeek),
        sub:
          pts === null || pts === 0 ? (
            `${plural(sum(fails, DAYS - 7, DAYS), "failure")} this week`
          ) : (
            <span className={pts > 0 ? "text-ok" : "text-destructive"}>
              {pts > 0 ? "▲" : "▼"} {Math.abs(pts)} pts vs last week
            </span>
          ),
        // Each day's runs, its failures stacked in red on top: the rate and its cause in one bar.
        bars: runs.map((n) => n || null),
        bad: fails,
        dayValue: (i) => (runs[i] ? { value: pct((runs[i] - fails[i]) / runs[i]), note: fails[i] ? `${fails[i]} of ${runs[i]} failed` : plural(runs[i], "run") } : { value: "—", note: "no runs" }),
      },
      {
        label: "Tokens · 7 days",
        value: fmtTokens(weekTokens),
        sub: week.withUsage ? `${fmtTokens(Math.round(weekTokens / week.withUsage))} per run` : "No usage reported",
        bars: tokens.map((t) => t || null),
        dayValue: (i) => ({ value: tokens[i] ? fmtTokens(tokens[i]) : "—" }),
      },
      {
        label: "Median run · 7 days",
        value: med === null ? "—" : fmtDuration(med),
        sub: weekDurs.length ? `over ${plural(weekDurs.length, "timed run")}` : "No timed runs",
        bars: dayMed,
        dayValue: (i) => (dayMed[i] === null ? { value: "—" } : { value: fmtDuration(dayMed[i] as number), note: plural(durs[i].length, "run") }),
      },
    ],
  };
}
