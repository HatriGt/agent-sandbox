import React from "react";
import { ScrollView, View } from "react-native";
import Svg, { G, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import dagre from "@dagrejs/dagre";
import { useTheme } from "@/theme/ThemeContext";
import { fonts } from "@/theme/tokens";
import type { Dag, DagKind } from "@/lib/viz";
import { T } from "../ui/AppText";
import { ExpandAction, VizFullscreen } from "./Fullscreen";

/**
 * ```graph / ```dag / mermaid flowchart → a layered graph laid out by dagre (same settings as
 * web's GraphCanvas) and drawn with react-native-svg: step = rounded card, decision = diamond,
 * terminal = pill; edges follow dagre's routed points with an arrowhead and a label chip. Tap a
 * node to light its upstream/downstream reach (tap again to clear). Fullscreen for big graphs.
 */

const CHAR_W = 7;
const NODE_H = 36;
const DIAMOND_H = 64;
const MAX_CHARS = 32;

function nodeSize(name: string, kind: DagKind): { w: number; h: number } {
  const text = Math.min(name.length, MAX_CHARS) * CHAR_W;
  if (kind === "decision") {
    const side = Math.max(DIAMOND_H, Math.min(140, text * 0.75 + 36));
    return { w: side * 1.5, h: side };
  }
  return { w: Math.max(96, Math.min(260, text + 32)), h: NODE_H };
}

interface Layout {
  pos: { x: number; y: number }[];
  sizes: { w: number; h: number }[];
  edges: { points: { x: number; y: number }[]; label?: string; lx: number; ly: number }[];
  width: number;
  height: number;
}

function layout(dag: Dag): Layout {
  const depth = Math.max(...dag.layers) + 1;
  const width = Math.max(...Array.from({ length: depth }, (_, l) => dag.layers.filter((x) => x === l).length));
  const dir = depth >= 6 && width <= 2 ? "TB" : "LR";
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep: 28, ranksep: dag.labels ? 72 : 56, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  const sizes = dag.nodes.map((n, i) => nodeSize(n, dag.kinds?.[i] ?? "step"));
  dag.nodes.forEach((_, i) => g.setNode(String(i), { width: sizes[i].w, height: sizes[i].h }));
  dag.edges.forEach(([a, b], k) => {
    const label = dag.labels?.[k];
    g.setEdge(String(a), String(b), label ? { width: label.length * 6 + 16, height: 18 } : {});
  });
  dagre.layout(g);
  const pos = dag.nodes.map((_, i) => {
    const n = g.node(String(i));
    return { x: n.x - sizes[i].w / 2, y: n.y - sizes[i].h / 2 };
  });
  const edges = dag.edges.map(([a, b], k) => {
    const e = g.edge(String(a), String(b));
    const points = e?.points ?? [];
    const mid = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
    return { points, label: dag.labels?.[k], lx: e?.x ?? mid.x, ly: e?.y ?? mid.y };
  });
  const graph = g.graph();
  return { pos, sizes, edges, width: graph.width ?? 0, height: graph.height ?? 0 };
}

/** Every node reachable from `start` following edges up (dependencies) or down (dependents). */
function walk(dag: Dag, start: number, dir: "up" | "down"): Set<number> {
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    for (const [a, b] of dag.edges) {
      const next = dir === "down" ? (a === n ? b : -1) : b === n ? a : -1;
      if (next >= 0 && !seen.has(next) && next !== start) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Split a decision label over ≤ 3 lines that fit the diamond's inner width. */
function wrap(text: string, chars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > chars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) return [...lines.slice(0, 2), clip(lines.slice(2).join(" "), chars)];
  return lines;
}

function GraphSvg({ dag, lay, zoom, focus, onFocus }: { dag: Dag; lay: Layout; zoom: number; focus: number | null; onFocus: (i: number | null) => void }) {
  const { palette } = useTheme();
  const lit = React.useMemo(() => {
    if (focus === null) return null;
    const s = new Set<number>([focus, ...walk(dag, focus, "up"), ...walk(dag, focus, "down")]);
    return s;
  }, [dag, focus]);
  const nodeState = (i: number) => (lit === null ? "lit" : i === focus ? "focus" : lit.has(i) ? "lit" : "dim");
  const edgeOn = (a: number, b: number) => lit !== null && lit.has(a) && lit.has(b);
  return (
    <Svg width={lay.width * zoom} height={lay.height * zoom} viewBox={`0 0 ${lay.width} ${lay.height}`}>
      {/* edges first, under the nodes */}
      {lay.edges.map((e, k) => {
        if (e.points.length < 2) return null;
        const [a, b] = dag.edges[k];
        const on = edgeOn(a, b);
        const dim = lit !== null && !on;
        const stroke = on ? palette.foreground : palette.mutedForeground;
        const d = e.points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
        const end = e.points[e.points.length - 1];
        const prev = e.points[e.points.length - 2];
        const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
        const ah = (da: number) => `${(end.x - 7 * Math.cos(ang + da)).toFixed(1)},${(end.y - 7 * Math.sin(ang + da)).toFixed(1)}`;
        return (
          <G key={`e${k}`} opacity={dim ? 0.3 : 1}>
            <Path d={d} fill="none" stroke={stroke} strokeWidth={on ? 1.75 : 1.25} strokeLinejoin="round" />
            <Path d={`M${ah(-0.45)} L${end.x.toFixed(1)},${end.y.toFixed(1)} L${ah(0.45)}`} fill="none" stroke={stroke} strokeWidth={on ? 1.75 : 1.25} strokeLinecap="round" strokeLinejoin="round" />
            {e.label ? (
              <G>
                <Rect x={e.lx - (e.label.length * 6 + 12) / 2} y={e.ly - 9} width={e.label.length * 6 + 12} height={18} rx={9} fill={palette.card} stroke={palette.border} strokeWidth={1} />
                <SvgText x={e.lx} y={e.ly + 3.5} textAnchor="middle" fontSize={10} fontFamily={fonts.sans} fill={palette.mutedForeground}>
                  {e.label}
                </SvgText>
              </G>
            ) : null}
          </G>
        );
      })}
      {dag.nodes.map((name, i) => {
        const kind = dag.kinds?.[i] ?? "step";
        const { x, y } = lay.pos[i];
        const { w, h } = lay.sizes[i];
        const st = nodeState(i);
        const stroke = st === "focus" ? palette.foreground : palette.lineStrong;
        const sw = st === "focus" ? 2 : 1;
        const press = () => onFocus(focus === i ? null : i);
        return (
          <G key={`n${i}`} opacity={st === "dim" ? 0.35 : 1} onPress={press}>
            {kind === "decision" ? (
              <>
                <Polygon points={`${x + w / 2},${y + 1} ${x + w - 1},${y + h / 2} ${x + w / 2},${y + h - 1} ${x + 1},${y + h / 2}`} fill={palette.card} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
                {wrap(name, Math.max(6, Math.floor((w * 0.6) / 6.5))).map((line, li, all) => (
                  <SvgText key={li} x={x + w / 2} y={y + h / 2 + 4 + (li - (all.length - 1) / 2) * 13} textAnchor="middle" fontSize={11} fontFamily={fonts.sansMedium} fill={palette.foreground}>
                    {line}
                  </SvgText>
                ))}
              </>
            ) : (
              <>
                <Rect x={x} y={y} width={w} height={h} rx={kind === "terminal" ? h / 2 : 8} fill={palette.card} stroke={stroke} strokeWidth={sw} />
                <SvgText x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={11.5} fontFamily={fonts.sansMedium} fill={palette.foreground}>
                  {clip(name, MAX_CHARS)}
                </SvgText>
              </>
            )}
          </G>
        );
      })}
    </Svg>
  );
}

export function GraphBlock({ dag }: { dag: Dag }) {
  const lay = React.useMemo(() => layout(dag), [dag]);
  const [focus, setFocus] = React.useState<number | null>(null);
  const [full, setFull] = React.useState(false);
  return (
    <View style={{ gap: 6 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
        <GraphSvg dag={dag} lay={lay} zoom={1} focus={focus} onFocus={setFocus} />
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <T variant="micro" tone="faint" style={{ flex: 1 }}>
          {dag.nodes.length} nodes · {dag.edges.length} edges{focus !== null ? " · tap again to clear" : " · tap a node to trace it"}
        </T>
        <ExpandAction onPress={() => setFull(true)} />
      </View>
      <VizFullscreen visible={full} onClose={() => setFull(false)} title={`graph · ${dag.nodes.length} nodes`}>
        {(zoom) => <GraphSvg dag={dag} lay={lay} zoom={zoom} focus={focus} onFocus={setFocus} />}
      </VizFullscreen>
    </View>
  );
}
