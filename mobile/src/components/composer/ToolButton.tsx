import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Icon, type IconName } from "@/components/ui/Icon";
import { haptic, PressScale } from "@/components/motion";

/**
 * One toolbar trigger (web composer/Toolbar.tsx ToolMenu trigger): an icon, an optional word, and
 * a dot when the menu holds a non-default pick. Each opens a Sheet on a phone instead of a popover.
 */
export function ToolButton({
  icon,
  label,
  accessibilityLabel,
  dot,
  disabled,
  onPress,
}: {
  icon: IconName;
  label?: string;
  accessibilityLabel: string;
  dot?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <PressScale
      disabled={disabled}
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 32,
        paddingHorizontal: label ? 9 : 7,
        borderRadius: radius.md,
        backgroundColor: pressed ? palette.accent : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <View>
        <Icon name={icon} size={15} color={dot ? palette.foreground : palette.mutedForeground} />
        {dot ? (
          <View
            style={{
              position: "absolute",
              top: -2,
              right: -3,
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: palette.live,
              borderWidth: 1,
              borderColor: palette.card,
            }}
          />
        ) : null}
      </View>
      {label ? (
        <T variant="meta" weight="medium" tone={dot ? "default" : "muted"} numberOfLines={1}>
          {label}
        </T>
      ) : null}
    </PressScale>
  );
}
