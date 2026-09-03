import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, View, type DimensionValue } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";

/** Breathing placeholder block — the shimmer loading idiom, opacity-only so it
 * runs on the native driver and respects reduce-motion. */
export function Skeleton({ width = "100%", height = 14, round }: { width?: DimensionValue; height?: number; round?: boolean }) {
  const { palette } = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);
  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: round ? height / 2 : radius.md,
        backgroundColor: palette.muted,
        opacity: pulse,
      }}
    />
  );
}

/** A BoxCard-shaped skeleton, for the Hub while the first fleet snapshot loads. */
export function CardSkeleton() {
  const { palette } = useTheme();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: radius.xl,
        backgroundColor: palette.card,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <Skeleton width="55%" height={15} />
        <Skeleton width={64} height={18} round />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Skeleton width={80} height={10} />
        <Skeleton width={110} height={10} />
        <Skeleton width={48} height={10} />
      </View>
    </View>
  );
}
