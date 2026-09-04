import React from "react";
import { Animated, Easing, View, type ViewStyle } from "react-native";
import { fmtMib, usageFraction, usageLevel, type Usage } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./AppText";
import { Icon } from "./Icon";

/**
 * A used/total meter — one ratio against a hard limit, so a Meter, not a chart. The fill carries the
 * severity (live → amber → destructive) and the track is a recessive step of the same ink. The number
 * is ALWAYS shown: the amber fill is a low-contrast mark, which is fine for a bar but obliges a
 * visible value beside it. Mirrors web/src/components/ui/usage-meter.tsx.
 *
 * Width animates rather than jumping, because the fleet poll lands every few seconds and a snapping
 * bar reads as a glitch. RN `Animated` only — this app has no reanimated.
 */
export function UsageMeter({
  kind,
  usage,
  trackWidth = 44,
  style,
}: {
  kind: "memory" | "disk";
  usage: Usage | undefined;
  trackWidth?: number;
  style?: ViewStyle;
}) {
  const { palette } = useTheme();
  const f = usageFraction(usage);
  const level = usageLevel(usage);
  // Keep the animated value alive across renders even when the meter has nothing to show, so the
  // hooks order never changes; the early return below happens after it is declared.
  const grow = React.useRef(new Animated.Value(f ?? 0)).current;
  React.useEffect(() => {
    if (f == null) return;
    Animated.timing(grow, { toValue: f, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [f, grow]);

  if (f == null || !usage) return null;
  const fill = level === "critical" ? palette.destructive : level === "high" ? palette.attention : palette.live;
  const textTone = level === "critical" ? "destructive" : level === "high" ? "attention" : "muted";
  const pct = Math.round(f * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${kind === "memory" ? "Memory" : "Disk"} ${pct}% used, ${fmtMib(usage.usedMib)} of ${fmtMib(usage.totalMib)}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 5, ...style }}
    >
      <Icon name={kind === "memory" ? "cpu" : "hard-drive"} size={11} color={palette.faint} />
      <View style={{ width: trackWidth, height: 4, borderRadius: radius.pill, backgroundColor: palette.accent, overflow: "hidden" }}>
        <Animated.View
          style={{
            height: 4,
            borderRadius: radius.pill,
            backgroundColor: fill,
            // A 0%-wide bar looks broken; floor it at a hairline so the mark is always present.
            width: grow.interpolate({ inputRange: [0, 1], outputRange: ["2%", "100%"] }),
          }}
        />
      </View>
      <T variant="micro" tone={textTone} mono>
        {`${fmtMib(usage.usedMib)}/${fmtMib(usage.totalMib)}`}
      </T>
    </View>
  );
}
