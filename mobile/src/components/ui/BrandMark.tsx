import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

/**
 * The app mark drawn live in views (matches assets/icon.png): a rounded
 * "sandbox" frame with a gap at the top-right corner, a glowing agent orb
 * inside, and a spark sitting in the gap. `animate` adds the idle life —
 * the orb breathes and the spark pulses. Everything native-driver.
 */
export function BrandMark({ size = 96, animate = false }: { size?: number; animate?: boolean }) {
  const { palette, dark } = useTheme();
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breath, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breath, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [animate, breath]);

  const u = size / 96; // design units
  const frame = dark ? "#e8e8ea" : palette.foreground;
  const stroke = Math.max(3, 5.5 * u);
  const boxSize = 62 * u;
  const orb = 20 * u;
  const spark = 8 * u;
  const gap = 18 * u; // top-right corner opening

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* frame: full rounded square, with a background-colored notch masking the corner */}
      <View
        style={{
          width: boxSize,
          height: boxSize,
          borderRadius: 16 * u,
          borderWidth: stroke,
          borderColor: frame,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Animated.View
          style={{
            width: orb,
            height: orb,
            borderRadius: orb / 2,
            backgroundColor: palette.live,
            transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }],
            shadowColor: palette.live,
            shadowOpacity: 0.9,
            shadowRadius: 10 * u,
            shadowOffset: { width: 0, height: 0 },
            elevation: 8,
          }}
        >
          <View
            style={{
              position: "absolute",
              top: orb * 0.18,
              left: orb * 0.2,
              width: orb * 0.3,
              height: orb * 0.3,
              borderRadius: orb * 0.15,
              backgroundColor: "#ffffff",
              opacity: 0.55,
            }}
          />
        </Animated.View>
      </View>
      {/* notch that opens the top-right corner */}
      <View
        style={{
          position: "absolute",
          top: (96 - boxSize / u) / 2 * u - stroke,
          right: (96 - boxSize / u) / 2 * u - stroke,
          width: gap,
          height: gap,
          backgroundColor: palette.background,
        }}
      />
      {/* the spark in the gap */}
      <Animated.View
        style={{
          position: "absolute",
          top: 14 * u,
          right: 14 * u,
          width: spark,
          height: spark,
          borderRadius: spark / 2,
          backgroundColor: palette.live,
          opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
          transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }],
        }}
      />
    </View>
  );
}
