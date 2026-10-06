import React, { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import type { Palette } from "@/theme/tokens";
import type { Commit, DepUpdate, DiffStat, Heatmap, HttpCall, LogLevel, LogLine, Score, Span, Swatch } from "@/lib/viz";
import { T } from "../ui/AppText";
import { Icon } from "../ui/Icon";
import { MiniAction } from "./VizFrame";

const CAP = 40;
const tnum = { fontVariant: ["tabular-nums" as const] };

function Chip({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: bg }}>
      <T variant="micro" mono weight="medium" style={{ color }}>
        {text}
      </T>
    </View>
  );
}

function ShowAll({ hidden, onPress }: { hidden: number; onPress: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 }}>
      <T variant="micro" tone="faint">
        {hidden} more
      </T>
      <MiniAction label="Show all" onPress={onPress} />
    </View>
  );
}

// ---------------------------------------------------------------- score

export function ScoreBlock({ scores }: { scores: Score[] }) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {scores.map((s, i) => {
        const frac = s.max > 0 ? Math.max(0, Math.min(1, s.value / s.max)) : 0;
        return (
          <View key={i} style={{ gap: 3 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T variant="meta" numberOfLines={1} style={{ flex: 1 }}>
                {s.label}
              </T>
              {s.max <= 10 ? (
                <View style={{ flexDirection: "row", gap: 3 }}>
                  {Array.from({ length: s.max }, (_, d) => (
                    <View
                      key={d}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: d < Math.round(s.value) ? palette.foreground : palette.muted,
                        borderWidth: 1,
                        borderColor: d < Math.round(s.value) ? palette.foreground : palette.border,
                      }}
                    />
                  ))}
                </View>
              ) : (
                <View style={{ width: 90, height: 4, borderRadius: 2, backgroundColor: palette.muted, overflow: "hidden" }}>
                  <View style={{ width: `${Math.round(frac * 100)}%`, height: "100%", backgroundColor: palette.foreground }} />
                </View>
              )}
              <T variant="micro" tone="muted" style={tnum}>
                {s.value}/{s.max}
              </T>
            </View>
            {s.note ? (
              <T variant="micro" tone="muted">
                {s.note}
              </T>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- keys

export function KeysBlock({ rows }: { rows: { keys: string[]; action: string }[] }) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 3, maxWidth: "50%" }}>
            {r.keys.map((k, j) => (
              <React.Fragment key={j}>
                {j > 0 ? (
                  <T variant="micro" tone="faint">
                    +
                  </T>
                ) : null}
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    borderRadius: radius.sm,
                    borderWidth: 1,
                    borderBottomWidth: 2,
                    borderColor: palette.border,
                    backgroundColor: palette.muted,
                  }}
                >
                  <T variant="micro" mono weight="medium">
                    {k}
                  </T>
                </View>
              </React.Fragment>
            ))}
          </View>
          <T variant="meta" tone="muted" style={{ flex: 1 }}>
            {r.action}
          </T>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- palette

export function PaletteBlock({ swatches }: { swatches: Swatch[] }) {
  const { palette } = useTheme();
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {swatches.map((s, i) => (
        <Pressable
          key={i}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${s.hex}`}
          onPress={() => {
            Clipboard.setStringAsync(s.hex).catch(() => {});
            setCopied(i);
            setTimeout(() => setCopied((c) => (c === i ? null : c)), 1200);
          }}
          style={({ pressed }) => ({ width: 84, gap: 4, opacity: pressed ? 0.7 : 1 })}
        >
          <View style={{ height: 44, borderRadius: radius.md, backgroundColor: s.hex, borderWidth: 1, borderColor: palette.border }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <T variant="micro" mono numberOfLines={1}>
              {s.hex}
            </T>
            {copied === i ? <Icon name="check" size={10} color={palette.ok} /> : null}
          </View>
          {s.label ? (
            <T variant="micro" tone="muted" numberOfLines={1}>
              {s.label}
            </T>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- http

function statusColor(p: Palette, status: number): string {
  if (status >= 500) return p.destructive;
  if (status >= 400) return p.attentionText;
  if (status >= 300) return p.live;
  if (status >= 200) return p.ok;
  return p.mutedForeground;
}

export function HttpBlock({ calls }: { calls: HttpCall[] }) {
  const { palette } = useTheme();
  const [all, setAll] = useState(false);
  const shown = all ? calls : calls.slice(0, CAP);
  return (
    <View style={{ gap: 6 }}>
      {shown.map((c, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Chip text={c.method} color={palette.foreground} bg={palette.muted} />
          <T variant="micro" mono numberOfLines={1} selectable style={{ flex: 1 }}>
            {c.url}
          </T>
          {c.status !== undefined ? (
            <T variant="micro" mono weight="semibold" style={{ color: statusColor(palette, c.status) }}>
              {c.status}
              {c.statusText ? ` ${c.statusText}` : ""}
            </T>
          ) : null}
          {c.time ? (
            <T variant="micro" tone="faint" style={tnum}>
              {c.time}
            </T>
          ) : null}
        </View>
      ))}
      {!all && calls.length > CAP ? <ShowAll hidden={calls.length - CAP} onPress={() => setAll(true)} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- log

function levelColor(p: Palette, l: LogLevel): string {
  switch (l) {
    case "error":
      return p.destructive;
    case "warn":
      return p.attentionText;
    case "info":
      return p.foreground;
    case "debug":
      return p.mutedForeground;
    default:
      return p.foreground;
  }
}

const LEVELS = ["all", "error", "warn", "info", "debug"] as const;

export function LogBlock({ lines }: { lines: LogLine[] }) {
  const { palette } = useTheme();
  const [filter, setFilter] = useState<(typeof LEVELS)[number]>("all");
  const [all, setAll] = useState(false);
  const count = (l: (typeof LEVELS)[number]) => (l === "all" ? lines.length : lines.filter((x) => x.level === l).length);
  const filtered = filter === "all" ? lines : lines.filter((x) => x.level === filter);
  const shown = all ? filtered : filtered.slice(0, CAP);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {LEVELS.map((l) => {
          const n = count(l);
          if (l !== "all" && n === 0) return null;
          const active = filter === l;
          return (
            <Pressable
              key={l}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(l)}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: active ? palette.lineStrong : palette.border,
                backgroundColor: active ? palette.muted : "transparent",
              }}
            >
              <T variant="micro" weight={active ? "semibold" : "regular"} style={{ color: l === "all" ? palette.foreground : levelColor(palette, l) }}>
                {l} {n}
              </T>
            </Pressable>
          );
        })}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ gap: 1 }}>
          {shown.map((l, i) => (
            <T key={i} variant="micro" mono selectable style={{ color: levelColor(palette, l.level) }}>
              {l.text}
            </T>
          ))}
        </View>
      </ScrollView>
      {!all && filtered.length > CAP ? <ShowAll hidden={filtered.length - CAP} onPress={() => setAll(true)} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- diffstat

export function DiffstatBlock({ files }: { files: DiffStat[] }) {
  const { palette } = useTheme();
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...files.map((f) => f.add + f.del));
  const totalAdd = files.reduce((a, f) => a + f.add, 0);
  const totalDel = files.reduce((a, f) => a + f.del, 0);
  const shown = all ? files : files.slice(0, CAP);
  return (
    <View style={{ gap: 5 }}>
      {shown.map((f, i) => {
        const tot = f.add + f.del;
        return (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T variant="micro" mono numberOfLines={1} ellipsizeMode="head" style={{ flex: 1 }}>
              {f.path}
            </T>
            <T variant="micro" mono style={{ color: palette.ok }}>
              +{f.add}
            </T>
            <T variant="micro" mono style={{ color: palette.destructive }}>
              −{f.del}
            </T>
            <View style={{ width: 48, height: 4, borderRadius: 2, backgroundColor: palette.muted, overflow: "hidden" }}>
              <View style={{ flexDirection: "row", width: `${Math.round((tot / max) * 100)}%`, height: "100%" }}>
                <View style={{ flex: f.add, backgroundColor: palette.ok }} />
                <View style={{ flex: f.del, backgroundColor: palette.destructive }} />
              </View>
            </View>
          </View>
        );
      })}
      {!all && files.length > CAP ? <ShowAll hidden={files.length - CAP} onPress={() => setAll(true)} /> : null}
      <View style={{ flexDirection: "row", gap: 8, paddingTop: 4, borderTopWidth: 1, borderTopColor: palette.border }}>
        <T variant="micro" tone="muted">
          {files.length} file{files.length === 1 ? "" : "s"}
        </T>
        <T variant="micro" mono style={{ color: palette.ok }}>
          +{totalAdd}
        </T>
        <T variant="micro" mono style={{ color: palette.destructive }}>
          −{totalDel}
        </T>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- commits

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|tests|build|ci|chore|revert)(\([^)]*\))?(!)?:\s*/i;

function prefixColor(p: Palette, type: string, breaking: boolean): string {
  if (breaking) return p.destructive;
  switch (type) {
    case "feat":
      return p.ok;
    case "fix":
      return p.attentionText;
    case "perf":
    case "refactor":
      return p.live;
    case "revert":
      return p.destructive;
    default:
      return p.mutedForeground;
  }
}

export function CommitsBlock({ commits }: { commits: Commit[] }) {
  const { palette } = useTheme();
  const [all, setAll] = useState(false);
  const shown = all ? commits : commits.slice(0, CAP);
  return (
    <View style={{ gap: 5 }}>
      {shown.map((c, i) => {
        const m = c.message.match(CONVENTIONAL);
        const rest = m ? c.message.slice(m[0].length) : c.message;
        return (
          <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Chip text={c.hash.slice(0, 7)} color={palette.mutedForeground} bg={palette.muted} />
            <T variant="meta" numberOfLines={2} style={{ flex: 1 }}>
              {m ? (
                <T variant="meta" weight="semibold" style={{ color: prefixColor(palette, m[1].toLowerCase(), !!m[3]) }}>
                  {m[0].trimEnd()}{" "}
                </T>
              ) : null}
              {rest}
            </T>
          </View>
        );
      })}
      {!all && commits.length > CAP ? <ShowAll hidden={commits.length - CAP} onPress={() => setAll(true)} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- deps

function jumpColor(p: Palette, j: DepUpdate["jump"]): string {
  if (j === "major") return p.destructive;
  if (j === "minor") return p.attentionText;
  if (j === "patch") return p.ok;
  return p.mutedForeground;
}

export function DepsBlock({ deps }: { deps: DepUpdate[] }) {
  const { palette } = useTheme();
  const [all, setAll] = useState(false);
  const shown = all ? deps : deps.slice(0, CAP);
  return (
    <View style={{ gap: 6 }}>
      {shown.map((d, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T variant="meta" mono numberOfLines={1} style={{ flex: 1 }}>
            {d.name}
          </T>
          <T variant="micro" mono tone="muted">
            {d.from}
          </T>
          <Icon name="arrow-right" size={10} color={palette.mutedForeground} />
          <T variant="micro" mono weight="medium">
            {d.to}
          </T>
          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, borderWidth: 1, borderColor: jumpColor(palette, d.jump) }}>
            <T variant="micro" weight="medium" style={{ color: jumpColor(palette, d.jump) }}>
              {d.jump}
            </T>
          </View>
        </View>
      ))}
      {!all && deps.length > CAP ? <ShowAll hidden={deps.length - CAP} onPress={() => setAll(true)} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- funnel

export function FunnelBlock({ stages }: { stages: { label: string; value: number }[] }) {
  const { palette } = useTheme();
  const first = stages[0]?.value || 1;
  return (
    <View style={{ gap: 8 }}>
      {stages.map((s, i) => {
        const frac = Math.max(0, Math.min(1, s.value / first));
        const prev = i > 0 ? stages[i - 1].value : 0;
        return (
          <View key={i} style={{ gap: 3 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <T variant="meta" numberOfLines={1} style={{ flex: 1 }}>
                {s.label}
              </T>
              <T variant="meta" weight="medium" style={tnum}>
                {s.value.toLocaleString()}
              </T>
              {i > 0 ? (
                <T variant="micro" tone="muted" style={[tnum, { minWidth: 44, textAlign: "right" }]}>
                  {prev > 0 ? `↓ ${Math.round((s.value / prev) * 100)}%` : "—"}
                </T>
              ) : null}
            </View>
            <View style={{ height: 14, borderRadius: radius.sm, backgroundColor: palette.muted, overflow: "hidden" }}>
              <View style={{ width: `${Math.max(1, frac * 100)}%`, height: "100%", backgroundColor: palette.live, opacity: 0.85 }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- spans

export function SpansBlock({ spans, unit }: { spans: Span[]; unit?: string }) {
  const { palette } = useTheme();
  const min = Math.min(...spans.map((s) => s.start));
  const max = Math.max(...spans.map((s) => s.end));
  const range = max - min || 1;
  const u = unit ?? "";
  return (
    <View style={{ gap: 6 }}>
      {spans.map((s, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T variant="micro" numberOfLines={1} style={{ width: "30%" }}>
            {s.label}
          </T>
          <View style={{ flex: 1, height: 10, borderRadius: 3, backgroundColor: palette.muted }}>
            <View
              style={{
                position: "absolute",
                left: `${((s.start - min) / range) * 100}%`,
                width: `${Math.max(1, ((s.end - s.start) / range) * 100)}%`,
                top: 0,
                bottom: 0,
                borderRadius: 3,
                backgroundColor: palette.live,
              }}
            />
          </View>
          <T variant="micro" tone="muted" style={[tnum, { minWidth: 40, textAlign: "right" }]}>
            {+(s.end - s.start).toFixed(2)}
            {u}
          </T>
        </View>
      ))}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginLeft: "32%" }}>
        <T variant="micro" tone="faint" style={tnum}>
          {min}
          {u}
        </T>
        <T variant="micro" tone="faint" style={tnum}>
          {max}
          {u}
        </T>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- heatmap

export function HeatmapBlock({ map }: { map: Heatmap }) {
  const { palette } = useTheme();
  const flat = map.values.flat();
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const span = hi - lo || 1;
  const CELL = 40;
  return (
    <View style={{ gap: 6 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: "row", gap: 2 }}>
            <View style={{ width: 72 }} />
            {map.cols.map((c, j) => (
              <T key={j} variant="micro" tone="muted" numberOfLines={1} style={{ width: CELL, textAlign: "center" }}>
                {c}
              </T>
            ))}
          </View>
          {map.rows.map((r, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <T variant="micro" tone="muted" numberOfLines={1} style={{ width: 72 }}>
                {r}
              </T>
              {map.cols.map((_, j) => {
                const v = map.values[i]?.[j];
                const t = v === undefined ? 0 : (v - lo) / span;
                return (
                  <View key={j} style={{ width: CELL, height: 28, borderRadius: 4, backgroundColor: palette.muted, overflow: "hidden" }}>
                    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.live, opacity: 0.1 + t * 0.85 }} />
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                      <T variant="micro" weight="medium" style={[tnum, { color: t > 0.55 ? palette.background : palette.foreground }]}>
                        {v === undefined ? "" : v}
                      </T>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {map.unit ? (
        <T variant="micro" tone="faint">
          {lo}–{hi} {map.unit}
        </T>
      ) : null}
    </View>
  );
}
