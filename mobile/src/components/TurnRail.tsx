import React from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

export type Turn = { key: string; kind: "task" | "you" | "question"; y: number };

/**
 * The web's ThreadMinimap, phone-sized: a slim right-edge rail with one tick
 * per turn (task / follow-up / question). Tap a tick to jump; the active one
 * is the last turn above the viewport's upper 40%.
 */
export function TurnRail({
  turns,
  scrollY,
  viewportH,
  onJump,
}: {
  turns: Turn[];
  scrollY: number;
  viewportH: number;
  onJump: (y: number) => void;
}) {
  const { palette } = useTheme();
  if (turns.length < 2) return null;
  const activeIdx = (() => {
    let a = 0;
    turns.forEach((t, i) => {
      if (t.y <= scrollY + viewportH * 0.4) a = i;
    });
    return a;
  })();

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        right: 3,
        top: 0,
        bottom: 0,
        justifyContent: "center",
        gap: 8,
      }}
    >
      {turns.map((t, i) => {
        const active = i === activeIdx;
        const color = t.kind === "question" ? palette.attention : active ? palette.foreground : palette.lineStrong;
        return (
          <Pressable key={t.key} onPress={() => onJump(t.y)} hitSlop={{ left: 16, right: 8, top: 4, bottom: 4 }}>
            <View
              style={{
                width: active ? 14 : 8,
                height: 3,
                borderRadius: 2,
                backgroundColor: color,
                alignSelf: "flex-end",
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
