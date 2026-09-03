import React from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";

/** Raised card: bg-card + hairline border (border OR shadow, never both — we use border). */
export function Card({
  children,
  onPress,
  onLongPress,
  style,
  attention,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  attention?: boolean;
}) {
  const { palette } = useTheme();
  const base: ViewStyle = {
    backgroundColor: attention ? palette.attention : palette.card,
    borderRadius: radius.xl,
    borderWidth: attention ? 0 : 1,
    borderColor: palette.border,
    padding: 14,
  };
  if (!onPress && !onLongPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [base, { opacity: pressed ? 0.85 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}
