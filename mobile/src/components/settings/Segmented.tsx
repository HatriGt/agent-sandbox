import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { isReducedMotion, PressScale, SPRING } from "@/components/motion";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";

/** Pill-row segmented control — the same shape the Settings tab uses for appearance. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  small,
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
  small?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <PressScale
            key={o.value}
            onPress={() => onChange(o.value)}
            haptic="selection"
            scaleTo={0.95}
            hitSlop={{ top: small ? 10 : 6, bottom: small ? 10 : 6 }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              paddingVertical: small ? 5 : 8,
              paddingHorizontal: small ? 10 : 14,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? palette.lineStrong : palette.border,
              overflow: "hidden",
            }}
          >
            <SelectionFill on={on} color={palette.accent} />
            <T variant={small ? "micro" : "meta"} weight={on ? "semibold" : "regular"}>
              {o.label}
            </T>
          </PressScale>
        );
      })}
    </View>
  );
}

export function SelectionFill({ on, color }: { on: boolean; color: string }) {
  const t = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    if (isReducedMotion()) {
      t.setValue(on ? 1 : 0);
      return;
    }
    Animated.spring(t, { toValue: on ? 1 : 0, ...SPRING.snap, useNativeDriver: true }).start();
  }, [on, t]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        borderRadius: radius.pill,
        backgroundColor: color,
        opacity: t,
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
      }}
    />
  );
}
