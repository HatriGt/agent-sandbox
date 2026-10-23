import React from "react";
import Svg, { Circle, Path, Rect, Text as SvgText } from "react-native-svg";
import { useTheme } from "@/theme/ThemeContext";
import { FILE_HUES } from "@/theme/palettes.generated";
import { fonts, type Palette } from "@/theme/tokens";
import { DOC, FOLDER, MARKS, TEST_BADGE, iconFor, type Hue, type Mark } from "./fileGlyphs";

export { ICONS, iconFor } from "./fileGlyphs";

function hueColor(hue: Hue, palette: Palette, dark: boolean): string {
  if (hue === "slate") return palette.mutedForeground;
  if (hue === "grey" || hue === "muted") return palette.faint;
  return FILE_HUES[dark ? "dark" : "light"][hue];
}

/**
 * A file or folder glyph: a two-tone folder (closed or open), or a document with a folded corner
 * and a small family mark, in one of eight hues at a single lightness per scheme. Test files add a
 * check badge in the same hue, so no state colour is borrowed.
 */
export function FileIcon({ name, folder, open, size = 16 }: { name: string; folder?: boolean; open?: boolean; size?: number }) {
  const { palette, dark } = useTheme();
  if (folder) {
    const tone = palette.mutedForeground;
    return (
      <Svg width={size} height={size} viewBox="0 0 16 16">
        <Path d={FOLDER.back} fill={tone} fillOpacity={0.55} />
        <Path d={open ? FOLDER.open : FOLDER.closed} fill={tone} />
      </Svg>
    );
  }
  const def = iconFor(name);
  const hue = hueColor(def.hue, palette, dark);
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path d={DOC.body} fill={hue} fillOpacity={0.14} stroke={hue} strokeWidth={1.1} strokeLinejoin="round" />
      <Path d={DOC.fold} fill="none" stroke={hue} strokeWidth={1.1} strokeLinejoin="round" />
      {MARKS[def.glyph].map((m, i) => (
        <MarkShape key={i} mark={m} hue={hue} />
      ))}
      {def.test ? (
        <>
          <Circle cx={TEST_BADGE.cx} cy={TEST_BADGE.cy} r={TEST_BADGE.r} fill={hue} />
          <Path d={TEST_BADGE.check} fill="none" stroke={palette.background} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
    </Svg>
  );
}

function MarkShape({ mark, hue }: { mark: Mark; hue: string }) {
  switch (mark.kind) {
    case "path":
      return mark.fill ? <Path d={mark.d} fill={hue} /> : <Path d={mark.d} fill="none" stroke={hue} strokeWidth={mark.width ?? 1.1} strokeLinecap="round" strokeLinejoin="round" />;
    case "text":
      return (
        <SvgText x={mark.x ?? 8} y={12.6} fontSize={mark.size ?? 5.4} fontFamily={fonts.monoMedium} fill={hue} textAnchor="middle">
          {mark.s}
        </SvgText>
      );
    case "circle":
      return mark.stroke ? <Circle cx={mark.cx} cy={mark.cy} r={mark.r} fill="none" stroke={hue} strokeWidth={1.1} /> : <Circle cx={mark.cx} cy={mark.cy} r={mark.r} fill={hue} />;
    case "rect":
      return <Rect x={mark.x} y={mark.y} width={mark.w} height={mark.h} rx={0.5} fill={hue} />;
  }
}
