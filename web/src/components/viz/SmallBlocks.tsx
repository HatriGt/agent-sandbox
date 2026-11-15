import { cn } from "@/lib/utils";
import type { Badge, ProgressRow, Score, Swatch } from "@/lib/viz-extra";
import { count, VizFrame } from "./VizFrame";
import { RollNumber, useRowEntrance } from "./motion";

/** ```progress → labeled progress bars with the value on the right; a fill grows from 0 once, on first paint. */
export function ProgressBlock({ rows, source }: { rows: ProgressRow[]; source: string }) {
  const entrance = useRowEntrance(rows.map((r) => r.label));
  const complete = rows.filter((r) => r.frac >= 1).length;
  return (
    <VizFrame title={`${complete} of ${rows.length} complete`} source={source}>
      <div className="flex flex-col gap-3 px-4 py-3">
        {rows.map((r) => {
          const e = entrance(r.label);
          return (
            <div key={r.label} className={e.className} style={e.style}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-foreground min-w-0 truncate text-meta">{r.label}</span>
                <RollNumber text={r.text} className="text-muted-foreground text-micro tabular-nums" />
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full" role="progressbar" aria-label={r.label} aria-valuenow={Math.round(r.frac * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className={cn("viz-tween-w h-full origin-left rounded-full", r.frac >= 1 ? "bg-ok" : "bg-live", e.first && "viz-grow-x")}
                  style={{ width: `${r.frac * 100}%`, ...e.style }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}

/** ```score → dot scale (max ≤ 10) or a filled bar, value in text beside it. */
export function ScoreBlock({ scores, source }: { scores: Score[]; source: string }) {
  const entrance = useRowEntrance(scores.map((s) => s.label));
  return (
    <VizFrame title={count(scores.length, "score")} source={source}>
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {scores.map((s) => {
          const frac = s.value / s.max;
          const tone = frac >= 0.8 ? "var(--ok)" : frac >= 0.5 ? "var(--viz-1)" : "var(--destructive)";
          const e = entrance(s.label);
          return (
            <div key={s.label} className={cn("flex items-center gap-3", e.className)} style={e.style}>
              <span className="text-foreground w-40 min-w-0 shrink-0 truncate text-meta">{s.label}</span>
              {s.max <= 10 ? (
                <span className="flex items-center gap-1" aria-label={`${s.value} of ${s.max}`} role="img">
                  {Array.from({ length: s.max }, (_, i) => (
                    <span
                      key={i}
                      aria-hidden
                      className="size-2 rounded-full transition-[background-color] duration-150 ease-(--viz-ease)"
                      style={{ background: i < Math.round(s.value) ? tone : "var(--muted)" }}
                    />
                  ))}
                </span>
              ) : (
                <span className="bg-muted h-1.5 w-32 overflow-hidden rounded-full" aria-label={`${s.value} of ${s.max}`} role="img">
                  <span className={cn("viz-tween-w block h-full origin-left rounded-full", e.first && "viz-grow-x")} style={{ width: `${frac * 100}%`, background: tone, ...e.style }} />
                </span>
              )}
              <span className="text-muted-foreground w-12 shrink-0 text-micro tabular-nums">
                <RollNumber text={String(s.value)} />/{s.max}
              </span>
              {s.note && <span className="text-faint min-w-0 truncate text-micro">{s.note}</span>}
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}

const BADGE_HUE: Record<Badge["tone"], string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  fail: "var(--destructive)",
  live: "var(--live)",
  neutral: "var(--faint)",
};
const BADGE_INK: Record<Badge["tone"], string> = {
  ok: "text-ok",
  warn: "text-warn-text",
  fail: "text-destructive",
  live: "text-live",
  neutral: "text-foreground",
};

/** ```badges → status chips: a dot in the state's hue, the label, the state word in its ink (never hue alone). */
export function BadgesBlock({ badges, source }: { badges: Badge[]; source: string }) {
  const entrance = useRowEntrance(badges.map((b) => b.label));
  const down = badges.filter((b) => b.tone === "fail").length;
  return (
    <VizFrame title={`${count(badges.length, "status", "statuses")}${down ? ` · ${down} failing` : ""}`} source={source}>
      <div className="flex flex-wrap gap-1.5 px-4 py-3">
        {badges.map((b) => {
          const e = entrance(b.label);
          return (
            <span key={b.label} style={e.style} className={cn(e.className, "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-micro")}>
              <span aria-hidden className={cn("size-1.5 rounded-full", b.tone === "live" && "viz-pulse")} style={{ background: BADGE_HUE[b.tone] }} />
              <span className="text-muted-foreground">{b.label}</span>
              {/* Keyed by value: a changed state word fades in instead of snapping. */}
              <span key={b.value} className={cn("viz-fade font-medium", BADGE_INK[b.tone])}>
                {b.value}
              </span>
            </span>
          );
        })}
      </div>
    </VizFrame>
  );
}

/** ```palette → swatch cards with hex; label under each. Text never sits on the swatch. */
export function PaletteBlock({ swatches, source }: { swatches: Swatch[]; source: string }) {
  const entrance = useRowEntrance(swatches.map((s, i) => `${i}|${s.hex}`));
  return (
    <VizFrame title={count(swatches.length, "colour")} source={source}>
      <div className="flex flex-wrap gap-3 px-4 py-3">
        {swatches.map((s, i) => {
          const e = entrance(`${i}|${s.hex}`);
          return (
            <div key={i} className={cn("w-20", e.className)} style={e.style}>
              {/* 1px inner outline at 10% ink: a swatch close to the card colour keeps its edge. */}
              <div className="h-12 w-full rounded-md outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" style={{ background: s.hex }} aria-label={s.hex} role="img" />
              <div className="text-foreground mt-1.5 truncate font-mono text-micro">{s.hex}</div>
              {s.label && <div className="text-faint truncate text-micro">{s.label}</div>}
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}

/** ```keys → keyboard shortcuts, each key in a real <kbd> cap. */
export function KeysBlock({ rows, source }: { rows: { keys: string[]; action: string }[]; source: string }) {
  const entrance = useRowEntrance(rows.map((r, i) => `${i}|${r.action}`));
  return (
    <VizFrame title={count(rows.length, "shortcut")} source={source}>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r, i) => {
          const e = entrance(`${i}|${r.action}`);
          return (
            <li key={i} className={cn("flex items-center justify-between gap-4 px-4 py-2", i > 0 && "border-border/60 border-t", e.className)} style={e.style}>
              <span className="text-foreground min-w-0 truncate text-meta">{r.action}</span>
              <span className="flex shrink-0 items-center gap-1">
                {r.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="bg-card text-foreground border-line-strong min-w-6 rounded-md border px-1.5 py-0.5 text-center font-mono text-micro shadow-[inset_0_-1px_0_var(--border)]"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </VizFrame>
  );
}

/** ```kv → a quiet two-column definition panel (config dumps, environment summaries). */
export function KvBlock({ rows, source }: { rows: { key: string; value: string }[]; source: string }) {
  const entrance = useRowEntrance(rows.map((r) => r.key));
  return (
    <VizFrame title={count(rows.length, "field")} source={source}>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 px-4 py-3">
        {rows.map((r) => {
          const e = entrance(r.key);
          return (
            <div key={r.key} className="contents">
              <dt className={cn("text-muted-foreground text-meta", e.className)} style={e.style}>
                {r.key}
              </dt>
              <dd className={cn("text-foreground m-0 min-w-0 font-mono text-meta tabular-nums break-all", e.className)} style={e.style}>
                <RollNumber text={r.value} />
              </dd>
            </div>
          );
        })}
      </dl>
    </VizFrame>
  );
}
