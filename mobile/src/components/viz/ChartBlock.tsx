import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import type { Palette } from "@/theme/tokens";
import type { ChartSpec } from "@/lib/viz";
import { T } from "../ui/AppText";
import Svg, { Circle, G, Line, Path } from "react-native-svg";

/**
 * Charts: bars stay as labelled native bars (readable at phone width); line / area / sparkline /
 * scatter draw as an SVG plot and donut as an SVG ring, each with a legend.
 */
export function ChartBlock({ spec }: { spec: ChartSpec }) {
  if (spec.type === "donut") return <Donut spec={spec} />;
  if (spec.type === "line" || spec.type === "area" || spec.type === "sparkline" || spec.type === "scatter") return <Plot spec={spec} />;
  return <Bars spec={spec} />;
}

function Legend({ names, colors }: { names: string[]; colors: string[] }) {
  if (names.length < 2) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {names.map((n, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors[i] }} />
          <T variant="micro" tone="muted">
            {n}
          </T>
        </View>
      ))}
    </View>
  );
}

function Plot({ spec }: { spec: ChartSpec }) {
  const { palette } = useTheme();
  const [w, setW] = React.useState(0);
  const colors = spec.series.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length](palette));
  const spark = spec.type === "sparkline";
  const h = spark ? 48 : 160;
  const all = spec.series.flatMap((s) => s.data).filter((n) => Number.isFinite(n));
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all, lo + 1);
  const n = Math.max(1, spec.labels.length - 1);
  const pad = spark ? 2 : 6;
  const x = (i: number) => pad + (i / n) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
  const last = spec.series[0]?.data[spec.series[0].data.length - 1];
  return (
    <View style={{ gap: 6 }}>
      <Legend names={spec.series.map((s) => s.name)} colors={colors} />
      {!spark ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <T variant="micro" tone="faint">
            max {fmt(hi, spec.unit)}
          </T>
          {last != null ? (
            <T variant="micro" tone="muted">
              latest {fmt(last, spec.unit)}
            </T>
          ) : null}
        </View>
      ) : null}
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: h }}>
        {w > 0 ? (
          <Svg width={w} height={h}>
            {!spark ? <Line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke={palette.border} strokeWidth={1} /> : null}
            {spec.series.map((s, k) => {
              const pts = s.data.map((v, i) => [x(i), y(Number.isFinite(v) ? v : 0)] as const);
              if (spec.type === "scatter")
                return (
                  <G key={k}>
                    {pts.map(([px, py], i) => (
                      <Circle key={i} cx={px} cy={py} r={3} fill={colors[k]} />
                    ))}
                  </G>
                );
              const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
              return (
                <G key={k}>
                  {spec.type === "area" && pts.length ? (
                    <Path d={`${d} L${pts[pts.length - 1][0].toFixed(1)},${y(lo).toFixed(1)} L${pts[0][0].toFixed(1)},${y(lo).toFixed(1)} Z`} fill={colors[k]} opacity={0.18} />
                  ) : null}
                  <Path d={d} stroke={colors[k]} strokeWidth={spark ? 1.5 : 2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                </G>
              );
            })}
          </Svg>
        ) : null}
      </View>
      {!spark && spec.labels.length ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <T variant="micro" tone="faint" numberOfLines={1}>
            {spec.labels[0]}
          </T>
          <T variant="micro" tone="faint" numberOfLines={1}>
            {spec.labels[spec.labels.length - 1]}
          </T>
        </View>
      ) : null}
    </View>
  );
}

function Donut({ spec }: { spec: ChartSpec }) {
  const { palette } = useTheme();
  const data = (spec.series[0]?.data ?? []).map((v) => Math.max(0, v || 0));
  const total = data.reduce((a, b) => a + b, 0) || 1;
  const colors = data.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length](palette));
  const size = 120;
  const r = 46;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={palette.muted} strokeWidth={14} fill="none" />
          {data.map((v, i) => {
            const len = (v / total) * c;
            const el = <Circle key={i} cx={size / 2} cy={size / 2} r={r} stroke={colors[i]} strokeWidth={14} fill="none" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} />;
            acc += len;
            return el;
          })}
        </G>
      </Svg>
      <View style={{ flex: 1, gap: 4 }}>
        {spec.labels.map((l, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors[i] }} />
            <T variant="micro" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {l}
            </T>
            <T variant="micro" style={{ fontVariant: ["tabular-nums"] }}>
              {fmt(data[i] ?? 0, spec.unit)} · {Math.round(((data[i] ?? 0) / total) * 100)}%
            </T>
          </View>
        ))}
      </View>
    </View>
  );
}

const SERIES_COLORS: ((p: Palette) => string)[] = [
  (p) => p.foreground,
  (p) => p.live,
  (p) => p.ok,
  (p) => p.sleep,
  (p) => p.attentionText,
  (p) => p.destructive,
  (p) => p.mutedForeground,
  (p) => p.faint,
];

function fmt(n: number, unit?: string): string {
  const s = Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(Math.round(n * 100) / 100);
  return unit ? `${s}${unit}` : s;
}

function Bars({ spec }: { spec: ChartSpec }) {
  const { palette } = useTheme();
  const colors = spec.series.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length](palette));
  const stacked = spec.stacked === true;
  const max = React.useMemo(() => {
    let m = 0;
    for (let i = 0; i < spec.labels.length; i++) {
      const vals = spec.series.map((s) => Math.abs(s.data[i]));
      m = Math.max(m, stacked ? vals.reduce((a, b) => a + b, 0) : Math.max(...vals));
    }
    return m || 1;
  }, [spec, stacked]);
  const multi = spec.series.length > 1;

  return (
    <View style={{ gap: multi ? 10 : 6 }}>
      {multi ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {spec.series.map((s, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors[i] }} />
              <T variant="micro" tone="muted">
                {s.name}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      {spec.labels.map((label, i) => (
        <View key={i} style={{ gap: 3 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <T variant="micro" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {label}
            </T>
            {!multi || stacked ? (
              <T variant="micro" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                {fmt(stacked ? spec.series.reduce((a, s) => a + s.data[i], 0) : spec.series[0].data[i], spec.unit)}
              </T>
            ) : null}
          </View>
          {stacked ? (
            <View style={{ flexDirection: "row", height: 10, borderRadius: 3, overflow: "hidden", backgroundColor: palette.muted }}>
              {spec.series.map((s, k) => (
                <View key={k} style={{ width: `${(Math.abs(s.data[i]) / max) * 100}%`, backgroundColor: colors[k] }} />
              ))}
            </View>
          ) : (
            spec.series.map((s, k) => (
              <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ flex: 1, height: multi ? 6 : 10, borderRadius: 3, backgroundColor: palette.muted, overflow: "hidden" }}>
                  <View
                    style={{
                      width: `${Math.max(1, (Math.abs(s.data[i]) / max) * 100)}%`,
                      height: "100%",
                      backgroundColor: s.data[i] < 0 ? palette.destructive : colors[k],
                      opacity: spec.type === "area" ? 0.7 : 1,
                    }}
                  />
                </View>
                {multi ? (
                  <T variant="micro" tone="faint" style={{ width: 56, textAlign: "right", fontVariant: ["tabular-nums"] }}>
                    {fmt(s.data[i], spec.unit)}
                  </T>
                ) : null}
              </View>
            ))
          )}
        </View>
      ))}
    </View>
  );
}
