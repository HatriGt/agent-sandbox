import * as React from "react";
import type { Heatmap, Span } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";

/**
 * ```gantt / ```spans → horizontal span chart (task schedule, request waterfall). One shared
 * numeric axis; each row a rounded bar from start to end with the duration labeled directly.
 * Single-hue (sequential job: extent, not identity) — labels carry identity.
 */
export function SpansBlock({ spans, unit, source }: { spans: Span[]; unit?: string; source: string }) {
  const min = Math.min(...spans.map((s) => s.start));
  const max = Math.max(...spans.map((s) => s.end));
  const range = max - min || 1;
  return (
    <VizFrame title={`${spans.length} spans`} source={source}>
      <div className="flex flex-col gap-1.5 px-4 py-3">
        {spans.map((s, i) => {
          const left = ((s.start - min) / range) * 100;
          const width = Math.max(((s.end - s.start) / range) * 100, 0.5);
          const dur = s.end - s.start;
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="text-foreground w-36 min-w-0 shrink-0 truncate text-meta">{s.label}</span>
              <div className="relative h-4 min-w-0 flex-1">
                <span aria-hidden className="bg-muted/60 absolute inset-y-1.5 inset-x-0 rounded-full" />
                <span
                  className="absolute inset-y-0.5 rounded-[4px]"
                  style={{ left: `${left}%`, width: `${width}%`, background: "var(--viz-1)" }}
                  title={`${s.label}: ${s.start}–${s.end}${unit ?? ""}`}
                />
              </div>
              <span className="text-muted-foreground w-16 shrink-0 text-right text-micro tabular-nums">
                {dur}
                {unit ?? ""}
              </span>
            </div>
          );
        })}
        <div className="text-faint mt-0.5 flex justify-between text-micro tabular-nums" style={{ paddingLeft: "9.75rem", paddingRight: "4.75rem" }}>
          <span>
            {min}
            {unit ?? ""}
          </span>
          <span>
            {max}
            {unit ?? ""}
          </span>
        </div>
      </div>
    </VizFrame>
  );
}

/** ```funnel → centered stage bars narrowing with the value; conversion % against the first stage. */
export function FunnelBlock({ stages, source }: { stages: { label: string; value: number }[]; source: string }) {
  const top = stages[0]?.value || 1;
  return (
    <VizFrame source={source}>
      <div className="flex flex-col gap-1 px-4 py-3">
        {stages.map((s, i) => {
          const frac = Math.min(1, s.value / top);
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="text-foreground w-32 min-w-0 shrink-0 truncate text-meta">{s.label}</span>
              <div className="flex h-6 min-w-0 flex-1 justify-center">
                <span
                  className="h-full rounded-[4px]"
                  style={{ width: `${Math.max(frac * 100, 1.5)}%`, background: "var(--viz-1)", opacity: 0.45 + 0.55 * frac }}
                  title={`${s.label}: ${s.value}`}
                />
              </div>
              <span className="text-muted-foreground w-24 shrink-0 text-right text-micro tabular-nums">
                {s.value.toLocaleString()} · {Math.round((s.value / top) * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}

/**
 * ```heatmap → value grid on a single-hue sequential ramp (light→dark of --viz-1 via color-mix),
 * value shown in the cell when the grid is small; hover tooltip always.
 */
export function HeatmapBlock({ map, source }: { map: Heatmap; source: string }) {
  const [tip, setTip] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const all = map.values.flat();
  const max = Math.max(...all);
  const min = Math.min(...all);
  const span = max - min || 1;
  const dense = map.rows.length * map.cols.length > 120;
  return (
    <VizFrame title={`${map.rows.length}×${map.cols.length}`} source={source} rawLanguage="json">
      <div className="relative overflow-x-auto px-4 py-3">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {map.cols.map((c) => (
                <th key={c} className="text-muted-foreground px-1 pb-1 text-center text-micro font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {map.rows.map((r, ri) => (
              <tr key={r}>
                <th className="text-muted-foreground pr-2 text-right text-micro font-medium whitespace-nowrap">{r}</th>
                {map.cols.map((c, ci) => {
                  const v = map.values[ri][ci];
                  const t = (v - min) / span;
                  return (
                    <td
                      key={c}
                      className="rounded-[4px] text-center"
                      style={{
                        background: `color-mix(in oklch, var(--viz-1) ${Math.round(8 + t * 80)}%, var(--card))`,
                        minWidth: dense ? 14 : 34,
                        height: dense ? 14 : 26,
                      }}
                      onMouseEnter={(e) => {
                        const host = e.currentTarget.closest(".relative")!.getBoundingClientRect();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTip({ x: rect.left - host.left + rect.width / 2, y: rect.top - host.top, text: `${r} × ${c}: ${v}${map.unit ?? ""}` });
                      }}
                      onMouseLeave={() => setTip(null)}
                    >
                      {!dense && (
                        <span className="text-micro tabular-nums" style={{ color: t > 0.55 ? "white" : "var(--foreground)" }}>
                          {v}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {tip && (
          <div
            className="bg-popover text-popover-foreground pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border px-2 py-1 text-micro whitespace-nowrap shadow-e2"
            style={{ left: tip.x, top: tip.y - 4 }}
            role="status"
          >
            {tip.text}
          </div>
        )}
      </div>
    </VizFrame>
  );
}
