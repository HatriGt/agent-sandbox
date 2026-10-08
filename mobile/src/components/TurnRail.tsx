import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { DUR } from "./motion";
import { PressScale } from "@/components/motion";

/** A turn in the thread. `index` is its row in the transcript list; -1 is the pinned task above it. */
export type Turn = { key: string; kind: "task" | "you" | "question"; index: number };

/**
 * Touch turn-navigator: appears only while browsing history (hidden at the
 * live edge), on a pill of its own so it never sits on top of text. One dot
 * per turn — amber for questions — tap to jump.
 */
export function TurnRail({
  turns,
  visible,
  topIndex,
  viewportH,
  onJump,
}: {
  turns: Turn[];
  visible: boolean;
  /** First transcript row currently on screen (from the list's viewability callback). */
  topIndex: number;
  viewportH: number;
  onJump: (turn: Turn) => void;
}) {
  const { palette } = useTheme();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: visible && turns.length >= 2 ? 1 : 0, duration: DUR.fast, useNativeDriver: true }).start();
  }, [visible, turns.length, fade]);

  if (turns.length < 2) return null;
  let activeIdx = 0;
  turns.forEach((t, i) => {
    if (t.index <= topIndex) activeIdx = i;
  });

  // Each dot costs ~16px of height, so a long conversation would grow a rail taller than the phone
  // and spill off both ends. Keep a window around the turn you're on instead — the rail is for
  // jumping near where you are, not an index of everything.
  const MAX = Math.max(4, Math.floor((viewportH - 80) / 16));
  let from = 0;
  if (turns.length > MAX) from = Math.min(turns.length - MAX, Math.max(0, activeIdx - Math.floor(MAX / 2)));
  const shown = turns.slice(from, from + MAX);

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
        {shown.map((t, j) => {
          const i = from + j;
          const active = i === activeIdx;
          const color = t.kind === "question" ? palette.attention : active ? palette.foreground : palette.lineStrong;
          return (
            <PressScale key={t.key} onPress={() => onJump(t)} hitSlop={{ left: 14, right: 14, top: 5, bottom: 5 }}>
              <View
                style={{
                  width: active ? 8 : 6,
                  height: active ? 8 : 6,
                  borderRadius: 4,
                  backgroundColor: color,
                }}
              />
            </PressScale>
          );
        })}
      </View>
    </Animated.View>
  );
}
