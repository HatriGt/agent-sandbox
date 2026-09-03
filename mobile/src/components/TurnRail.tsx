import React, { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

export type Turn = { key: string; kind: "task" | "you" | "question"; y: number };

/**
 * Touch turn-navigator: appears only while browsing history (hidden at the
 * live edge), on a pill of its own so it never sits on top of text. One dot
 * per turn — amber for questions — tap to jump.
 */
export function TurnRail({
  turns,
  visible,
  scrollY,
  viewportH,
  onJump,
}: {
  turns: Turn[];
  visible: boolean;
  scrollY: number;
  viewportH: number;
  onJump: (y: number) => void;
}) {
  const { palette } = useTheme();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: visible && turns.length >= 2 ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [visible, turns.length, fade]);

  if (turns.length < 2) return null;
  let activeIdx = 0;
  turns.forEach((t, i) => {
    if (t.y <= scrollY + viewportH * 0.4) activeIdx = i;
  });

  return (
    <Animated.View
      pointerEvents={visible ? "box-none" : "none"}
      style={{
        position: "absolute",
        right: 6,
        top: 0,
        bottom: 0,
        justifyContent: "center",
        opacity: fade,
      }}
    >
      <View
        style={{
          backgroundColor: palette.popover,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: 999,
          paddingVertical: 10,
          paddingHorizontal: 7,
          gap: 10,
          alignItems: "center",
        }}
      >
        {turns.map((t, i) => {
          const active = i === activeIdx;
          const color = t.kind === "question" ? palette.attention : active ? palette.foreground : palette.lineStrong;
          return (
            <Pressable key={t.key} onPress={() => onJump(t.y)} hitSlop={{ left: 14, right: 14, top: 5, bottom: 5 }}>
              <View
                style={{
                  width: active ? 8 : 6,
                  height: active ? 8 : 6,
                  borderRadius: 4,
                  backgroundColor: color,
                }}
              />
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}
