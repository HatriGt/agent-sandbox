import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import type { Palette } from "@/theme/tokens";
import type { ChartSpec } from "@/lib/viz";
import { T } from "../ui/AppText";
import { TableBlock } from "./TableBlock";

/**
 * Dependency-free chart: bar / line / area draw as horizontal labelled bars (react-native-svg is
 * not a dependency, so line and area are rendered as bars too — the magnitudes are what the
 * phone needs). Donut / sparkline / scatter fall back to a table of the series.
 */
export function ChartBlock({ spec }: { spec: ChartSpec }) {
  if (spec.type === "donut" || spec.type === "sparkline" || spec.type === "scatter") {
    return (
      <TableBlock
        table={{
          head: ["", ...spec.series.map((s) => s.name)],
          rows: spec.labels.map((l, i) => [l, ...spec.series.map((s) => fmt(s.data[i], spec.unit))]),
        }}
      />
    );
  }
  return <Bars spec={spec} />;
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
  const colors = spec.series.map((_, i) => SERIES_COLORS[i](palette));
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
