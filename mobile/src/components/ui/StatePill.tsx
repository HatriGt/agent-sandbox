import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius, stateColor } from "@/theme/tokens";
import { T } from "./AppText";
import { WorkingDot } from "./WorkingDot";

const GLYPH = { dot: "●", hand: "◆", check: "✓", x: "✕", moon: "☾", circle: "○" } as const;

/** State = color + icon + word, always all three (design rule #2). */
export function StatePill({
  runState,
  boxStatus,
  exitCode,
}: {
  runState?: string;
  boxStatus?: string;
  exitCode?: number | null;
}) {
  const { palette } = useTheme();
  const s = stateColor(palette, { runState, boxStatus, exitCode });
  const attention = s.word === "needs you";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: attention ? palette.attention : "transparent",
        borderWidth: attention ? 0 : 1,
        borderColor: palette.border,
        // Words like "out of memory" and "needs you" are wide; the pill must keep its own size and
        // let whatever sits beside it give ground, never split across two lines.
        flexShrink: 0,
        alignSelf: "flex-start",
      }}
    >
      {s.icon === "dot" ? (
        <WorkingDot color={s.color} />
      ) : (
        <T variant="micro" style={{ color: attention ? palette.attentionInk : s.color }}>
          {GLYPH[s.icon]}
        </T>
      )}
      <T variant="meta" weight="medium" numberOfLines={1} style={{ color: attention ? palette.attentionInk : s.color }}>
        {s.word}
      </T>
    </View>
  );
}
