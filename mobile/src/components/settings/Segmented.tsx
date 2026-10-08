import React from "react";
import { View } from "react-native";
import { PressScale } from "@/components/motion";
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
              backgroundColor: on ? palette.accent : "transparent",
              borderWidth: 1,
              borderColor: on ? palette.lineStrong : palette.border,
            }}
          >
            <T variant={small ? "micro" : "meta"} weight={on ? "semibold" : "regular"}>
              {o.label}
            </T>
          </PressScale>
        );
      })}
    </View>
  );
}
