import React from "react";
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./AppText";

type Variant = "primary" | "secondary" | "ghost" | "destructive" | "attention" | "outline";

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  small,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
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
    : variant === "destructive" ? "#ffffff"
    : variant === "attention" ? palette.attentionInk
    : palette.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.lg,
          paddingVertical: small ? 8 : 12,
          paddingHorizontal: small ? 12 : 16,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
          borderWidth: variant === "outline" ? 1 : 0,
          borderColor: palette.lineStrong,
          minHeight: small ? 34 : 46,
        },
        style,
      ]}
    >
      {loading && <ActivityIndicator size="small" color={fg} />}
      <T variant={small ? "meta" : "body"} weight="medium" style={{ color: fg }}>
        {title}
      </T>
    </Pressable>
  );
}
