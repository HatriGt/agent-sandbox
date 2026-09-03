import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable } from "react-native";

/** Fade + rise entrance for list/chat items — the liveness idea, one motion vocabulary. */
export function FadeInUp({
  children,
  delay = 0,
  distance = 10,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: object;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(distance)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        opacity.setValue(1);
        translate.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 260, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translate, { toValue: 0, duration: 260, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, [opacity, translate, delay]);

  return <Animated.View style={[{ opacity, transform: [{ translateY: translate }] }, style]}>{children}</Animated.View>;
}

/** Three staggered breathing dots — "the agent is working" typing indicator. */
export function TypingDots({ color, size = 6 }: { color: string; size?: number }) {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];

  useEffect(() => {
    let loops: Animated.CompositeAnimation[] = [];
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        dots.forEach((d) => d.setValue(0.7));
        return;
      }
      loops = dots.map((d, i) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(i * 160),
            Animated.timing(d, { toValue: 1, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(d, { toValue: 0.3, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.delay((2 - i) * 160),
          ]),
        ),
      );
      loops.forEach((l) => l.start());
    });
    return () => {
      cancelled = true;
      loops.forEach((l) => l.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={{ flexDirection: "row", gap: size * 0.7, alignItems: "center" }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: d }} />
      ))}
    </Animated.View>
  );
}

/** Springy press-scale wrapper for tappables (cards, chips, buttons). */
export function Pressably({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: object;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 5 }).start();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}
