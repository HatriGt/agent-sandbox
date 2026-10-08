import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, LayoutAnimation, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { isReducedMotion } from "./reducedMotion";

/** Motion timing vocabulary — everything lands inside 150–300ms with an ease-out tail. */
export const DUR = { fast: 160, base: 220, slow: 280 } as const;
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
/** iOS-like drawer curve: fast start, long settle. For sheets and anything the finger just released. */
export const EASE_DRAWER = Easing.bezier(0.32, 0.72, 0, 1);

/**
 * Spring vocabulary (RN `speed`/`bounciness`). One set so every press, snap-back and sheet shares
 * the same personality: crisp, barely any overshoot.
 *   press   - finger down/up on a control
 *   snap    - a dragged thing returning home
 *   sheet   - a sheet or card arriving on screen
 */
export const SPRING = {
  press: { speed: 50, bounciness: 0 },
  release: { speed: 50, bounciness: 4 },
  snap: { speed: 24, bounciness: 4 },
  sheet: { speed: 18, bounciness: 3 },
} as const;

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

/**
 * Cross-fade between versions of a small piece of content keyed by `id` (a state word, a count):
 * the old content fades out, the new fades in, instead of snapping. The outgoing content is kept
 * for one fade so the swap is readable; sized by the incoming content, so it works inline.
 */
export function CrossFade({ id, children, style }: { id: string | number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(1)).current;
  // Last rendered (id, node) so a key change can snapshot the outgoing content.
  const last = useRef<{ id: string | number; node: React.ReactNode }>({ id, node: children });
  const [prev, setPrev] = useState<React.ReactNode>(null);
  useEffect(() => {
    const was = last.current;
    last.current = { id, node: children };
    if (id === was.id || isReducedMotion()) return;
    setPrev(was.node);
    t.setValue(0);
    const a = Animated.timing(t, { toValue: 1, duration: DUR.base, easing: EASE_OUT, useNativeDriver: true });
    a.start(({ finished }) => finished && setPrev(null));
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, children]);
  return (
    <View style={style}>
      {prev ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
          {prev}
        </Animated.View>
      ) : null}
      <Animated.View style={{ opacity: t }}>{children}</Animated.View>
    </View>
  );
}

/**
 * Mount/unmount presence with a spring: the child scales and fades in when `visible` flips true
 * and springs back out before leaving the tree. For floating pills and buttons that appear
 * mid-interaction (jump-to-latest, stop). Reduce-motion: a plain show/hide.
 */
export function ScalePresence({ visible, children, style, from = 0.8 }: { visible: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>; from?: number }) {
  const reduced = isReducedMotion();
  const t = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      t.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    const a = Animated.spring(t, { toValue: visible ? 1 : 0, useNativeDriver: true, ...(visible ? SPRING.snap : SPRING.press) });
    a.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[{ opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }] }, style]}
    >
      {children}
    </Animated.View>
  );
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
