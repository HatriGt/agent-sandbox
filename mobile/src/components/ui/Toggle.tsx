import React, { useEffect, useRef } from "react";
import { Animated, Pressable, type AccessibilityProps } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { haptic, isReducedMotion, SPRING } from "@/components/motion";

const W = 44;
const H = 26;
const PAD = 3;
const KNOB = H - PAD * 2;
const TRAVEL = W - KNOB - PAD * 2;

/**
 * The app's switch. Replaces the platform `Switch` so every toggle shares one look: an ink track
 * (`primary`, like the Button) rather than the platform's blue/green, a white knob that springs
 * across on the native driver, and a selection tick on change. The hit area is 44pt tall.
 */
export function Toggle({
  value,
  onValueChange,
  disabled,
  ...a11y
}: { value: boolean; onValueChange: (next: boolean) => void; disabled?: boolean } & Pick<AccessibilityProps, "accessibilityLabel" | "accessibilityHint">) {
  const { palette } = useTheme();
  const t = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    if (isReducedMotion()) t.setValue(value ? 1 : 0);
    else Animated.spring(t, { toValue: value ? 1 : 0, useNativeDriver: true, ...SPRING.snap }).start();
  }, [value, t]);

  return (
    <Pressable
      {...a11y}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={{ top: 9, bottom: 9, left: 6, right: 6 }}
      onPress={() => {
        haptic("selection");
        onValueChange(!value);
      }}
      style={{ width: W, height: H, borderRadius: H / 2, justifyContent: "center", opacity: disabled ? 0.45 : 1 }}
    >
      {/* Off track underneath; the on track fades in over it so the colour change is continuous. */}
      <Animated.View style={{ position: "absolute", inset: 0, borderRadius: H / 2, backgroundColor: palette.input }} />
      <Animated.View style={{ position: "absolute", inset: 0, borderRadius: H / 2, backgroundColor: palette.primary, opacity: t }} />
      <Animated.View
        style={{
          width: KNOB,
          height: KNOB,
          borderRadius: KNOB / 2,
          marginLeft: PAD,
          backgroundColor: palette.primaryForeground,
          borderWidth: 1,
          borderColor: palette.lineStrong,
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
          elevation: 2,
          transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) }],
        }}
      />
    </Pressable>
  );
}
