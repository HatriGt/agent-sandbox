import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import type { VoiceState } from "@/hooks/useVoiceInput";

/**
 * The dictation control, native flavor of the web's voice-button: a mic that morphs into a live
 * five-bar equalizer while listening, ringed by an expanding pulse in the --live hue. Haptic tick on
 * start/stop. Reduce-motion collapses the pulse and freezes the bars at a calm mid-height, matching
 * the Motion.tsx convention.
 */
export function VoiceButton({
  state,
  level,
  onToggle,
  size = 34,
}: {
  state: VoiceState;
  level: number;
  onToggle: () => void;
  size?: number;
}) {
  const { palette } = useTheme();
  const listening = state === "listening" || state === "arming";
  const ring = useRef(new Animated.Value(0)).current;
  const reduced = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((r) => (reduced.current = r));
  }, []);

  useEffect(() => {
    if (!listening || reduced.current) {
      ring.stopAnimation();
      ring.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(ring, { toValue: 1, duration: 1500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, ring]);

  const press = () => {
    Haptics.impactAsync(listening ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onToggle();
  };

  return (
    <Pressable onPress={press} hitSlop={8} accessibilityLabel={listening ? "Stop dictating" : "Dictate with your voice"} accessibilityState={{ selected: listening }}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        {listening && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: 1.5,
              borderColor: palette.live,
              opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
              transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
            }}
          />
        )}
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: listening ? palette.accent : "transparent",
            borderWidth: listening ? 1 : 0,
            borderColor: palette.live,
          }}
        >
          {state === "listening" ? (
            <Equalizer level={level} color={palette.live} />
          ) : state === "error" ? (
            <Icon name="mic-off" size={16} color={palette.destructive} />
          ) : (
            <Icon name="mic" size={16} color={state === "arming" ? palette.live : palette.faint} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

/** Five live bars driven by mic level; each spring-tracks its weighted target so motion feels organic. */
function Equalizer({ level, color }: { level: number; color: string }) {
  const weights = [0.45, 0.8, 1, 0.8, 0.45];
  const bars = useRef(weights.map(() => new Animated.Value(3))).current;
  useEffect(() => {
    weights.forEach((w, i) => {
      const target = Math.max(3, Math.min(14, 3 + level * 22 * w));
      Animated.spring(bars[i], { toValue: target, useNativeDriver: false, speed: 40, bounciness: 6 }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, height: 16 }}>
      {bars.map((h, i) => (
        <Animated.View key={i} style={{ width: 2.5, height: h, borderRadius: 2, backgroundColor: color }} />
      ))}
    </View>
  );
}

/** The "Listening" pill with the streaming ghost phrase — shown above the composer while dictating. */
export function VoicePill({ state, interim }: { state: VoiceState; interim: string }) {
  const { palette } = useTheme();
  const show = state === "listening" || state === "arming";
  const fade = useRef(new Animated.Value(0)).current;
  const dot = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: show ? 1 : 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [show, fade]);
  useEffect(() => {
    if (!show) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dot, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0.4, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [show, dot]);
  if (!show) return null;
  return (
    <Animated.View
      style={{
        opacity: fade,
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        backgroundColor: palette.card,
        borderWidth: 1,
        borderColor: palette.live,
        maxWidth: "94%",
      }}
      accessibilityLiveRegion="polite"
    >
      <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.live, opacity: dot }} />
      <T variant="micro" weight="semibold" tone="live">
        {state === "arming" ? "Starting…" : "Listening"}
      </T>
      <T variant="micro" tone={interim ? "muted" : "faint"} numberOfLines={1} style={{ flexShrink: 1, fontStyle: interim ? "italic" : "normal" }}>
        {interim || "speak — words land in the box"}
      </T>
    </Animated.View>
  );
}
