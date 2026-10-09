import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { useTheme } from "@/theme/ThemeContext";
import { useReducedMotion } from "@/components/motion";

/**
 * The voice-mode sphere: a radial-gradient disc (live → primary, darker rim), a soft concentric glow
 * and three slow-drifting blobs that keep the surface alive. Everything animated is a transform or
 * opacity on the native driver; the SVG gradients themselves are static. Mic `level` (0..1) is
 * spring-tracked here and drives orb scale, glow scale/opacity and drift amplitude; silence falls
 * back to a 2.4s breath. Paused dims the orb and freezes the drift; reduce-motion keeps only a
 * subtle level-driven scale.
 */
const PERIODS = [3400, 4700, 5900] as const;
const BLOBS = [
  { x: -0.22, y: -0.18, r: 0.42, id: "a" },
  { x: 0.26, y: 0.12, r: 0.38, id: "b" },
  { x: -0.06, y: 0.3, r: 0.34, id: "c" },
] as const;

export function VoiceOrb({ level, paused, size = 220 }: { level: number; paused: boolean; size?: number }) {
  const { palette } = useTheme();
  const reduced = useReducedMotion();
  const lvl = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const drift = useRef(PERIODS.map(() => new Animated.Value(0))).current;
  const dim = useRef(new Animated.Value(1)).current;

  // Spring-track the raw level so bursts land soft and silence decays instead of snapping.
  useEffect(() => {
    Animated.spring(lvl, { toValue: paused ? 0 : level, speed: 20, bounciness: 2, useNativeDriver: true }).start();
  }, [level, paused, lvl]);

  useEffect(() => {
    Animated.timing(dim, { toValue: paused ? 0.55 : 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [paused, dim]);

  // Breathing + blob drift loops. Stopped (and settled home) while paused or under reduce-motion.
  useEffect(() => {
    if (paused || reduced) {
      breath.stopAnimation();
      Animated.timing(breath, { toValue: 0, duration: 220, useNativeDriver: true }).start();
      drift.forEach((d) => d.stopAnimation());
      return;
    }
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const loops = drift.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(d, { toValue: 1, duration: PERIODS[i] / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: PERIODS[i] / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    );
    b.start();
    loops.forEach((l) => l.start());
    return () => {
      b.stop();
      loops.forEach((l) => l.stop());
    };
  }, [paused, reduced, breath, drift]);

  const orbScale = reduced
    ? lvl.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] })
    : Animated.add(lvl.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }), breath.interpolate({ inputRange: [0, 1], outputRange: [0, 0.03] }));
  const glowScale = lvl.interpolate({ inputRange: [0, 1], outputRange: [1, reduced ? 1.08 : 1.35] });
  const glowOpacity = lvl.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });
  // Drift amplitude grows with level: quiet = a few px of sway, loud = the blobs roam.
  const amp = lvl.interpolate({ inputRange: [0, 1], outputRange: [size * 0.03, size * 0.1] });

  const box = size * 1.6;
  const c = box / 2;
  const r = size / 2;

  return (
    <View style={{ width: box, height: box, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
      {/* Glow: concentric rings scaled and brightened by level. */}
      <Animated.View style={{ position: "absolute", width: box, height: box, opacity: Animated.multiply(glowOpacity, dim), transform: [{ scale: glowScale }] }}>
        <Svg width={box} height={box}>
          <Circle cx={c} cy={c} r={r * 1.45} fill={palette.live} opacity={0.06} />
          <Circle cx={c} cy={c} r={r * 1.25} fill={palette.live} opacity={0.1} />
          <Circle cx={c} cy={c} r={r * 1.1} fill={palette.live} opacity={0.14} />
        </Svg>
      </Animated.View>
      {/* Sphere + blobs, clipped to the disc by a matching rounded container. */}
      <Animated.View style={{ width: size, height: size, borderRadius: r, overflow: "hidden", opacity: dim, transform: [{ scale: orbScale }] }}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="orb" cx="38%" cy="32%" rx="70%" ry="70%" fx="38%" fy="32%">
              <Stop offset="0%" stopColor={palette.live} stopOpacity={1} />
              <Stop offset="55%" stopColor={palette.primary} stopOpacity={0.92} />
              <Stop offset="100%" stopColor={palette.foreground} stopOpacity={0.9} />
            </RadialGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r} fill="url(#orb)" />
        </Svg>
        {BLOBS.map((b, i) => {
          const d = r * b.r;
          const dx = drift[i].interpolate({ inputRange: [0, 1], outputRange: [-1, 1] });
          const dy = drift[(i + 1) % 3].interpolate({ inputRange: [0, 1], outputRange: [1, -1] });
          return (
            <Animated.View
              key={b.id}
              style={{
                position: "absolute",
                left: r + b.x * size - d,
                top: r + b.y * size - d,
                width: d * 2,
                height: d * 2,
                transform: [{ translateX: Animated.multiply(dx, amp) }, { translateY: Animated.multiply(dy, amp) }],
              }}
            >
              <Svg width={d * 2} height={d * 2}>
                <Defs>
                  <RadialGradient id={`blob-${b.id}`} cx="50%" cy="50%" rx="50%" ry="50%">
                    <Stop offset="0%" stopColor={b.id === "b" ? palette.accent : palette.live} stopOpacity={0.75} />
                    <Stop offset="60%" stopColor={b.id === "b" ? palette.accent : palette.live} stopOpacity={0.25} />
                    <Stop offset="100%" stopColor={palette.live} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx={d} cy={d} r={d} fill={`url(#blob-${b.id})`} />
              </Svg>
            </Animated.View>
          );
        })}
        {/* Darker rim for depth. */}
        <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderRadius: r, borderWidth: 2, borderColor: palette.foreground, opacity: 0.18 }} />
      </Animated.View>
    </View>
  );
}
