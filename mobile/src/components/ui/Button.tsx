import React from "react";
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from "react-native";
import { PressScale, type HapticKind } from "@/components/motion";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./AppText";

type Variant = "primary" | "secondary" | "ghost" | "destructive" | "attention" | "outline";

/**
 * The app's button. Press feedback comes from PressScale (one spring everywhere); a committing
 * variant taps lightly on press. While loading the title goes transparent under a centred spinner
 * so the button keeps its width and the row doesn't shift.
 */
export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  small,
  haptic,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  /** Defaults to a light tap for primary/destructive/attention, silent otherwise. */
  haptic?: HapticKind | null;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { palette } = useTheme();
  const bg =
    variant === "primary" ? palette.primary
    : variant === "secondary" ? palette.secondary
    : variant === "destructive" ? palette.destructive
    : variant === "attention" ? palette.attention
    : "transparent";
  const fg =
    variant === "primary" ? palette.primaryForeground
    : variant === "destructive" ? palette.destructiveForeground
    : variant === "attention" ? palette.attentionInk
    : palette.foreground;
  const committing = variant === "primary" || variant === "destructive" || variant === "attention";
  const tap = haptic === undefined ? (committing ? "light" : undefined) : haptic ?? undefined;
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled || loading}
      scaleTo={0.96}
      haptic={tap}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      hitSlop={small ? { top: 5, bottom: 5 } : undefined}
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.lg,
          paddingVertical: small ? 8 : 12,
          paddingHorizontal: small ? 12 : 16,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.45 : 1,
          borderWidth: variant === "outline" ? 1 : 0,
          borderColor: palette.lineStrong,
          minHeight: small ? 34 : 46,
        },
        style,
      ]}
    >
      <T variant={small ? "meta" : "body"} weight="medium" style={{ color: fg, opacity: loading ? 0 : 1 }}>
        {title}
      </T>
      {loading && (
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="small" color={fg} />
        </View>
      )}
    </PressScale>
  );
}
