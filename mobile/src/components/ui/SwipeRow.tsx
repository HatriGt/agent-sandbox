import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, View, type GestureResponderEvent, type PanResponderGestureState } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { haptic, isReducedMotion, PressScale, SPRING } from "@/components/motion";
import { T } from "./AppText";
import { Icon, type IconName } from "./Icon";

export type SwipeAction = {
  label: string;
  icon: IconName;
  tone?: "default" | "destructive";
  onPress: () => void;
  /** Keep the row open after the press — for arm-then-confirm actions. Default: close. */
  stayOpen?: boolean;
};

const ACTION_W = 76;
/** Past the fully-open point the row still follows the finger, but at a third of the speed. */
const OVERSHOOT_FRICTION = 0.3;
const CLAIM_DX = 8;

/** The one open row app-wide: opening another closes it, as in Mail. */
let openRow: (() => void) | null = null;

/**
 * Swipe-left to reveal up to two actions behind a row. Follows the finger, snaps open or closed on
 * release (SPRING.snap), a selection tick as it crosses the open threshold, and tapping the row
 * while open closes it. Reduce-motion: the row doesn't track the drag; a swipe jumps straight to
 * open/closed. The actions are also exposed as accessibility actions for screen readers.
 */
export function SwipeRow({
  actions,
  children,
  borderRadius = radius.xl,
}: {
  actions: SwipeAction[];
  children: React.ReactNode;
  borderRadius?: number;
}) {
  const { palette } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const crossed = useRef(false);
  const width = ACTION_W * Math.min(actions.length, 2);

  const settle = useCallback(
    (to: boolean) => {
      openRef.current = to;
      setOpen(to);
      const toValue = to ? -width : 0;
      if (isReducedMotion()) x.setValue(toValue);
      else Animated.spring(x, { toValue, useNativeDriver: true, ...SPRING.snap }).start();
    },
    [x, width],
  );
  const close = useCallback(() => settle(false), [settle]);

  useEffect(
    () => () => {
      if (openRow === close) openRow = null;
    },
    [close],
  );

  const openThis = useCallback(() => {
    if (openRow && openRow !== close) openRow();
    openRow = close;
    settle(true);
  }, [close, settle]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e: GestureResponderEvent, g: PanResponderGestureState) =>
          Math.abs(g.dx) > CLAIM_DX && Math.abs(g.dx) > Math.abs(g.dy) * 1.5 && (g.dx < 0 || openRef.current),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          crossed.current = false;
          if (openRow && openRow !== close) openRow();
        },
        onPanResponderMove: (_e, g) => {
          const from = openRef.current ? -width : 0;
          let next = from + g.dx;
          if (next > 0) next = 0;
          else if (next < -width) next = -width + (next + width) * OVERSHOOT_FRICTION;
          const past = next < -width / 2;
          if (past !== crossed.current) {
            crossed.current = past;
            haptic("selection");
          }
          if (!isReducedMotion()) x.setValue(next);
        },
        onPanResponderRelease: (_e, g) => {
          const from = openRef.current ? -width : 0;
          const at = from + g.dx;
          const shouldOpen = g.vx < -0.4 ? true : g.vx > 0.4 ? false : at < -width / 2;
          if (shouldOpen) openThis();
          else close();
        },
        onPanResponderTerminate: () => settle(openRef.current),
      }),
    [x, width, close, openThis, settle],
  );

  if (actions.length === 0) return <>{children}</>;

  return (
    <View
      style={{ borderRadius, overflow: "hidden" }}
      accessibilityActions={actions.map((a) => ({ name: a.label, label: a.label }))}
      onAccessibilityAction={(e) => actions.find((a) => a.label === e.nativeEvent.actionName)?.onPress()}
    >
      <View style={{ position: "absolute", top: 0, bottom: 0, right: 0, flexDirection: "row" }} pointerEvents={open ? "auto" : "none"}>
        {actions.slice(0, 2).map((a) => {
          const destructive = a.tone === "destructive";
          const bg = destructive ? palette.destructive : palette.secondary;
          const fg = destructive ? palette.destructiveForeground : palette.foreground;
          return (
            <PressScale
              key={a.label}
              scaleTo={0.95}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              onPress={() => {
                if (!a.stayOpen) close();
                a.onPress();
              }}
              style={{ width: ACTION_W, backgroundColor: bg, alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <Icon name={a.icon} size={18} color={fg} />
              <T variant="micro" weight="semibold" numberOfLines={1} style={{ color: fg }}>
                {a.label}
              </T>
            </PressScale>
          );
        })}
      </View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }] }}>
        {children}
        {open ? <Pressable accessibilityLabel="Close actions" onPress={close} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }} /> : null}
      </Animated.View>
    </View>
  );
}
