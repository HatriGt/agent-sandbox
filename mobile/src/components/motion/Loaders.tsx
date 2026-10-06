import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "@/theme/ThemeContext";
import { radius as radii } from "@/theme/tokens";
import { DUR, EASE_OUT } from "./Enter";
import { useReducedMotion } from "./reducedMotion";

/**
 * One looping 0→1 clock on the native driver; stops under reduce-motion (the value parks at `rest`).
 * Every looping primitive below derives all of its parts from a single clock via interpolate, so a
 * nine-dot loader costs one animation, not nine.
 */
function useLoop(duration: number, rest = 0.5, easing: (v: number) => number = Easing.linear): Animated.Value {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(rest)).current;
  useEffect(() => {
    if (reduced) {
      t.setValue(rest);
      return;
    }
    t.setValue(0);
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration, easing, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced, duration, rest, easing, t]);
  return t;
}

const WAVE_STEPS = Array.from({ length: 13 }, (_, i) => i / 12);

/** Smooth cosine pulse over one loop of `t`, peaking at `phase` (0..1); seamless at the wrap. */
function wave(t: Animated.Value, phase: number, lo: number, hi: number) {
  return t.interpolate({
    inputRange: WAVE_STEPS,
    outputRange: WAVE_STEPS.map((x) => lo + (hi - lo) * (0.5 + 0.5 * Math.cos(2 * Math.PI * (x - phase)))),
  });
}

/** The breathing dot — liveness for a running state pill. */
export function WorkingDot({ color, size = 8 }: { color: string; size?: number }) {
  const t = useLoop(1800, 0.5);
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: wave(t, 0.5, 0.4, 1) }} />;
}

/** Three staggered dots — compact "working" for inline rows. */
export function TypingDots({ color, size = 6 }: { color: string; size?: number }) {
  const t = useLoop(1100, 0.5);
  return (
    <View style={{ flexDirection: "row", gap: size * 0.7, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: wave(t, i / 6, 0.3, 1),
            transform: [{ translateY: wave(t, i / 6, 0, -size * 0.35) }],
          }}
        />
      ))}
    </View>
  );
}

/**
 * The generative "agent is working" glyph: a 3×3 field of dots with a diagonal wave travelling
 * through it, each dot swelling and brightening as the crest passes — reads as thought, not a
 * spinner. One native-driver clock drives all nine dots.
 */
export function AgentLoader({ color, size = 18 }: { color: string; size?: number }) {
  const t = useLoop(1400, 0.5);
  const dot = size / 5;
  const gap = (size - dot * 3) / 2;
  return (
    <View accessibilityLabel="Working" style={{ width: size, height: size, flexDirection: "row", flexWrap: "wrap", gap }}>
      {Array.from({ length: 9 }, (_, i) => {
        const phase = ((i % 3) + Math.floor(i / 3)) / 6;
        return (
          <Animated.View
            key={i}
            style={{
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: color,
              opacity: wave(t, phase, 0.22, 1),
              transform: [{ scale: wave(t, phase, 0.7, 1.15) }],
            }}
          />
        );
      })}
    </View>
  );
}

/** Placeholder block with a travelling sheen. The band slides on the native driver; reduce-motion: static block. */
export function Skeleton({ width = "100%", height = 14, round, style }: { width?: DimensionValue; height?: number; round?: boolean; style?: StyleProp<ViewStyle> }) {
  const { palette, dark } = useTheme();
  const t = useLoop(1300, 0, Easing.inOut(Easing.ease));
  const reduced = useReducedMotion();
  const [w, setW] = useState(0);
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ width, height, borderRadius: round ? height / 2 : radii.md, backgroundColor: palette.muted, overflow: "hidden" }, style]}
    >
      {w > 0 && !reduced ? (
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: Math.max(60, w * 0.6),
            transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-Math.max(60, w * 0.6), w] }) }],
          }}
        >
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={dark ? "#ffffff" : "#ffffff"} stopOpacity="0" />
                <Stop offset="0.5" stopColor="#ffffff" stopOpacity={dark ? "0.07" : "0.6"} />
                <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#sheen)" />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A BoxCard-shaped skeleton for lists awaiting their first snapshot. */
export function CardSkeleton() {
  const { palette } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radii.xl, backgroundColor: palette.card, padding: 14, gap: 10 }}>
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

/**
 * Running-state border: a soft light sweeping round the card's edge. A rotating gradient square
 * sits behind the child, clipped to a `ring`-wide frame — the child's own opaque background
 * covers the middle, so only the rim glows. Rotation is native-driver; reduce-motion: a still tint.
 */
export function LiveBorder({
  active,
  color,
  borderRadius,
  ring = 1.5,
  children,
}: {
  active: boolean;
  color: string;
  borderRadius: number;
  ring?: number;
  children: React.ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const t = useLoop(3200, 0);
  const reduced = useReducedMotion();
  if (!active) return <>{children}</>;
  const d = Math.ceil(Math.hypot(size.w, size.h));
  return (
    <View
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{ borderRadius: borderRadius + ring, padding: ring, overflow: "hidden", backgroundColor: `${color}2e` }}
    >
      {d > 0 && !reduced ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: d,
            height: d,
            left: (size.w - d) / 2,
            top: (size.h - d) / 2,
            transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
          }}
        >
          <Svg width={d} height={d}>
            <Defs>
              <LinearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0.3" stopColor={color} stopOpacity="0" />
                <Stop offset="0.5" stopColor={color} stopOpacity="1" />
                <Stop offset="0.7" stopColor={color} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect width={d} height={d / 2} fill="url(#sweep)" />
          </Svg>
        </Animated.View>
      ) : null}
      {children}
    </View>
  );
}

/**
 * Number that counts to its new value (ease-out, ~300ms) instead of snapping — stats and
 * fractions. Text can't run on the native driver, so the tween is a short rAF loop that only lives
 * while a change is in flight. Non-numeric values render as-is.
 */
export function CountUp({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const began = Date.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (Date.now() - began) / DUR.slow);
      const v = start + (value - start) * EASE_OUT(k);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <>{format(shown)}</>;
}

/**
 * Animated fraction bar. Scales a full-width fill on X from the left edge (native driver) rather
 * than animating `width`, which would run every frame on the JS thread.
 */
export function ProgressFill({ fraction, color, height = 2, floor = 0 }: { fraction: number; color: string; height?: number; floor?: number }) {
  const f = Math.max(floor, Math.min(1, fraction));
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(f)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(f);
      return;
    }
    Animated.timing(v, { toValue: f, duration: DUR.slow + 120, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [f, reduced, v]);
  return (
    <Animated.View
      style={{
        height,
        width: "100%",
        borderRadius: height / 2,
        backgroundColor: color,
        transformOrigin: "left",
        transform: [{ scaleX: v }],
      }}
    />
  );
}
