import React, { useEffect, useRef } from "react";
import { Animated, Easing, LayoutAnimation, type StyleProp, type ViewStyle } from "react-native";
import { isReducedMotion } from "./reducedMotion";

/** Motion timing vocabulary — everything lands inside 150–300ms with an ease-out tail. */
export const DUR = { fast: 160, base: 220, slow: 280 } as const;
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

/** Per-item delay for a staggered list: quick early cascade, capped so a long list never lags. */
export function stagger(index: number, step = 40, cap = 8): number {
  return Math.min(index, cap) * step;
}

/** Fade + rise entrance for list rows, chat items and cards. Native driver; reduce-motion: instant. */
export function FadeInUp({
  children,
  delay = 0,
  distance = 10,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = isReducedMotion();
  const t = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    const a = Animated.timing(t, { toValue: 1, duration: DUR.slow, delay, easing: EASE_OUT, useNativeDriver: true });
    a.start();
    return () => a.stop();
    // Mount-only: an entrance plays once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      style={[
        { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Opacity-only cross-fade in, keyed by the caller — used when a segmented control swaps content. */
export function FadeIn({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = isReducedMotion();
  const t = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.timing(t, { toValue: 1, duration: DUR.fast, easing: EASE_OUT, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Animated.View style={[{ opacity: t }, style]}>{children}</Animated.View>;
}

// app.json sets newArchEnabled: Fabric runs LayoutAnimation on both platforms with no opt-in.

const EXPAND = LayoutAnimation.create(DUR.base, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity);

/**
 * Call right before a state change that expands/collapses a card: the next layout pass animates
 * (siblings glide, the new content fades in) on the native side. Reduce-motion: a plain jump.
 */
export function animateLayout(): void {
  if (isReducedMotion()) return;
  LayoutAnimation.configureNext(EXPAND);
}
