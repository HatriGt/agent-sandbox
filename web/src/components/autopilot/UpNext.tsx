import type { LucideIcon } from "lucide-react";
import type { Automation, AutomationKind } from "@/lib/api";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/utils";

const WEEK = 7 * 86_400_000;
const LANES = 3;

/** "in 2h 14m" / "in 3d 4h" / "in 12 min" — a future epoch ms, to the minute. */
export function fmtCountdown(at: number, now: number): string {
  const m = Math.max(0, Math.round((at - now) / 60_000));
  if (m < 1) return "in under a minute";
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  const d = Math.floor(h / 24);
  return `in ${d}d${h % 24 ? ` ${h % 24}h` : ""}`;
}

/** Enabled automations with a next fire inside the coming week, soonest first. */
export function upcoming(rows: readonly Automation[], now: number): Automation[] {
  return rows.filter((a) => a.enabled && a.nextFire != null && a.nextFire >= now - 60_000 && a.nextFire < now + WEEK).sort((a, b) => a.nextFire! - b.nextFire!);
}

/** Local midnights strictly inside (now, now + 7d] — the day ticks on the rail. */
function midnights(now: number): number[] {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  const out: number[] = [];
  while (d.getTime() < now + WEEK) {
    out.push(d.getTime());
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const whenFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function whenLabel(at: number, now: number): string {
  const a = new Date(at);
  const n = new Date(now);
  if (a.toDateString() === n.toDateString()) return `Today ${timeFmt.format(a)}`;
  n.setDate(n.getDate() + 1);
  if (a.toDateString() === n.toDateString()) return `Tomorrow ${timeFmt.format(a)}`;
  return whenFmt.format(a);
}

/**
 * Up next: the coming week as one rail, each enabled automation placed at its NEXT fire (from the
 * server's own nextFire — nothing is projected or repeated), with the soonest few listed underneath.
 * Present tense only: it is the shape of what is about to happen, like the capacity strip, not a
 * chart over the past. Renders nothing when no automation has a fire this week.
 */
export function UpNext({ rows, glyph, label, onOpen }: { rows: readonly Automation[]; glyph: Record<AutomationKind, LucideIcon>; label: (name: string) => string; onOpen: (a: Automation) => void }) {
  const now = useNow(true, 30_000);
  const items = upcoming(rows, now);
  if (!items.length) return null;
  const ticks = midnights(now);
  const pos = (at: number) => Math.min(100, Math.max(0, ((at - now) / WEEK) * 100));
  // Greedy lanes so markers a few hours apart do not sit on top of each other.
  const lastInLane: number[] = [];
  const placed = items.map((a) => {
    const x = pos(a.nextFire!);
    let lane = lastInLane.findIndex((l) => x - l > 3.2);
    if (lane < 0) lane = lastInLane.length < LANES ? lastInLane.length : LANES - 1;
    lastInLane[lane] = x;
    return { a, x, lane };
  });
  const first = items[0];
  // Tall enough for the lanes in use: markers stack 1.25rem apart above the day labels.
  const lanes = Math.max(...placed.map((p) => p.lane)) + 1;
  const railRem = (lanes - 1) * 1.25 + 1.5 + 0.75 + 1.25;
  return (
    <section aria-labelledby="upnext-title" className="bg-card enter mb-5 overflow-hidden rounded-xl border">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3.5">
        <h2 id="upnext-title" className="text-foreground text-meta font-medium">
          Up next
        </h2>
        <p className="text-muted-foreground hidden min-w-0 flex-1 text-micro @xl:block">The next run of each automation, this week</p>
        <span className="flex-1 @xl:hidden" aria-hidden />
        <p className="text-micro text-muted-foreground" aria-live="polite">
          <span className="text-foreground font-medium">{label(first.name)}</span> <span className="tabular font-mono">{fmtCountdown(first.nextFire!, now)}</span>
        </p>
      </header>

      {/* The rail: now at the left edge, a week to the right, a hairline at each local midnight. */}
      <div className="relative mx-4 mt-3 mb-1" style={{ height: `${railRem}rem` }} aria-hidden>
        <div className="bg-border absolute inset-x-0 bottom-5 h-px" />
        {ticks.map((t) => (
          <div key={t} className="absolute top-0 bottom-0" style={{ left: `${pos(t)}%` }}>
            <div className="bg-border/70 absolute top-0 bottom-5 w-px" />
            {pos(t) > 4 && (
              <span className={cn("text-faint absolute bottom-0 -translate-x-1/2 text-micro whitespace-nowrap", pos(t) < 14 && "hidden @2xl:inline")}>{dayFmt.format(new Date(t))}</span>
            )}
          </div>
        ))}
        <div className="absolute top-0 bottom-0 left-0">
          <div className="bg-live absolute top-0 bottom-5 w-0.5 rounded-full" />
          <span className="bg-live absolute bottom-[1.0625rem] -left-[3px] size-2 rounded-full" />
          <span className="text-live absolute bottom-0 left-0 text-micro font-medium">Now</span>
        </div>
        {placed.map(({ a, x, lane }) => {
          const G = glyph[a.kind];
          return (
            <span
              key={a.id}
              className="pop-in bg-background text-live absolute grid size-6 -translate-x-1/2 place-items-center rounded-md border shadow-xs"
              style={{ left: `max(0.75rem, min(calc(100% - 0.75rem), ${x}%))`, top: `${lane * 1.25}rem` }}
              title={`${label(a.name)} — ${whenLabel(a.nextFire!, now)}`}
            >
              <G className="size-3.5" strokeWidth={1.75} />
            </span>
          );
        })}
      </div>

      <ol className="divide-y border-t">
        {items.slice(0, 4).map((a, i) => {
          const G = glyph[a.kind];
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onOpen(a)}
                className="hover:bg-muted/50 focus-visible:bg-muted/50 grid w-full cursor-pointer grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left outline-none transition-colors"
              >
                <span className={cn("tabular font-mono text-micro", i === 0 ? "text-foreground" : "text-muted-foreground")}>{whenLabel(a.nextFire!, now)}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <G className="text-muted-foreground size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="text-foreground truncate text-meta">{label(a.name)}</span>
                </span>
                <span className="text-faint tabular font-mono text-micro">{fmtCountdown(a.nextFire!, now)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {items.length > 4 && <p className="text-faint border-t px-4 py-1.5 text-micro">and {items.length - 4} more this week</p>}
    </section>
  );
}
