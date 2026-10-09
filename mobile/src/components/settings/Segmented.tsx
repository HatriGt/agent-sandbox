import React, { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { haptic, isReducedMotion, PressScale, SPRING } from "@/components/motion";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";

type Option<V extends string> = { value: V; label: string; badge?: string | number };

/**
 * Segmented control. `chips` (default): wrapping pill row, the shape Settings uses for appearance.
 * `glide`: one track with equal-width segments and a selection pill that springs between them.
 */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  small,
  variant = "chips",
}: {
  value: V;
  options: Option<V>[];
  onChange: (v: V) => void;
  small?: boolean;
  variant?: "chips" | "glide";
}) {
  const { palette } = useTheme();
  if (variant === "glide") return <Glide value={value} options={options} onChange={onChange} />;
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <T variant={small ? "micro" : "meta"} weight={on ? "semibold" : "regular"}>
              {o.label}
            </T>
            {o.badge !== undefined && o.badge !== 0 ? (
              <T variant="micro" weight="semibold" tone="attention">
                {o.badge}
              </T>
            ) : null}
          </View>
          </PressScale>
        );
      })}
    </View>
  );
}

/** Selection pill glides between equal segments (native-driver spring). */
function Glide<V extends string>({ value, options, onChange }: { value: V; options: Option<V>[]; onChange: (v: V) => void }) {
  const { palette } = useTheme();
  const [w, setW] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const x = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    if (isReducedMotion()) x.setValue(index);
    else Animated.spring(x, { toValue: index, useNativeDriver: true, speed: 22, bounciness: 4 }).start();
  }, [index, x]);
  const n = options.length;
  const seg = (w - 6) / n;
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{
        flexDirection: "row",
        padding: 3,
        borderRadius: radius.lg,
        backgroundColor: palette.card,
        borderWidth: 1,
        borderColor: palette.border,
      }}
    >
      {w > 0 ? (
        <Animated.View
          style={{
            position: "absolute",
            top: 3,
            bottom: 3,
            left: 3,
            width: seg,
            borderRadius: radius.md,
            backgroundColor: palette.background,
            transform: [{ translateX: x.interpolate({ inputRange: [0, Math.max(1, n - 1)], outputRange: [0, seg * Math.max(1, n - 1)] }) }],
          }}
        />
      ) : null}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <PressScale
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (!on) haptic("selection");
              onChange(o.value);
            }}
            style={{ flex: 1, alignItems: "center", paddingVertical: 7 }}
          >
            <T variant="meta" weight="medium" tone={on ? "default" : "muted"}>
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
