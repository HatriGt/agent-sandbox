import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

// Same staged copy as the web's WakingCard, advanced purely by elapsed time.
const STAGES = [
  { at: 0, text: "Starting the microVM" },
  { at: 4, text: "Restoring the workspace and the agent's session" },
  { at: 9, text: "Reconnecting the transcript" },
];
const STUCK_AT = 45;

/** Pulsing halo around a power glyph — the waking heartbeat. */
function PowerPulse({ color, done }: { color: string; done: boolean }) {
  const halo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (done) return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.timing(halo, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [halo, done]);

  return (
    <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      {!done && (
        <Animated.View
          style={{
            position: "absolute",
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 1.5,
            borderColor: color,
            opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
            transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.25] }) }],
          }}
        />
      )}
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: `${color}22`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={done ? "check" : "power"} size={15} color={color} />
      </View>
    </View>
  );
}

/** Waking progress: staged copy, 3-segment rail, retry once it looks stuck. */
export function WakingCard({
  sleeping,
  startedAt,
  onRetry,
}: {
  sleeping: boolean;
  startedAt: number;
  onRetry?: () => void;
}) {
  const { palette } = useTheme();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const stageIdx = sleeping ? STAGES.reduce((a, s, i) => (elapsed >= s.at ? i : a), 0) : STAGES.length - 1;
  const stuck = sleeping && elapsed >= STUCK_AT;
  const color = stuck ? palette.attentionText : sleeping ? palette.sleep : palette.ok;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: sleeping ? (stuck ? palette.attention : palette.sleep) : palette.ok,
        borderRadius: radius.xl,
        padding: 14,
        marginBottom: 12,
        gap: 10,
        backgroundColor: palette.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <PowerPulse color={color} done={!sleeping} />
        <View style={{ flex: 1 }}>
          <T variant="body" weight="semibold" style={{ color }}>
            {!sleeping ? "Awake" : stuck ? "Taking longer than usual" : "Waking the sandbox"}
          </T>
          <T variant="meta" tone="muted">
            {!sleeping
              ? "Back. The transcript follows."
              : stuck
                ? "The machine hasn't reported back yet."
                : STAGES[stageIdx].text}
          </T>
        </View>
        {sleeping && (
          <T variant="micro" mono tone="faint">
            {elapsed}s
          </T>
        )}
      </View>
      {/* 3-segment progress rail; the active segment breathes via the halo above. */}
      <View style={{ flexDirection: "row", gap: 4 }}>
        {STAGES.map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor: !sleeping || i < stageIdx ? color : i === stageIdx ? `${color}88` : palette.muted,
            }}
          />
        ))}
      </View>
      {stuck && onRetry && <Button title="Try waking again" small variant="secondary" onPress={onRetry} />}
    </View>
  );
}
