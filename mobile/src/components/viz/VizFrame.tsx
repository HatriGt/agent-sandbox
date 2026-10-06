import React from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "../ui/AppText";
import { Icon, type IconName } from "../ui/Icon";
import { PressScale } from "@/components/motion";

/**
 * The card every output visualizer sits in: hairline border, a quiet header with the fence kind,
 * an optional title and a "raw" toggle that swaps the visual for the original code block.
 * `raw` is the code-block element the caller already knows how to draw.
 */
export function VizFrame({
  kind,
  title,
  raw,
  children,
  icon,
}: {
  kind: string;
  title?: string;
  raw: React.ReactNode;
  children: React.ReactNode;
  icon?: IconName;
}) {
  const { palette } = useTheme();
  const [showRaw, setShowRaw] = React.useState(false);
  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: radius.xl,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          height: 32,
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
        }}
      >
        {icon ? <Icon name={icon} size={12} color={palette.faint} /> : null}
        <T variant="micro" mono tone="faint">
          {kind}
        </T>
        <T variant="micro" weight="medium" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {title ?? ""}
        </T>
        <PressScale
          onPress={() => setShowRaw((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={showRaw ? "Show visual" : "Show raw"}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Icon name={showRaw ? "eye" : "code"} size={12} color={palette.faint} />
          <T variant="micro" tone="faint">
            {showRaw ? "visual" : "raw"}
          </T>
        </PressScale>
      </View>
      {showRaw ? <View style={{ padding: 8 }}>{raw}</View> : <View style={{ padding: 12 }}>{children}</View>}
    </View>
  );
}

/** Small action chip used inside frames and code blocks (Copy, Show all). */
export function MiniAction({ label, icon, onPress }: { label: string; icon?: IconName; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <PressScale
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: palette.muted,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={11} color={palette.mutedForeground} /> : null}
      <T variant="micro" weight="medium" tone="muted">
        {label}
      </T>
    </PressScale>
  );
}
