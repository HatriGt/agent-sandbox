import React, { useCallback, useRef, useState } from "react";
import { Animated, Pressable, type GestureResponderEvent, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";
import { haptic, type HapticKind } from "./haptics";
import { isReducedMotion } from "./reducedMotion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressScaleProps = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  children?: React.ReactNode | ((state: PressableStateCallbackType) => React.ReactNode);
  /** Pressed scale. 0.97 for cards and rows; small icon buttons read better a little deeper. */
  scaleTo?: number;
  /** Haptic fired on press (long-press always fires a medium impact when handled). */
  haptic?: HapticKind;
};

/**
 * Drop-in `Pressable` with the app's press feedback: a fast spring down to 0.97 on touch and back
 * on release, on the native driver. Accepts the same function-style `style`/`children` as
 * Pressable, so swapping a tag is the whole migration.
 */
export function PressScale({ style, children, scaleTo = 0.97, haptic: kind, onPressIn, onPressOut, onPress, onLongPress, ...rest }: PressScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  const springTo = useCallback(
    (v: number) => {
      if (isReducedMotion()) return;
      Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 50, bounciness: v === 1 ? 6 : 0 }).start();
    },
    [scale],
  );
  const state = { pressed, hovered: false } as PressableStateCallbackType;
  const resolved = typeof style === "function" ? style(state) : style;
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        setPressed(true);
        springTo(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false);
        springTo(1);
        onPressOut?.(e);
      }}
      onPress={
        onPress
          ? (e: GestureResponderEvent) => {
              if (kind) haptic(kind);
              onPress(e);
            }
          : undefined
      }
      onLongPress={
        onLongPress
          ? (e: GestureResponderEvent) => {
              haptic("medium");
              onLongPress(e);
            }
          : undefined
      }
      style={[resolved, { transform: [{ scale }] }]}
    >
      {typeof children === "function" ? children(state) : children}
    </AnimatedPressable>
  );
}
