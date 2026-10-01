import * as React from "react";
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartSpec } from "@/lib/viz";
import { VizFrame, seriesColor } from "./VizFrame";
import { DataTable } from "./DataTable";

/**
 * ```chart fence → an inline SVG chart. Pure SVG on the app's tokens — no chart library, so it
 * costs nothing in the bundle and follows the theme live. Follows the dataviz method: thin marks,
 * rounded data-ends, 2px gaps between adjacent fills, one axis, fixed series colors (never cycled),
 * direct value labels on bars (the light palette's contrast relief), a legend for ≥2 series, and a
 * per-mark hover tooltip. Marks draw in once; `prefers-reduced-motion` renders them static.
 *
 * Interaction: legend entries toggle their series (by name, so the choice survives streaming
 * growth; at least one stays visible); bar/line/area charts take a category-wide hover band and a
 * keyboard scrub (←/→, Home/End, Enter pins, Esc clears); a header switch shows the same data as a
 * table. Series keep their slot color when others hide — color is identity, never re-assigned.
 */
export function ChartBlock({
  spec,
  source,
  actions,
  noTable,
}: {
  spec: ChartSpec;
  source: string;
  /** Extra header controls (DataTable passes its own Table/Chart switch here). */
  actions?: React.ReactNode;
  /** Suppress the built-in table view (when the host already is a table). */
  noTable?: boolean;
}) {
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const multi = spec.series.length >= 2 && spec.type !== "donut" && spec.type !== "sparkline";
  const slots = spec.series.map((_, i) => i).filter((i) => !multi || !hidden.has(spec.series[i].name));
  const vis: ChartSpec = { ...spec, series: slots.map((i) => spec.series[i]) };
  const toggle = (name: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(name)) next.delete(name);
      else if (spec.series.filter((s) => !next.has(s.name)).length > 1) next.add(name);
      return next;
    });
  const tableable = !noTable && spec.type !== "sparkline" && spec.labels.length > 0;
  const switcher = tableable && (
    <button
      type="button"
      onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
      aria-label={view === "chart" ? "Show as table" : "Show as chart"}
      aria-pressed={view === "table"}
      className="text-muted-foreground hover:text-foreground grid size-6 cursor-pointer place-items-center rounded-md opacity-60 group-hover/viz:opacity-100 focus-visible:opacity-100"
    >
      {view === "chart" ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
    </button>
  );
  const headerActions =
    actions || switcher ? (
      <>
        {actions}
        {switcher}
      </>
    ) : undefined;

  if (tableable && view === "table") {
    const head = [spec.type === "donut" ? "label" : "", ...spec.series.map((s) => s.name)];
    const texts = spec.labels.map((l, li) => [l, ...spec.series.map((s) => (s.data[li] === undefined ? "" : `${s.data[li]}${spec.unit ?? ""}`))]);
    return <DataTable head={head} rows={texts} texts={texts} title={spec.title ?? spec.type} actions={headerActions} noChart />;
  }

  return (
    <VizFrame title={spec.title ?? spec.type} source={source} rawLanguage="json" actions={headerActions}>
      <div className="px-4 py-3">
        {spec.type === "donut" ? (
          <Donut spec={spec} />
        ) : spec.type === "sparkline" ? (
          <Spark spec={spec} />
        ) : spec.type === "scatter" ? (
          <Scatter spec={vis} slots={slots} />
        ) : spec.type === "bar" ? (
          spec.stacked ? <StackedBars spec={vis} slots={slots} /> : <Bars spec={vis} slots={slots} />
        ) : (
          <Lines spec={vis} slots={slots} area={spec.type === "area"} />
        )}
        {multi && (
          <div className="mt-2 flex flex-wrap gap-x-1 gap-y-0.5" role="group" aria-label="Series">
            {spec.series.map((s, i) => {
              const off = hidden.has(s.name);
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => toggle(s.name)}
                  aria-pressed={!off}
                  aria-label={`${off ? "Show" : "Hide"} series ${s.name}`}
                  data-series={s.name}
                  className={cn(
                    "hover:bg-muted/60 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-micro transition-opacity duration-150",
                    off ? "text-faint line-through opacity-60" : "text-muted-foreground"
                  )}
                >
                  {/* Hidden = hollow ring + strikethrough: state is never carried by color alone. */}
                  <span aria-hidden className="size-2 rounded-full border-2" style={{ borderColor: seriesColor(i), background: off ? "transparent" : seriesColor(i) }} />
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </VizFrame>
  );
}

const fmt = (n: number | undefined, unit?: string) =>
  n === undefined || Number.isNaN(n)
    ? "–"
    : `${Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : Number.isInteger(n) ? n : n.toFixed(2)}${unit ?? ""}`;

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

type TipState = { x: number | string; y: number | string; text: string; lines?: { color: string; text: string }[] };

/** Shared tooltip bubble: one line, or a header plus a swatch row per series (crosshair read-out). */
function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div
      className="bg-popover text-popover-foreground pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border px-2 py-1 text-micro whitespace-nowrap shadow-e2"
      style={{ left: tip.x, top: typeof tip.y === "number" ? tip.y - 6 : `calc(${tip.y} - 6px)` }}
      role="status"
      data-viz-tip
    >
      <div className={cn(tip.lines && "text-muted-foreground")}>{tip.text}</div>
      {tip.lines?.map((l, i) => (
        <div key={i} className="flex items-center gap-1.5 tabular-nums">
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: l.color }} />
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** Geometry follows streaming growth smoothly — position and size ease instead of jumping. */
const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const geo = (reduced: boolean, props: string): React.CSSProperties =>
  reduced ? {} : { transition: props.split(",").map((p) => `${p.trim()} 250ms ${EASE}`).join(", ") };

/**
 * Category scrub shared by bars and lines: hover band or ←/→ picks a category; Enter/click pins it
 * (by label, so a pin survives labels growing while the block streams); Esc clears.
 */
function useScrub(labels: string[]) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [pin, setPin] = React.useState<string | null>(null);
  const nL = labels.length;
  const pinIdx = pin !== null ? labels.indexOf(pin) : -1;
  const active = hover !== null && hover < nL ? hover : pinIdx >= 0 ? pinIdx : null;
  const togglePin = (i: number | null) => {
    if (i !== null) setPin((p) => (p === labels[i] ? null : labels[i]));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = active === null ? 0 : Math.min(nL - 1, active + 1);
    else if (e.key === "ArrowLeft") next = active === null ? nL - 1 : Math.max(0, active - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = nL - 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      togglePin(active);
      return;
    } else if (e.key === "Escape") {
      setHover(null);
      setPin(null);
      return;
    } else return;
    e.preventDefault();
    setHover(next);
  };
  return {
    active,
    pinned: pinIdx,
    focusProps: { tabIndex: 0, onKeyDown, onBlur: () => setHover(null), onMouseLeave: () => setHover(null) },
    setHover,
    togglePin,
  };
}

/** Pointer x in viewBox units. */
const vbX = (e: React.MouseEvent<SVGSVGElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  return ((e.clientX - r.left) / (r.width || 1)) * W;
};

const FOCUS = "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

const W = 560;

function Bars({ spec, slots }: { spec: ChartSpec; slots: number[] }) {
  const reduced = useReduced();
  const nS = spec.series.length;
  const nL = spec.labels.length;
  const scrub = useScrub(spec.labels);
  const max = Math.max(...spec.series.flatMap((s) => s.data.map((d) => Math.abs(d || 0))), 1);
  const plotH = 140;
  const labelH = 16;
  const H = plotH + labelH;
  const group = W / Math.max(nL, 1);
  const barW = Math.max(3, Math.min(28, (group - 8) / nS - 2));
  const showValues = nL * nS <= 16; // selective direct labels, never a number on every mark of a dense chart
  const a = scrub.active;
  const tip: TipState | null =
    a === null
      ? null
      : {
          x: `${((a * group + group / 2) / W) * 100}%`,
          y: `${((plotH - (Math.max(...spec.series.map((s) => Math.abs(s.data[a] || 0))) / max) * (plotH - 18)) / H) * 100}%`,
          text: nS > 1 ? spec.labels[a] : `${spec.labels[a]}: ${fmt(spec.series[0].data[a], spec.unit)}`,
          lines: nS > 1 ? spec.series.map((s, si) => ({ color: seriesColor(slots[si]), text: `${s.name}: ${fmt(s.data[a], spec.unit)}` })) : undefined,
        };
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={cn("w-full", FOCUS)}
        role="img"
        aria-label={`${spec.title ?? "bar chart"} — arrow keys read values, Enter pins`}
        data-viz-scrub
        {...scrub.focusProps}
        onMouseMove={(e) => scrub.setHover(Math.max(0, Math.min(nL - 1, Math.floor(vbX(e) / group))))}
        onClick={() => scrub.togglePin(a)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={plotH - f * (plotH - 18)} y2={plotH - f * (plotH - 18)} stroke="var(--viz-grid)" strokeWidth={1} />
        ))}
        {a !== null && <rect x={a * group + 2} y={0} width={group - 4} height={plotH} rx={6} fill="var(--muted)" opacity={0.5} />}
        <line x1={0} x2={W} y1={plotH} y2={plotH} stroke="var(--line-strong)" strokeWidth={1} />
        {spec.labels.map((label, li) => {
          const cx = li * group + group / 2;
          const total = nS * barW + (nS - 1) * 2;
          const dim = a !== null && a !== li;
          return (
            <g key={li} opacity={dim ? 0.45 : 1} style={geo(reduced, "opacity")}>
              {spec.series.map((s, si) => {
                const v = s.data[li] || 0;
                const h = (Math.abs(v) / max) * (plotH - 18);
                const x = cx - total / 2 + si * (barW + 2);
                const y = plotH - h;
                const hh = Math.max(h, 1);
                return (
                  <g key={s.name}>
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={hh}
                      rx={Math.min(4, barW / 2)}
                      fill={seriesColor(slots[si])}
                      className={cn(!reduced && "viz-grow")}
                      style={
                        {
                          x, y, width: barW, height: hh,
                          ...geo(reduced, "x, y, width, height"),
                          transformOrigin: `${x + barW / 2}px ${plotH}px`,
                          animationDelay: `${Math.min((li * nS + si) * 25, 300)}ms`,
                        } as React.CSSProperties
                      }
                    />
                    {showValues && (
                      <text x={x + barW / 2} y={y - 4} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
                        {fmt(v, spec.unit)}
                      </text>
                    )}
                  </g>
                );
              })}
              {scrub.pinned === li && <rect x={cx - 3} y={plotH + 1} width={6} height={2} rx={1} fill="var(--foreground)" aria-hidden />}
              <text x={cx} y={H - 2} textAnchor="middle" className={scrub.pinned === li ? "fill-foreground" : "fill-muted-foreground"} fontSize={10}>
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

/** Stacked bars: one column per label, segments in slot order with a 2px surface gap between fills. */
function StackedBars({ spec, slots }: { spec: ChartSpec; slots: number[] }) {
  const reduced = useReduced();
  const scrub = useScrub(spec.labels);
  const nL = spec.labels.length;
  const totals = spec.labels.map((_, li) => spec.series.reduce((acc, s) => acc + (s.data[li] || 0), 0));
  const max = Math.max(...totals, 1);
  const plotH = 140;
  const H = plotH + 16;
  const group = W / Math.max(nL, 1);
  const barW = Math.max(6, Math.min(32, group - 12));
  const a = scrub.active;
  const tip: TipState | null =
    a === null
      ? null
      : {
          x: `${((a * group + group / 2) / W) * 100}%`,
          y: `${((plotH - (totals[a] / max) * (plotH - 18)) / H) * 100}%`,
          text: `${spec.labels[a]} · ${fmt(totals[a], spec.unit)}`,
          lines: spec.series.map((s, si) => ({ color: seriesColor(slots[si]), text: `${s.name}: ${fmt(s.data[a], spec.unit)}` })).reverse(),
        };
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={cn("w-full", FOCUS)}
        role="img"
        aria-label={`${spec.title ?? "stacked bar chart"} — arrow keys read values, Enter pins`}
        data-viz-scrub
        {...scrub.focusProps}
        onMouseMove={(e) => scrub.setHover(Math.max(0, Math.min(nL - 1, Math.floor(vbX(e) / group))))}
        onClick={() => scrub.togglePin(a)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={plotH - f * (plotH - 18)} y2={plotH - f * (plotH - 18)} stroke="var(--viz-grid)" strokeWidth={1} />
        ))}
        {a !== null && <rect x={a * group + 2} y={0} width={group - 4} height={plotH} rx={6} fill="var(--muted)" opacity={0.5} />}
        <line x1={0} x2={W} y1={plotH} y2={plotH} stroke="var(--line-strong)" strokeWidth={1} />
        {spec.labels.map((label, li) => {
          const x = li * group + (group - barW) / 2;
          let yCursor = plotH;
          const dim = a !== null && a !== li;
          return (
            <g key={li} opacity={dim ? 0.45 : 1} style={geo(reduced, "opacity")}>
              {spec.series.map((s, si) => {
                const v = s.data[li] || 0;
                const h = (v / max) * (plotH - 18);
                yCursor -= h;
                const y = yCursor;
                yCursor -= 2; // the 2px surface gap between stacked fills
                if (h <= 0) return null;
                const hh = Math.max(h, 1);
                return (
                  <rect
                    key={s.name}
                    x={x}
                    y={y}
                    width={barW}
                    height={hh}
                    rx={si === spec.series.length - 1 ? Math.min(4, barW / 2) : 1}
                    fill={seriesColor(slots[si])}
                    className={cn(!reduced && "viz-grow")}
                    style={
                      {
                        x, y, width: barW, height: hh,
                        ...geo(reduced, "x, y, width, height"),
                        transformOrigin: `${x + barW / 2}px ${plotH}px`,
                        animationDelay: `${Math.min(li * 30, 300)}ms`,
                      } as React.CSSProperties
                    }
                  />
                );
              })}
              {scrub.pinned === li && <rect x={x + barW / 2 - 3} y={plotH + 1} width={6} height={2} rx={1} fill="var(--foreground)" aria-hidden />}
              <text x={x + barW / 2} y={H - 2} textAnchor="middle" className={scrub.pinned === li ? "fill-foreground" : "fill-muted-foreground"} fontSize={10}>
                {label.length > Math.max(4, group / 7) ? label.slice(0, Math.max(3, Math.floor(group / 7))) + "…" : label}
              </text>
              {nL <= 12 && (
                <text x={x + barW / 2} y={plotH - (totals[li] / max) * (plotH - 18) - 4 - (spec.series.length - 1) * 2} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
                  {fmt(totals[li], spec.unit)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

/** Scatter: dots at (label index, value); ≤ 3 series (the palette's all-pairs cap), ≥8px markers. */
function Scatter({ spec, slots }: { spec: ChartSpec; slots: number[] }) {
  const [tip, setTip] = React.useState<TipState | null>(null);
  const plotH = 140;
  const H = plotH + 16;
  const nL = spec.labels.length;
  const all = spec.series.flatMap((s) => s.data);
  const max = Math.max(...all, 0);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  const px = (i: number) => (nL === 1 ? W / 2 : (i / (nL - 1)) * (W - 24) + 12);
  const py = (v: number) => plotH - ((v - min) / span) * (plotH - 16) - 4;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title ?? "scatter plot"}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={plotH * (1 - f)} y2={plotH * (1 - f)} stroke="var(--viz-grid)" strokeWidth={1} />
        ))}
        <line x1={0} x2={W} y1={plotH} y2={plotH} stroke="var(--line-strong)" strokeWidth={1} />
        {spec.series.map((s, si) =>
          s.data.map((v, i) => (
            <circle
              key={`${s.name}-${i}`}
              cx={px(i)}
              cy={py(v)}
              r={4}
              fill={seriesColor(slots[si])}
              stroke="var(--card)"
              strokeWidth={2}
              onMouseEnter={(e) => {
                const host = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                const r = e.currentTarget.getBoundingClientRect();
                setTip({ x: r.left - host.left + r.width / 2, y: r.top - host.top, text: `${spec.labels[i]}${spec.series.length > 1 ? ` · ${s.name}` : ""}: ${fmt(v, spec.unit)}` });
              }}
              onMouseLeave={() => setTip(null)}
            />
          ))
        )}
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

/** Line / area with a crosshair that reads every visible series at the hovered category. */
function Lines({ spec, slots, area }: { spec: ChartSpec; slots: number[]; area: boolean }) {
  const reduced = useReduced();
  const scrub = useScrub(spec.labels);
  const H = 156;
  const plotH = 140;
  const nL = spec.labels.length;
  const all = spec.series.flatMap((s) => s.data.filter((v) => typeof v === "number"));
  const max = Math.max(...all, 0);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  const px = (i: number) => (nL === 1 ? W / 2 : (i / (nL - 1)) * (W - 16) + 8);
  const py = (v: number) => plotH - (((v || 0) - min) / span) * (plotH - 16) - 4;
  const a = scrub.active;
  const tip: TipState | null =
    a === null
      ? null
      : {
          x: `${(px(a) / W) * 100}%`,
          y: `${(Math.min(...spec.series.map((s) => py(s.data[a]))) / H) * 100}%`,
          text: spec.series.length > 1 ? spec.labels[a] : `${spec.labels[a]}: ${fmt(spec.series[0].data[a], spec.unit)}`,
          lines: spec.series.length > 1 ? spec.series.map((s, si) => ({ color: seriesColor(slots[si]), text: `${s.name}: ${fmt(s.data[a], spec.unit)}` })) : undefined,
        };
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={cn("w-full", FOCUS)}
        role="img"
        aria-label={`${spec.title ?? "line chart"} — arrow keys scrub, Enter pins`}
        data-viz-scrub
        {...scrub.focusProps}
        onMouseMove={(e) => scrub.setHover(nL <= 1 ? 0 : Math.max(0, Math.min(nL - 1, Math.round(((vbX(e) - 8) / (W - 16)) * (nL - 1)))))}
        onClick={() => scrub.togglePin(a)}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={plotH * (1 - f)} y2={plotH * (1 - f)} stroke="var(--viz-grid)" strokeWidth={1} />
        ))}
        <line x1={0} x2={W} y1={py(Math.max(min, 0))} y2={py(Math.max(min, 0))} stroke="var(--line-strong)" strokeWidth={1} />
        {spec.series.map((s, si) => {
          const d = s.data.map((v, i) => `${i ? "L" : "M"}${px(i)},${py(v)}`).join(" ");
          return (
            <g key={s.name}>
              {area && <path d={`${d} L${px(s.data.length - 1)},${plotH} L${px(0)},${plotH} Z`} fill={seriesColor(slots[si])} opacity={0.12} />}
              <path d={d} fill="none" stroke={seriesColor(slots[si])} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn(!reduced && "viz-draw")} pathLength={1} />
              {/* Direct end-label: name the line at its last point when few series (identity ≠ color alone). */}
              {spec.series.length <= 4 && spec.series.length >= 2 && (
                <text x={px(s.data.length - 1) - 2} y={py(s.data[s.data.length - 1]) - 6} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
                  {s.name}
                </text>
              )}
            </g>
          );
        })}
        {a !== null && (
          <g aria-hidden pointerEvents="none">
            <line x1={px(a)} x2={px(a)} y1={4} y2={plotH} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="3 3" />
            {spec.series.map((s, si) =>
              typeof s.data[a] === "number" ? (
                <circle
                  key={s.name}
                  cx={px(a)}
                  cy={py(s.data[a])}
                  r={4}
                  fill={seriesColor(slots[si])}
                  stroke="var(--card)"
                  strokeWidth={2}
                  style={{ cx: px(a), cy: py(s.data[a]), ...geo(reduced, "cx, cy") } as React.CSSProperties}
                />
              ) : null
            )}
          </g>
        )}
        {spec.labels.map((label, i) =>
          nL <= 12 || i % Math.ceil(nL / 12) === 0 || i === a ? (
            <text key={i} x={px(i)} y={H - 2} textAnchor="middle" className={i === a || i === scrub.pinned ? "fill-foreground" : "fill-muted-foreground"} fontSize={10}>
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
  const [tip, setTip] = React.useState<TipState | null>(null);
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
