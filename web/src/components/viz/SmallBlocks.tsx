import { cn } from "@/lib/utils";
import type { Badge, ProgressRow, Score, Swatch } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";

/** ```progress → labeled progress bars with the value on the right. */
export function ProgressBlock({ rows, source }: { rows: ProgressRow[]; source: string }) {
  return (
    <VizFrame source={source}>
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-foreground min-w-0 truncate text-meta">{r.label}</span>
              <span className="text-muted-foreground text-micro tabular-nums">{r.text}</span>
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full" role="progressbar" aria-label={r.label} aria-valuenow={Math.round(r.frac * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={cn("h-full rounded-full transition-[width] duration-300", r.frac >= 1 ? "bg-ok" : "bg-live")}
                style={{ width: `${r.frac * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

/** ```score → dot scale (max ≤ 10) or a filled bar, value in text beside it. */
export function ScoreBlock({ scores, source }: { scores: Score[]; source: string }) {
  return (
    <VizFrame source={source}>
      <div className="flex flex-col gap-2 px-4 py-3">
        {scores.map((s) => {
          const frac = s.value / s.max;
          const tone = frac >= 0.8 ? "var(--ok)" : frac >= 0.5 ? "var(--viz-1)" : "var(--destructive)";
          return (
            <div key={s.label} className="flex items-center gap-3">
              <span className="text-foreground w-40 min-w-0 shrink-0 truncate text-meta">{s.label}</span>
              {s.max <= 10 ? (
                <span className="flex items-center gap-1" aria-label={`${s.value} of ${s.max}`}>
                  {Array.from({ length: s.max }, (_, i) => (
                    <span
                      key={i}
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: i < Math.round(s.value) ? tone : "var(--muted)" }}
                    />
                  ))}
                </span>
              ) : (
                <span className="bg-muted h-1.5 w-32 overflow-hidden rounded-full" aria-label={`${s.value} of ${s.max}`}>
                  <span className="block h-full rounded-full" style={{ width: `${frac * 100}%`, background: tone }} />
                </span>
              )}
              <span className="text-muted-foreground text-micro tabular-nums">
                {s.value}/{s.max}
              </span>
              {s.note && <span className="text-faint min-w-0 truncate text-micro">{s.note}</span>}
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}

/** ```badges → status chip row; tone from the state word, always with the word (never hue alone). */
export function BadgesBlock({ badges, source }: { badges: Badge[]; source: string }) {
  return (
    <VizFrame source={source}>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {badges.map((b) => (
          <span key={b.label} className="inline-flex items-stretch overflow-hidden rounded-md border text-micro font-medium">
            <span className="bg-muted/60 text-muted-foreground px-2 py-0.5">{b.label}</span>
            <span
              className={cn(
                "px-2 py-0.5",
                b.tone === "ok" && "text-ok bg-ok/10",
                b.tone === "warn" && "text-attention-text bg-attention/15",
                b.tone === "fail" && "text-destructive bg-destructive/10",
                b.tone === "live" && "text-live bg-live/10",
                b.tone === "neutral" && "text-foreground bg-card"
              )}
            >
              {b.value}
            </span>
          </span>
        ))}
      </div>
    </VizFrame>
  );
}

/** ```palette → swatch cards with hex; label under each. Text never sits on the swatch. */
export function PaletteBlock({ swatches, source }: { swatches: Swatch[]; source: string }) {
  return (
    <VizFrame source={source}>
      <div className="flex flex-wrap gap-3 px-4 py-3">
        {swatches.map((s, i) => (
          <div key={i} className="w-20">
            <div className="border-border/60 h-12 w-full rounded-lg border" style={{ background: s.hex }} aria-label={s.hex} />
            <div className="text-foreground mt-1 truncate font-mono text-micro">{s.hex}</div>
            {s.label && <div className="text-faint truncate text-micro">{s.label}</div>}
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

/** ```keys → keyboard shortcuts, each key in a real <kbd> cap. */
export function KeysBlock({ rows, source }: { rows: { keys: string[]; action: string }[]; source: string }) {
  return (
    <VizFrame source={source}>
      <div className="flex flex-col px-4 py-2">
        {rows.map((r, i) => (
          <div key={i} className="border-border/50 flex items-center justify-between gap-4 border-b py-1.5 last:border-0">
            <span className="text-foreground min-w-0 truncate text-meta">{r.action}</span>
            <span className="flex shrink-0 items-center gap-1">
              {r.keys.map((k, j) => (
                <kbd
                  key={j}
                  className="bg-muted text-foreground border-border rounded-md border px-1.5 py-0.5 font-mono text-micro shadow-[inset_0_-1px_0_var(--border)]"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

/** ```kv → a quiet two-column definition panel (config dumps, environment summaries). */
export function KvBlock({ rows, source }: { rows: { key: string; value: string }[]; source: string }) {
  return (
    <VizFrame source={source}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 px-4 py-3">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-muted-foreground text-meta">{r.key}</dt>
            <dd className="text-foreground m-0 min-w-0 font-mono text-meta break-all">{r.value}</dd>
          </div>
        ))}
      </dl>
    </VizFrame>
  );
}
