import * as React from "react";
import type { MemoryNote } from "@/lib/api";
import { isOperatorKind, KIND_LABEL, KINDS, plural } from "./kinds";
import { KindMark, MemoryMap } from "./MemoryMap";

const DAY = 86_400_000;
const DAYS = 30;

/**
 * The page's one glance: the memory map (who the notes are about, how fresh, what replaced what),
 * a stat line, and a sparkline of how many notes the agent has known over the last 30 days. Every
 * mark is a stored note; with nothing stored the map stays an empty sky and says so.
 */
export function MemoryOverview({
  notes,
  pending,
  onReview,
  onSelect,
  onSection,
}: {
  notes: MemoryNote[];
  pending: number;
  onReview: () => void;
  onSelect: (id: string) => void;
  onSection: (id: string) => void;
}) {
  const live = React.useMemo(() => notes.filter((n) => n.until == null), [notes]);
  const present = new Set(live.map((n) => n.kind));
  const repos = new Set(live.filter((n) => n.repo && !isOperatorKind(n.kind)).map((n) => n.repo)).size;
  const you = live.filter((n) => isOperatorKind(n.kind)).length;
  const replaced = notes.length - live.length;

  return (
    <section aria-label="Memory overview" className="bg-card overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3.5">
        <p className="text-foreground text-body font-medium tabular-nums">
          {live.length ? plural(live.length, "note") : "Nothing remembered yet"}
          {live.length > 0 && (
            <span className="text-muted-foreground font-normal">
              {" "}
              · {you} about you · {plural(repos, "repo")}
              {replaced > 0 && ` · ${replaced} replaced`}
            </span>
          )}
        </p>
        {pending > 0 && (
          <button
            type="button"
            onClick={onReview}
            className="bg-attention/20 text-attention-text focus-visible:ring-ring ml-auto rounded-full px-2.5 py-0.5 text-meta font-medium tabular-nums focus-visible:ring-2 focus-visible:outline-none"
          >
            {pending} waiting for you
          </button>
        )}
      </div>

      <div className="px-2 pt-1">
        <MemoryMap notes={notes} onSelect={onSelect} onSection={onSection} />
      </div>

      {live.length === 0 ? (
        <p className="text-muted-foreground mx-auto max-w-prose px-4 pb-4 text-center text-meta">
          Runs add notes as they go — a correction becomes a lesson, a recurring task a playbook, a stated preference follows you everywhere. Or add a preference above.
        </p>
      ) : (
        <div className="grid items-end gap-x-8 gap-y-3 border-t px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1.5" aria-label="Legend">
            {KINDS.filter((k) => present.has(k)).map((k) => (
              <li key={k} className="text-muted-foreground flex items-center gap-1.5 text-micro">
                <KindMark kind={k} />
                {KIND_LABEL[k]}
              </li>
            ))}
            <li className="text-faint flex items-center gap-1.5 text-micro">
              <svg viewBox="0 0 20 10" width={20} height={10} aria-hidden className="text-foreground">
                <circle cx={4} cy={5} r={3} fill="currentColor" />
                <circle cx={15} cy={5} r={3} fill="currentColor" fillOpacity={0.3} />
              </svg>
              fresh → old
            </li>
            {pending > 0 && (
              <li className="text-faint flex items-center gap-1.5 text-micro">
                <svg viewBox="0 0 12 12" width={11} height={11} aria-hidden>
                  <circle cx={6} cy={6} r={4.5} fill="none" className="stroke-attention" strokeWidth={1.6} strokeDasharray="2.5 1.5" />
                </svg>
                needs you
              </li>
            )}
          </ul>
          <Growth live={live} />
        </div>
      )}
    </section>
  );
}

/** Notes known over time: live notes created on or before each day, last 30 days. */
function Growth({ live }: { live: MemoryNote[] }) {
  const g = React.useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const t0 = start.getTime() - (DAYS - 1) * DAY;
    const ats = live.map((n) => n.at).sort((a, b) => a - b);
    const series = Array.from({ length: DAYS }, (_, i) => {
      const end = t0 + (i + 1) * DAY;
      let c = 0;
      while (c < ats.length && ats[c] < end) c++;
      return c;
    });
    const before = ats.filter((a) => a < t0).length;
    return { t0, series, before, added: series[DAYS - 1] - before, max: Math.max(1, series[DAYS - 1]) };
  }, [live]);
  const w = 300, h = 44;
  const pts = g.series.map((c, i) => [(i / (DAYS - 1)) * w, h - 2 - (c / g.max) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const id = React.useId().replace(/:/g, "");
  return (
    <figure className="min-w-0">
      <figcaption className="text-faint mb-1 flex items-baseline text-micro font-medium tracking-wide uppercase">
        Known, last 30 days
        <span className="text-muted-foreground ml-auto font-normal tracking-normal normal-case tabular-nums">
          {g.added > 0 ? `+${g.added} → ${g.series[DAYS - 1]}` : `${g.series[DAYS - 1]} · nothing new`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${g.before} notes known 30 days ago, ${g.series[DAYS - 1]} today${g.added ? `, ${g.added} added` : ""}`}
        className="text-foreground block h-11 w-full overflow-visible"
      >
        <defs>
          <linearGradient id={`mg-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={`${line}L${w} ${h}L0 ${h}Z`} fill={`url(#mg-${id})`} />
        <path d={line} fill="none" stroke="currentColor" strokeOpacity={0.75} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} className="stroke-border" vectorEffect="non-scaling-stroke" />
        {g.series.map((c, i) => (
          <rect key={i} x={(i / DAYS) * w} y={0} width={w / DAYS} height={h} fill="transparent">
            <title>{`${new Date(g.t0 + i * DAY).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${plural(c, "note")} known`}</title>
          </rect>
        ))}
      </svg>
      <div className="text-faint mt-0.5 flex justify-between text-micro">
        <span>30d ago</span>
        <span>today</span>
      </div>
    </figure>
  );
}
