import React from "react";
import { ScrollView, View } from "react-native";
import Svg, { G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { useTheme } from "@/theme/ThemeContext";
import { fonts } from "@/theme/tokens";
import type { Sequence, SequenceItem } from "@/lib/viz";
import { T } from "../ui/AppText";
import { ExpandAction, VizFullscreen } from "./Fullscreen";

/**
 * ```sequence / mermaid sequenceDiagram → the hand-drawn sequence diagram (web SequenceFallback),
 * drawn natively so it works offline: actors across the top, hairline lifelines, one row per
 * message with an arrowhead toward the callee; replies dashed; notes as chips on a lane;
 * loop/alt/opt blocks as labelled dashed brackets. Tap a message to isolate it.
 */

const LANE_W = 150;
const HEAD_H = 28;
const ROW_H = 30;
const NOTE_H = 24;
const PAD_X = 12;
const PAD_TOP = 8;
const CHAR_W = 6;

type Block = Extract<SequenceItem, { kind: "block" }>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function SequenceSvg({ sequence, zoom, hover, onHover }: { sequence: Sequence; zoom: number; hover: number | null; onHover: (i: number | null) => void }) {
  const { palette } = useTheme();
  const { actors, items } = sequence;
  const { rowY, W, H } = React.useMemo(() => {
    const rowY: number[] = new Array(items.length).fill(0);
    let y = PAD_TOP + HEAD_H + 12;
    for (const [i, it] of items.entries()) {
      if (it.kind === "block") continue;
      if (items.some((b) => b.kind === "block" && b.start === i)) y += 16;
      rowY[i] = y;
      y += it.kind === "note" ? NOTE_H + 8 : ROW_H;
    }
    return { rowY, W: actors.length * LANE_W + PAD_X * 2, H: y + 6 };
  }, [items, actors.length]);
  const laneX = (i: number) => PAD_X + i * LANE_W + LANE_W / 2;
  const blocks = items.filter((i): i is Block => i.kind === "block");
  return (
    <Svg width={W * zoom} height={H * zoom} viewBox={`0 0 ${W} ${H}`}>
      {actors.map((a, i) => (
        <G key={`a${i}`}>
          <Line x1={laneX(i)} y1={PAD_TOP + HEAD_H} x2={laneX(i)} y2={H - 4} stroke={palette.border} strokeWidth={1} />
          <Rect x={laneX(i) - LANE_W / 2 + 10} y={PAD_TOP} width={LANE_W - 20} height={HEAD_H} rx={8} fill={palette.muted} stroke={palette.border} strokeWidth={1} />
          <SvgText x={laneX(i)} y={PAD_TOP + HEAD_H / 2 + 3.5} textAnchor="middle" fontSize={11} fontFamily={fonts.sansMedium} fill={palette.foreground}>
            {clip(a, 20)}
          </SvgText>
        </G>
      ))}
      {blocks.map((b, k) => {
        const inset = blocks.filter((o) => o !== b && o.start <= b.start && o.end >= b.end).length * 6;
        const top = rowY[b.start] - 20 + inset;
        const bottom = rowY[b.end] + (items[b.end].kind === "note" ? NOTE_H + 2 : ROW_H - 10) - inset;
        const x = PAD_X + 4 + inset;
        const w = W - PAD_X * 2 - 8 - inset * 2;
        return (
          <G key={`b${k}`}>
            <Rect x={x} y={top} width={w} height={bottom - top} rx={6} fill="none" stroke={palette.lineStrong} strokeWidth={1} strokeDasharray="3 3" />
            <Rect x={x} y={top} width={Math.min(b.label.length, 24) * CHAR_W + 12} height={14} rx={3} fill={palette.card} stroke={palette.lineStrong} strokeWidth={1} />
            <SvgText x={x + 6} y={top + 10} fontSize={9.5} fontFamily={fonts.monoMedium} fill={palette.mutedForeground}>
              {clip(b.label, 24)}
            </SvgText>
          </G>
        );
      })}
      {items.map((it, i) => {
        if (it.kind === "block") return null;
        const y = rowY[i];
        const dim = hover !== null && hover !== i ? 0.3 : 1;
        if (it.kind === "note") {
          const cx = laneX(it.actor);
          const w = Math.min(LANE_W - 16, it.text.length * CHAR_W + 16);
          return (
            <G key={`i${i}`} opacity={dim} onPress={() => onHover(hover === i ? null : i)}>
              <Rect x={cx - w / 2} y={y} width={w} height={NOTE_H} rx={5} fill={palette.card} stroke={palette.border} strokeWidth={1} />
              <SvgText x={cx} y={y + NOTE_H / 2 + 3.5} textAnchor="middle" fontSize={10} fontStyle="italic" fontFamily={fonts.sans} fill={palette.mutedForeground}>
                {clip(it.text, 22)}
              </SvgText>
            </G>
          );
        }
        const x1 = laneX(it.from);
        const x2 = laneX(it.to);
        const lit = hover === i;
        const stroke = lit ? palette.foreground : palette.lineStrong;
        const sw = lit ? 1.75 : 1.25;
        const dash = it.reply ? "4 3" : undefined;
        const ly = y + ROW_H / 2 + 2;
        const dir = x2 > x1 ? 1 : -1;
        const self = it.from === it.to;
        return (
          <G key={`i${i}`} opacity={dim} onPress={() => onHover(lit ? null : i)}>
            <Rect x={PAD_X} y={y} width={W - PAD_X * 2} height={ROW_H} fill="transparent" />
            {self ? (
              <>
                <Path d={`M${x1},${ly - 6} H${x1 + 28} V${ly + 8} H${x1 + 2}`} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
                <Path d={`M${x1 + 7},${ly + 4.5} L${x1 + 2},${ly + 8} L${x1 + 7},${ly + 11.5}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
              </>
            ) : (
              <>
                <Line x1={x1} y1={ly} x2={x2} y2={ly} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
                <Path d={`M${x2 - dir * 5},${ly - 3.5} L${x2},${ly} L${x2 - dir * 5},${ly + 3.5}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
              </>
            )}
            <SvgText x={self ? x1 + 34 : (x1 + x2) / 2} y={ly - 5} textAnchor={self ? "start" : "middle"} fontSize={10.5} fontFamily={fonts.sans} fill={lit ? palette.foreground : palette.mutedForeground}>
              {clip(it.text, 30)}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

export function SequenceBlock({ sequence }: { sequence: Sequence }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [full, setFull] = React.useState(false);
  const msgs = sequence.items.filter((i) => i.kind === "msg").length;
  const picked = hover !== null ? sequence.items[hover] : null;
  return (
    <View style={{ gap: 6 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
        <SequenceSvg sequence={sequence} zoom={1} hover={hover} onHover={setHover} />
      </ScrollView>
      {picked && picked.kind !== "block" ? (
        <T variant="micro" selectable>
          {picked.kind === "msg" ? `${sequence.actors[picked.from]} ${picked.reply ? "→ replies to" : "→"} ${sequence.actors[picked.to]}: ${picked.text}` : `${sequence.actors[picked.actor]}: ${picked.text}`}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <T variant="micro" tone="faint" style={{ flex: 1 }}>
          {sequence.actors.length} participants · {msgs} message{msgs === 1 ? "" : "s"}
        </T>
        <ExpandAction onPress={() => setFull(true)} />
      </View>
      <VizFullscreen visible={full} onClose={() => setFull(false)} title={`sequence · ${sequence.actors.length} participants`}>
        {(zoom) => <SequenceSvg sequence={sequence} zoom={zoom} hover={hover} onHover={setHover} />}
      </VizFullscreen>
    </View>
  );
}
