import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "./ui/AppText";

/**
 * In-app splash that takes over the instant the native splash hides, so the
 * static logo comes alive instead of hard-cutting to the UI:
 *   1. the mark scales up with a spring while a halo ring expands behind it
 *   2. the orb inside pops in and the spark shoots to the corner gap
 *   3. the wordmark fades up
 *   4. the whole layer scales past 1 and fades, revealing the app underneath
 * Runs once per cold start (~1.1s), skipped entirely under reduce-motion.
 */
export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const { palette, dark } = useTheme();
  const [gone, setGone] = useState(false);

  const mark = useRef(new Animated.Value(0)).current; // frame scale/opacity
  const orb = useRef(new Animated.Value(0)).current; // orb pop
  const sparkT = useRef(new Animated.Value(0)).current; // spark travel to gap
  const ring = useRef(new Animated.Value(0)).current; // halo ring
  const word = useRef(new Animated.Value(0)).current; // wordmark
  const out = useRef(new Animated.Value(0)).current; // exit fade/zoom

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      setGone(true);
      onDone();
    };
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        finish();
        return;
      }
      Animated.sequence([
        Animated.parallel([
          Animated.spring(mark, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 9 }),
          Animated.timing(ring, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.spring(orb, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 14 }),
          Animated.timing(sparkT, { toValue: 1, duration: 420, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
          Animated.timing(word, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
        Animated.delay(260),
        Animated.timing(out, { toValue: 1, duration: 340, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(finish);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;

  const S = 108; // mark box
  const stroke = 6;
  const frame = dark ? "#e8e8ea" : palette.foreground;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: palette.background,
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          opacity: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
        },
      ]}
    >
      {/* expanding halo ring */}
      <Animated.View
        style={{
          position: "absolute",
          width: 220,
          height: 220,
          borderRadius: 110,
          borderWidth: 1.5,
          borderColor: palette.live,
          opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.25] }) }],
        }}
      />
      <View style={{ width: S + 24, height: S + 24, alignItems: "center", justifyContent: "center" }}>
        {/* frame */}
        <Animated.View
          style={{
            width: S,
            height: S,
            borderRadius: 26,
            borderWidth: stroke,
            borderColor: frame,
            alignItems: "center",
            justifyContent: "center",
            opacity: mark,
            transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }}
        >
          {/* orb */}
          <Animated.View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: palette.live,
              opacity: orb,
              transform: [{ scale: orb }],
              shadowColor: palette.live,
              shadowOpacity: 0.9,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 0 },
              elevation: 10,
            }}
          >
            <View style={{ position: "absolute", top: 6, left: 7, width: 10, height: 10, borderRadius: 5, backgroundColor: "#fff", opacity: 0.55 }} />
          </Animated.View>
        </Animated.View>
        {/* corner notch opening the frame */}
        <Animated.View
          style={{
            position: "absolute",
            top: 12 - stroke,
            right: 12 - stroke,
            width: 30,
            height: 30,
            backgroundColor: palette.background,
            opacity: mark,
          }}
        />
        {/* spark: travels from the orb out to the gap */}
        <Animated.View
          style={{
            position: "absolute",
            top: 18,
            right: 18,
            width: 13,
            height: 13,
            borderRadius: 7,
            backgroundColor: palette.live,
            opacity: sparkT,
            transform: [
              { translateX: sparkT.interpolate({ inputRange: [0, 1], outputRange: [-(S / 2) + 12, 0] }) },
              { translateY: sparkT.interpolate({ inputRange: [0, 1], outputRange: [S / 2 - 12, 0] }) },
              { scale: sparkT.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
            ],
          }}
        />
      </View>
      <Animated.View
        style={{
          marginTop: 22,
          opacity: word,
          transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        }}
      >
        <T serif variant="h2" style={{ letterSpacing: 0.3 }}>
          Agent Sandbox
        </T>
      </Animated.View>
    </Animated.View>
  );
}
