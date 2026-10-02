import * as React from "react";
import type { MemoryNote } from "@/lib/api";
import { cn } from "@/lib/utils";
import { isOperatorKind, KIND_INK, KIND_LABEL, KINDS, plural } from "./kinds";

const DAY = 86_400_000;
const DAYS = 30;
const YOU = "you";
const ANY = "any";

/**
 * The page's one glance: who the notes are about (You vs each repo, split by kind) and how memory
 * is growing (notes written per day, last 30 days). Every mark is a count of live notes from the
 * store — nothing estimated; an empty strip says so instead of drawing a flat line.
 */
export function MemoryOverview({ live, pending, onReview }: { live: MemoryNote[]; pending: number; onReview: () => void }) {
  const rows = React.useMemo(() => {
    const groups = new Map<string, MemoryNote[]>();
    for (const n of live) {
      const k = isOperatorKind(n.kind) ? YOU : n.repo ? `r:${n.repo}` : ANY;
      groups.set(k, [...(groups.get(k) ?? []), n]);
    }
    const all = [...groups.entries()].map(([key, list]) => ({
      key,
      label: key === YOU ? "You" : key === ANY ? "Any repo" : key.slice(2),
      total: list.length,
      byKind: KINDS.map((k) => [k, list.filter((n) => n.kind === k).length] as const).filter(([, c]) => c > 0),
    }));
    all.sort((a, b) => (a.key === YOU ? -1 : b.key === YOU ? 1 : b.total - a.total));
    const rest = all.slice(6);
    return {
      shown: all.slice(0, 6),
      restCount: rest.length,
      restTotal: rest.reduce((s, r) => s + r.total, 0),
    };
  }, [live]);
  const max = Math.max(1, ...rows.shown.map((r) => r.total));

  const days = React.useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const t0 = start.getTime() - (DAYS - 1) * DAY;
    const counts = new Array<number>(DAYS).fill(0);
    for (const n of live) {
      const i = Math.floor((n.at - t0) / DAY);
      if (i >= 0 && i < DAYS) counts[i]++;
    }
    return {
      t0,
      counts,
      sum: counts.reduce((a, b) => a + b, 0),
      peak: Math.max(0, ...counts),
    };
  }, [live]);

  const present = new Set(live.map((n) => n.kind));
  const repos = new Set(live.filter((n) => n.repo).map((n) => n.repo)).size;
  const you = live.filter((n) => isOperatorKind(n.kind)).length;

  return (
    <section aria-label="Memory overview" className="bg-card rounded-xl border px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-foreground text-body font-medium tabular-nums">
          {plural(live.length, "note")}{" "}
          <span className="text-muted-foreground font-normal">
            · {you} about you · {plural(repos, "repo")}
          </span>
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

      <div className="mt-3 grid gap-x-8 gap-y-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <h3 className="text-faint mb-1.5 text-micro font-medium tracking-wide uppercase">What it knows</h3>
          {rows.shown.length === 0 ? (
            <p className="text-muted-foreground text-meta">No live notes — everything here was replaced.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {rows.shown.map((r) => {
                const w = (r.total / max) * 100;
                let x = 0;
                return (
                  <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2rem] items-center gap-2">
                    <span className={cn("truncate text-meta", r.key === YOU ? "text-foreground" : "text-muted-foreground")} title={r.label}>
                      {r.label}
                    </span>
                    <svg role="img" aria-label={`${r.label}: ${r.byKind.map(([k, c]) => `${c} ${KIND_LABEL[k].toLowerCase()}`).join(", ")}`} viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full">
                      {r.byKind.map(([k, c]) => {
                        const seg = (c / r.total) * w;
                        const el = (
                          <rect key={k} x={x} y={0} width={Math.max(0.3, seg - 0.4)} height={8} className="fill-foreground" fillOpacity={KIND_INK[k]}>
                            <title>{`${c} ${KIND_LABEL[k].toLowerCase()}`}</title>
                          </rect>
                        );
                        x += seg;
                        return el;
                      })}
                    </svg>
                    <span className="text-muted-foreground text-right text-micro tabular-nums">{r.total}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {rows.restCount > 0 && (
            <p className="text-faint mt-1 text-micro">
              + {plural(rows.restCount, "more repo")} · {plural(rows.restTotal, "note")}
            </p>
          )}
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Kinds">
            {KINDS.filter((k) => present.has(k)).map((k) => (
              <li key={k} className="text-muted-foreground flex items-center gap-1 text-micro">
                <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
                  <rect width={8} height={8} rx={1.5} className="fill-foreground" fillOpacity={KIND_INK[k]} />
                </svg>
                {KIND_LABEL[k]}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-faint mb-1.5 flex items-baseline text-micro font-medium tracking-wide uppercase">
            Added, last 30 days
            <span className="text-muted-foreground ml-auto font-normal tracking-normal normal-case tabular-nums">{days.sum ? plural(days.sum, "note") : "none"}</span>
          </h3>
          {days.sum === 0 ? (
            <p className="text-muted-foreground text-meta">Nothing new in the last 30 days.</p>
          ) : (
            <>
              <svg role="img" aria-label={`${plural(days.sum, "note")} added in the last 30 days, at most ${days.peak} on one day`} viewBox={`0 0 ${DAYS * 4} 32`} preserveAspectRatio="none" className="h-10 w-full">
                <line x1={0} x2={DAYS * 4} y1={31.5} y2={31.5} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {days.counts.map((c, i) => {
                  const h = c ? Math.max(3, (c / days.peak) * 30) : 0;
                  const d = new Date(days.t0 + i * DAY);
                  return (
                    <rect key={i} x={i * 4 + 0.5} y={31 - h} width={3} height={h} className="fill-foreground" fillOpacity={i === DAYS - 1 ? 0.8 : 0.5}>
                      <title>{`${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${plural(c, "note")}`}</title>
                    </rect>
                  );
                })}
              </svg>
              <div className="text-faint mt-0.5 flex justify-between text-micro">
                <span>30d ago</span>
                <span>today</span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
