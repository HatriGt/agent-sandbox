import * as React from "react";
import { cn } from "@/lib/utils";
import type { ChartSpec } from "@/lib/viz";
import { VizFrame, seriesColor } from "./VizFrame";

/**
 * ```chart fence → an inline SVG chart. Pure SVG on the app's tokens — no chart library, so it
 * costs nothing in the bundle and follows the theme live. Follows the dataviz method: thin marks,
 * rounded data-ends, 2px gaps between adjacent fills, one axis, fixed series colors (never cycled),
 * direct value labels on bars (the light palette's contrast relief), a legend for ≥2 series, and a
 * per-mark hover tooltip. Marks draw in once; `prefers-reduced-motion` renders them static.
 */
export function ChartBlock({ spec, source }: { spec: ChartSpec; source: string }) {
  return (
    <VizFrame title={spec.title ?? spec.type} source={source} rawLanguage="json">
      <div className="px-4 py-3">
        {spec.type === "donut" ? <Donut spec={spec} /> : spec.type === "sparkline" ? <Spark spec={spec} /> : spec.type === "bar" ? <Bars spec={spec} /> : <Lines spec={spec} area={spec.type === "area"} />}
        {spec.series.length >= 2 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {spec.series.map((s, i) => (
              <span key={s.name} className="text-muted-foreground inline-flex items-center gap-1.5 text-micro">
                <span aria-hidden className="size-2 rounded-full" style={{ background: seriesColor(i) }} />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </VizFrame>
  );
}

const fmt = (n: number, unit?: string) =>
  `${Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : Number.isInteger(n) ? n : n.toFixed(2)}${unit ?? ""}`;

function useReduced(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

/** Shared hover state + tooltip bubble. */
function Tip({ tip }: { tip: { x: number; y: number; text: string } | null }) {
  if (!tip) return null;
  return (
    <div
      className="bg-popover text-popover-foreground pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border px-2 py-1 text-micro whitespace-nowrap shadow-e2"
      style={{ left: tip.x, top: tip.y - 6 }}
      role="status"
    >
      {tip.text}
    </div>
  );
}

const W = 560;

function Bars({ spec }: { spec: ChartSpec }) {
  const reduced = useReduced();
  const [tip, setTip] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const nS = spec.series.length;
  const nL = spec.labels.length;
  const max = Math.max(...spec.series.flatMap((s) => s.data.map((d) => Math.abs(d))), 1);
  const plotH = 140;
  const labelH = 16;
  const H = plotH + labelH;
  const group = W / nL;
  const barW = Math.max(3, Math.min(28, (group - 8) / nS - 2));
  const showValues = nL * nS <= 16; // selective direct labels, never a number on every mark of a dense chart
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title ?? "bar chart"}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={plotH - f * (plotH - 18)} y2={plotH - f * (plotH - 18)} stroke="var(--viz-grid)" strokeWidth={1} />
        ))}
        <line x1={0} x2={W} y1={plotH} y2={plotH} stroke="var(--line-strong)" strokeWidth={1} />
        {spec.labels.map((label, li) => {
          const cx = li * group + group / 2;
          const total = nS * barW + (nS - 1) * 2;
          return (
            <g key={li}>
              {spec.series.map((s, si) => {
                const v = s.data[li];
                const h = (Math.abs(v) / max) * (plotH - 18);
                const x = cx - total / 2 + si * (barW + 2);
                const y = plotH - h;
                return (
                  <g key={si}>
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(h, 1)}
                      rx={Math.min(4, barW / 2)}
                      fill={seriesColor(si)}
                      className={cn(!reduced && "viz-grow")}
                      style={{ transformOrigin: `${x + barW / 2}px ${plotH}px`, animationDelay: `${(li * nS + si) * 25}ms` }}
                      onMouseEnter={(e) => {
                        const host = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                        const r = e.currentTarget.getBoundingClientRect();
                        setTip({ x: r.left - host.left + r.width / 2, y: r.top - host.top, text: `${label}${nS > 1 ? ` · ${s.name}` : ""}: ${fmt(v, spec.unit)}` });
                      }}
                      onMouseLeave={() => setTip(null)}
                    />
                    {showValues && (
                      <text x={x + barW / 2} y={y - 4} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
                        {fmt(v, spec.unit)}
                      </text>
                    )}
                  </g>
                );
              })}
              <text x={cx} y={H - 2} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
                {label.length > Math.max(4, group / 7) ? label.slice(0, Math.max(3, Math.floor(group / 7))) + "…" : label}
              </text>
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

function Lines({ spec, area }: { spec: ChartSpec; area: boolean }) {
  const reduced = useReduced();
  const [tip, setTip] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const H = 156;
  const plotH = 140;
  const nL = spec.labels.length;
  const all = spec.series.flatMap((s) => s.data);
  const max = Math.max(...all, 0);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  const px = (i: number) => (nL === 1 ? W / 2 : (i / (nL - 1)) * (W - 16) + 8);
  const py = (v: number) => plotH - ((v - min) / span) * (plotH - 16) - 4;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title ?? "line chart"}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={plotH * (1 - f)} y2={plotH * (1 - f)} stroke="var(--viz-grid)" strokeWidth={1} />
        ))}
        <line x1={0} x2={W} y1={py(Math.max(min, 0))} y2={py(Math.max(min, 0))} stroke="var(--line-strong)" strokeWidth={1} />
        {spec.series.map((s, si) => {
          const d = s.data.map((v, i) => `${i ? "L" : "M"}${px(i)},${py(v)}`).join(" ");
          return (
            <g key={si}>
              {area && (
                <path d={`${d} L${px(nL - 1)},${plotH} L${px(0)},${plotH} Z`} fill={seriesColor(si)} opacity={0.12} />
              )}
              <path d={d} fill="none" stroke={seriesColor(si)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn(!reduced && "viz-draw")} pathLength={1} />
              {s.data.map((v, i) => (
                <circle
                  key={i}
                  cx={px(i)}
                  cy={py(v)}
                  r={8}
                  fill="transparent"
                  onMouseEnter={(e) => {
                    const host = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                    const r = e.currentTarget.getBoundingClientRect();
                    setTip({ x: r.left - host.left + r.width / 2, y: r.top - host.top + 4, text: `${spec.labels[i]}${spec.series.length > 1 ? ` · ${s.name}` : ""}: ${fmt(v, spec.unit)}` });
                  }}
                  onMouseLeave={() => setTip(null)}
                />
              ))}
              {/* Direct end-label: name the line at its last point when few series (identity ≠ color alone). */}
              {spec.series.length <= 4 && spec.series.length >= 2 && (
                <text x={px(nL - 1) - 2} y={py(s.data[nL - 1]) - 6} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
                  {s.name}
                </text>
              )}
            </g>
          );
        })}
        {spec.labels.map((label, i) =>
          nL <= 12 || i % Math.ceil(nL / 12) === 0 ? (
            <text key={i} x={px(i)} y={H - 2} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
              {label.length > 8 ? label.slice(0, 7) + "…" : label}
            </text>
          ) : null
        )}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

function Donut({ spec }: { spec: ChartSpec }) {
  const [tip, setTip] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const data = spec.series[0].data;
  const total = data.reduce((a, b) => a + b, 0) || 1;
  const R = 56;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="relative flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="img" aria-label={spec.title ?? "donut chart"}>
        {data.map((v, i) => {
          const frac = v / total;
          const dash = Math.max(0, frac * C - 2); // 2px surface gap between segments
          const el = (
            <circle
              key={i}
              cx={70}
              cy={70}
              r={R}
              fill="none"
              stroke={seriesColor(i)}
              strokeWidth={16}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-acc * C + C / 4}
              onMouseEnter={(e) => {
                const host = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                setTip({ x: e.clientX - host.left, y: e.clientY - host.top, text: `${spec.labels[i]}: ${fmt(v, spec.unit)} (${Math.round(frac * 100)}%)` });
              }}
              onMouseLeave={() => setTip(null)}
            />
          );
          acc += frac;
          return el;
        })}
        <text x={70} y={75} textAnchor="middle" className="fill-foreground" fontSize={18} fontWeight={600}>
          {fmt(total, spec.unit)}
        </text>
      </svg>
      <div className="flex min-w-0 flex-col gap-1">
        {spec.labels.map((label, i) => (
          <span key={i} className="text-meta inline-flex items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: seriesColor(i) }} />
            <span className="text-foreground min-w-0 truncate">{label}</span>
            <span className="text-muted-foreground tabular-nums">
              {fmt(data[i], spec.unit)} · {Math.round((data[i] / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
      <Tip tip={tip} />
    </div>
  );
}

function Spark({ spec }: { spec: ChartSpec }) {
  const data = spec.series[0].data;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const w = 240;
  const h = 40;
  const d = data.map((v, i) => `${i ? "L" : "M"}${(i / (data.length - 1)) * (w - 4) + 2},${h - 4 - ((v - min) / span) * (h - 8)}`).join(" ");
  const last = data[data.length - 1];
  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-60" role="img" aria-label={spec.title ?? "sparkline"}>
        <path d={d} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={(w - 4) + 2 - 2} cy={h - 4 - ((last - min) / span) * (h - 8)} r={3} fill="var(--viz-1)" />
      </svg>
      <span className="text-foreground text-lead font-semibold tabular-nums">{fmt(last, spec.unit)}</span>
      <span className="text-muted-foreground text-micro">
        {spec.labels[0]} – {spec.labels[spec.labels.length - 1]}
      </span>
    </div>
  );
}
