import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./AppText";
import { Icon, type IconName } from "./Icon";

/**
 * The dashed empty card (web ui/empty-state.tsx): an optional icon disc, a one-line title, a short
 * body and, when there is a way forward, the action under it. Same border, radius and padding
 * wherever a list has nothing to show.
 */
export function EmptyState({ title, body, action, icon, accessibilityLabel }: { title: string; body?: string; action?: React.ReactNode; icon?: IconName; accessibilityLabel?: string }) {
  const { palette } = useTheme();
  return (
    <View accessibilityLabel={accessibilityLabel ?? title} style={{ borderWidth: 1, borderStyle: "dashed", borderColor: palette.border, borderRadius: radius.xl, paddingHorizontal: 24, paddingVertical: 32, alignItems: "center", gap: 4 }}>
      {icon ? (
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: palette.muted, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
          <Icon name={icon} size={16} color={palette.mutedForeground} />
        </View>
      ) : null}
      <T variant="meta" weight="medium" style={{ textAlign: "center" }}>
        {title}
      </T>
      {body ? (
        <T variant="meta" tone="muted" style={{ textAlign: "center", maxWidth: 320 }}>
          {body}
        </T>
      ) : null}
      {action ? <View style={{ marginTop: 12, alignItems: "center" }}>{action}</View> : null}
    </View>
  );
}
