import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius, type Palette } from "@/theme/tokens";
import { sortFindings, type Annotated, type CompareOption, type Finding, type FlowStep, type Layer, type Severity, type TreeNode } from "@/lib/viz";
import { T } from "../ui/AppText";
import { Icon, type IconName } from "../ui/Icon";
import { PressScale } from "@/components/motion";

/** Mobile bodies for findings, compare, annotate, layers, flow and tree (web ReviewBlocks / ExplainBlocks / FlowBlock / TreeBlock). */

// ---------------------------------------------------------------- findings

const SEVERITY_META: Record<Severity, { word: string; icon: IconName; tone: (p: Palette) => string }> = {
  high: { word: "High", icon: "alert-octagon", tone: (p) => p.destructive },
  medium: { word: "Medium", icon: "alert-triangle", tone: (p) => p.attentionText },
  low: { word: "Low", icon: "info", tone: (p) => p.live },
  info: { word: "Info", icon: "circle", tone: (p) => p.mutedForeground },
};

/** Severity-sorted rows: glyph + severity WORD (never colour alone), a mono `where` chip, the text. */
export function FindingsBlock({ findings }: { findings: Finding[] }) {
  const { palette } = useTheme();
  const sorted = React.useMemo(() => sortFindings(findings), [findings]);
  return (
    <View style={{ gap: 10 }}>
      {sorted.map((f, i) => {
        const meta = SEVERITY_META[f.severity];
        const c = meta.tone(palette);
        return (
          <View key={i} style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, width: 74, height: 20 }}>
              <Icon name={meta.icon} size={12} color={c} />
              <T variant="micro" weight="semibold" style={{ color: c }}>
                {meta.word}
              </T>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              {f.where ? (
                <T variant="micro" mono tone="muted" selectable>
                  {f.where}
                </T>
              ) : null}
              <T variant="meta" selectable>
                {f.text}
              </T>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- compare

const COMPARE_GLYPH: Record<CompareOption["items"][number]["tone"], { icon: IconName; tone: (p: Palette) => string }> = {
  pro: { icon: "check", tone: (p) => p.ok },
  con: { icon: "x", tone: (p) => p.destructive },
  note: { icon: "minus", tone: (p) => p.mutedForeground },
};

/** Options stacked (phone width); the pick ringed in the live accent with a "Recommended" badge. */
export function CompareBlock({ options }: { options: CompareOption[] }) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {options.map((o, i) => (
        <View
          key={i}
          style={{
            borderWidth: o.picked ? 1.5 : 1,
            borderColor: o.picked ? palette.live : palette.border,
            borderRadius: radius.lg,
            padding: 10,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T variant="meta" weight="semibold" style={{ flex: 1 }}>
              {o.name}
            </T>
            {o.picked ? (
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: palette.live }}>
                <T variant="micro" weight="medium" style={{ color: palette.primaryForeground }}>
                  Recommended
                </T>
              </View>
            ) : null}
          </View>
          {o.items.map((it, k) => {
            const g = COMPARE_GLYPH[it.tone];
            return (
              <View key={k} style={{ flexDirection: "row", gap: 6 }}>
                <View style={{ height: 20, justifyContent: "center" }}>
                  <Icon name={g.icon} size={12} color={g.tone(palette)} />
                </View>
                <T variant="meta" tone={it.tone === "note" ? "muted" : "default"} style={{ flex: 1 }}>
                  {it.text}
                </T>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- annotate

/** Numbered code with gutter markers per annotated range; notes listed under the code. Tap a note to light its lines. */
export function AnnotateBlock({ data }: { data: Annotated }) {
  const { palette } = useTheme();
  const [active, setActive] = React.useState<number | null>(null);
  const lines = data.code.split("\n");
  const markerAt = new Map<number, number>();
  data.notes.forEach((n, i) => {
    if (!markerAt.has(n.from)) markerAt.set(n.from, i);
  });
  const lit = (ln: number) => active !== null && ln >= data.notes[active].from && ln <= data.notes[active].to;
  const gutter = String(data.startLine + lines.length - 1).length;
  return (
    <View style={{ gap: 10 }}>
      {data.file ? (
        <T variant="micro" mono tone="muted">
          {data.file}
        </T>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: palette.muted, borderRadius: radius.md }}>
        <View style={{ paddingVertical: 6 }}>
          {lines.map((line, i) => {
            const ln = data.startLine + i;
            const marker = markerAt.get(ln);
            const on = lit(ln);
            return (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, backgroundColor: on ? palette.accent : "transparent" }}>
                <View style={{ width: 18, alignItems: "center" }}>
                  {marker !== undefined ? <Marker n={marker + 1} on={active === marker} /> : null}
                </View>
                <T variant="code" mono tone="faint" style={{ width: gutter * 8 + 8, textAlign: "right", marginRight: 10 }}>
                  {ln}
                </T>
                <T variant="code" mono selectable>
                  {line || " "}
                </T>
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ gap: 8 }}>
        {data.notes.map((n, i) => (
          <PressScale key={i} onPress={() => setActive(active === i ? null : i)} accessibilityRole="button" style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ height: 20, justifyContent: "center" }}>
              <Marker n={i + 1} on={active === i} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="micro" mono tone="faint">
                {n.from === n.to ? `L${n.from}` : `L${n.from}–${n.to}`}
              </T>
              <T variant="meta">{n.text}</T>
            </View>
          </PressScale>
        ))}
      </View>
    </View>
  );
}

function Marker({ n, on }: { n: number; on: boolean }) {
  const { palette } = useTheme();
  return (
    <View style={{ width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: on ? palette.live : palette.foreground }}>
      <T variant="micro" weight="semibold" style={{ color: palette.background, fontSize: 9, lineHeight: 12 }}>
        {n}
      </T>
    </View>
  );
}

// ---------------------------------------------------------------- layers

/** Architecture stack: full-width bands top → bottom with item chips and quiet connectors. */
export function LayersBlock({ layers }: { layers: Layer[] }) {
  const { palette } = useTheme();
  return (
    <View>
      {layers.map((l, i) => (
        <View key={i}>
          {i > 0 ? <View style={{ alignSelf: "center", width: 1, height: 10, backgroundColor: palette.lineStrong }} /> : null}
          <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.muted, padding: 10, gap: 6 }}>
            <T variant="micro" weight="semibold" tone="muted">
              {l.name}
            </T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {l.items.map((it, k) => (
                <View key={k} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.card }}>
                  <T variant="micro">{it}</T>
                </View>
              ))}
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- flow

const FLOW_META: Record<FlowStep["state"], { icon?: IconName; word: string; tone: (p: Palette) => string }> = {
  ok: { icon: "check", word: "done", tone: (p) => p.ok },
  fail: { icon: "x", word: "failed", tone: (p) => p.destructive },
  active: { icon: "loader", word: "in progress", tone: (p) => p.live },
  plain: { word: "", tone: (p) => p.lineStrong },
};

/** Chains of steps as wrapping pills joined by arrows; ✓ / ✗ / … carry glyph + colour. */
export function FlowBlock({ chains }: { chains: FlowStep[][] }) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      {chains.map((chain, i) => (
        <View key={i} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 6, columnGap: 4 }}>
          {chain.map((s, k) => {
            const m = FLOW_META[s.state];
            const c = m.tone(palette);
            return (
              <React.Fragment key={k}>
                {k > 0 ? <Icon name="arrow-right" size={12} color={palette.faint} /> : null}
                <View
                  accessibilityLabel={m.word ? `${s.name}, ${m.word}` : s.name}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: s.state === "plain" ? palette.border : c, backgroundColor: palette.card }}
                >
                  {m.icon ? <Icon name={m.icon} size={11} color={c} /> : null}
                  <T variant="micro" weight="medium">
                    {s.name}
                  </T>
                </View>
              </React.Fragment>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- tree

/** Collapsible tree: folders (nodes with children) toggle; notes trail muted. */
export function TreeBlock({ roots }: { roots: TreeNode[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {roots.map((n, i) => (
          <TreeRow key={i} node={n} depth={0} />
        ))}
      </View>
    </ScrollView>
  );
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const { palette } = useTheme();
  const [open, setOpen] = React.useState(depth < 3);
  const folder = node.children.length > 0;
  return (
    <View>
      <PressScale
        disabled={!folder}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole={folder ? "button" : undefined}
        accessibilityState={folder ? { expanded: open } : undefined}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: depth * 16, minHeight: 24 }}
      >
        <Icon name={folder ? (open ? "chevron-down" : "chevron-right") : "file"} size={12} color={palette.faint} />
        <T variant="meta" mono={!folder} weight={folder ? "medium" : undefined}>
          {node.name}
        </T>
        {node.note ? (
          <T variant="micro" tone="faint">
            {node.note}
          </T>
        ) : null}
      </PressScale>
      {folder && open ? node.children.map((c, i) => <TreeRow key={i} node={c} depth={depth + 1} />) : null}
    </View>
  );
}
