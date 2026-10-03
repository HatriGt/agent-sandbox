import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import type { Palette } from "@/theme/tokens";
import type { Badge, BadgeTone, CalloutKind, ProgressRow, Stat, StatusItem, Step, TestReport, TimelineEvent } from "@/lib/viz";
import { T } from "../ui/AppText";
import { Icon, type IconName } from "../ui/Icon";

// ---------------------------------------------------------------- stats

export function StatsBlock({ stats }: { stats: Stat[] }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {stats.map((s, i) => (
        <View
          key={i}
          style={{
            minWidth: "45%",
            flexGrow: 1,
            backgroundColor: palette.muted,
            borderRadius: radius.lg,
            padding: 10,
            gap: 2,
          }}
        >
          <T variant="micro" tone="muted" numberOfLines={1}>
            {s.label}
          </T>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <T variant="h2" weight="semibold" style={{ fontVariant: ["tabular-nums"] }}>
              {s.value}
            </T>
            {s.delta ? (
              <T variant="micro" weight="medium" style={{ color: s.deltaGood ? palette.ok : palette.destructive }}>
                {s.delta.startsWith("+") ? "▲ " : "▼ "}
                {s.delta}
              </T>
            ) : null}
          </View>
          {s.note ? (
            <T variant="micro" tone="faint" numberOfLines={2}>
              {s.note}
            </T>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- kv

export function KvBlock({ rows }: { rows: { key: string; value: string }[] }) {
  const { palette } = useTheme();
  return (
    <View>
      {rows.map((r, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            gap: 12,
            paddingVertical: 6,
            borderTopWidth: i ? 1 : 0,
            borderTopColor: palette.border,
          }}
        >
          <T variant="meta" tone="muted" style={{ width: "36%" }} numberOfLines={2}>
            {r.key}
          </T>
          <T variant="meta" selectable style={{ flex: 1 }}>
            {r.value}
          </T>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- badges

function toneColor(p: Palette, tone: BadgeTone): string {
  switch (tone) {
    case "ok":
      return p.ok;
    case "warn":
      return p.attentionText;
    case "fail":
      return p.destructive;
    case "live":
      return p.live;
    default:
      return p.mutedForeground;
  }
}

export function BadgesBlock({ badges }: { badges: Badge[] }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {badges.map((b, i) => {
        const c = toneColor(palette, b.tone);
        return (
          <View
            key={i}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.muted,
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
            <T variant="micro" tone="muted">
              {b.label}
            </T>
            <T variant="micro" weight="semibold" style={{ color: c }}>
              {b.value}
            </T>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- progress

export function ProgressBlock({ rows }: { rows: ProgressRow[] }) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {rows.map((r, i) => (
        <View key={i} style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <T variant="meta" numberOfLines={1} style={{ flex: 1 }}>
              {r.label}
            </T>
            <T variant="meta" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
              {r.text}
            </T>
          </View>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: palette.muted, overflow: "hidden" }}>
            <View
              style={{
                width: `${Math.round(r.frac * 100)}%`,
                height: "100%",
                borderRadius: 2,
                backgroundColor: r.frac >= 1 ? palette.ok : palette.foreground,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- steps

export function StepsBlock({ steps }: { steps: Step[] }) {
  const { palette } = useTheme();
  // The first unmarked step after the done ones is "up next"; web shows it as active-ish.
  return (
    <View style={{ gap: 2 }}>
      {steps.map((s, i) => {
        const color =
          s.state === "done" ? palette.ok : s.state === "fail" ? palette.destructive : s.state === "active" ? palette.live : palette.faint;
        const glyph: IconName = s.state === "done" ? "check" : s.state === "fail" ? "x" : s.state === "active" ? "loader" : "circle";
        return (
          <View key={i} style={{ flexDirection: "row", gap: 10, paddingVertical: 4 }}>
            <View style={{ width: 22, alignItems: "center", paddingTop: 2 }}>
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: s.state === "todo" ? palette.lineStrong : color,
                }}
              >
                {s.state === "todo" ? (
                  <T variant="micro" tone="faint" style={{ fontVariant: ["tabular-nums"] }}>
                    {i + 1}
                  </T>
                ) : (
                  <Icon name={glyph} size={11} color={color} />
                )}
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <T variant="meta" tone={s.state === "todo" ? "muted" : "default"} weight={s.state === "active" ? "medium" : "regular"}>
                {s.title}
              </T>
              {s.detail ? (
                <T variant="micro" tone="faint">
                  {s.detail}
                </T>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- tests

export function TestsBlock({ report }: { report: TestReport }) {
  const { palette } = useTheme();
  const pills: { n: number; word: string; color: string }[] = [
    { n: report.passed, word: "passed", color: palette.ok },
    { n: report.failed, word: "failed", color: palette.destructive },
    { n: report.skipped, word: "skipped", color: palette.mutedForeground },
  ];
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        {pills
          .filter((p) => p.n > 0 || p.word === "passed")
          .map((p) => (
            <View key={p.word} style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
              <T variant="h3" weight="semibold" style={{ color: p.color, fontVariant: ["tabular-nums"] }}>
                {p.n}
              </T>
              <T variant="micro" tone="muted">
                {p.word}
              </T>
            </View>
          ))}
        {report.duration ? (
          <T variant="micro" tone="faint" style={{ marginLeft: "auto" }}>
            in {report.duration}
          </T>
        ) : null}
      </View>
      {report.failures.length ? (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 8 }}>
          {report.failures.map((f, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8 }}>
              <Icon name="x" size={12} color={palette.destructive} style={{ marginTop: 3 }} />
              <T variant="meta" mono selectable style={{ flex: 1 }}>
                {f}
              </T>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- timeline

export function TimelineBlock({ events }: { events: TimelineEvent[] }) {
  const { palette } = useTheme();
  return (
    <View>
      {events.map((e, i) => {
        const color = e.state === "ok" ? palette.ok : e.state === "fail" ? palette.destructive : e.state === "active" ? palette.live : palette.lineStrong;
        const last = i === events.length - 1;
        return (
          <View key={i} style={{ flexDirection: "row", gap: 10 }}>
            <T variant="micro" mono tone="faint" style={{ width: 56, paddingTop: 3, textAlign: "right" }} numberOfLines={1}>
              {e.time}
            </T>
            <View style={{ width: 12, alignItems: "center" }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: color }} />
              {!last ? (
                <View style={{ flex: 1, width: 0, borderLeftWidth: 1, borderStyle: "dotted", borderLeftColor: palette.lineStrong, marginVertical: 2 }} />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : 10 }}>
              <T variant="meta" selectable>
                {e.text}
              </T>
              {e.note ? (
                <T variant="micro" tone="faint">
                  {e.note}
                </T>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- status list (markdown upgrade)

export function StatusListBlock({ items, renderText }: { items: StatusItem[]; renderText: (text: string) => React.ReactNode }) {
  const { palette } = useTheme();
  const meta = (s: StatusItem["state"]): { icon: IconName; color: string } => {
    switch (s) {
      case "ok":
        return { icon: "check", color: palette.ok };
      case "fail":
        return { icon: "x", color: palette.destructive };
      case "warn":
        return { icon: "alert-triangle", color: palette.attentionText };
      case "pending":
        return { icon: "clock", color: palette.faint };
      default:
        return { icon: "info", color: palette.live };
    }
  };
  return (
    <View style={{ gap: 4 }}>
      {items.map((it, i) => {
        const m = meta(it.state);
        return (
          <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <Icon name={m.icon} size={14} color={m.color} style={{ marginTop: 5 }} />
            <View style={{ flex: 1 }}>{renderText(it.text)}</View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- checklist (GFM task list)

export function ChecklistBlock({ items, renderText }: { items: { checked: boolean; text: string }[]; renderText: (text: string, muted: boolean) => React.ReactNode }) {
  const { palette } = useTheme();
  const done = items.filter((i) => i.checked).length;
  const header = items.length >= 3;
  return (
    <View style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, overflow: "hidden" }}>
      {header ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 32, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: palette.border }}>
          <T variant="micro" weight="medium" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
            {done}/{items.length} done
          </T>
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: palette.muted, overflow: "hidden" }}>
            <View style={{ width: `${items.length ? Math.round((done / items.length) * 100) : 0}%`, height: "100%", backgroundColor: palette.ok }} />
          </View>
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 4 }}>
        {items.map((it, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <Icon name={it.checked ? "check-circle" : "circle"} size={14} color={it.checked ? palette.ok : palette.faint} style={{ marginTop: 5 }} />
            <View style={{ flex: 1 }}>{renderText(it.text, it.checked)}</View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- callout

const CALLOUT_META: Record<CalloutKind, { icon: IconName; word: string; tone: (p: Palette) => string }> = {
  note: { icon: "info", word: "Note", tone: (p) => p.live },
  tip: { icon: "zap", word: "Tip", tone: (p) => p.ok },
  important: { icon: "shield", word: "Important", tone: (p) => p.sleep },
  warning: { icon: "alert-triangle", word: "Warning", tone: (p) => p.attentionText },
  caution: { icon: "alert-octagon", word: "Caution", tone: (p) => p.destructive },
  success: { icon: "check-circle", word: "Success", tone: (p) => p.ok },
  error: { icon: "x-circle", word: "Error", tone: (p) => p.destructive },
};

/** Tinted left rule + title line; the body is markdown rendered by the caller. */
export function CalloutBlock({ kind, title, children }: { kind: CalloutKind; title?: string; children: React.ReactNode }) {
  const { palette } = useTheme();
  const meta = CALLOUT_META[kind];
  const c = meta.tone(palette);
  return (
    <View style={{ borderLeftWidth: 2, borderLeftColor: c, paddingLeft: 12, paddingVertical: 2, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={meta.icon} size={13} color={c} />
        <T variant="meta" weight="semibold" style={{ color: c }}>
          {title ?? meta.word}
        </T>
      </View>
      {children}
    </View>
  );
}
