import React, { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { DUR, EASE_OUT, isReducedMotion } from "@/components/motion";
import { Icon } from "./Icon";

/**
 * Disclosure chevron that turns from "right" to "down" as its section opens, instead of swapping
 * glyphs (HistoryList's pattern, shared). Native driver; reduce-motion: a plain jump.
 */
export function Chevron({ open, size = 14, color, from = "right" }: { open: boolean; size?: number; color?: string; from?: "right" | "down" }) {
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    if (isReducedMotion()) {
      turn.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: DUR.fast, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [open, turn]);
  // "down" starts pointing down and flips up when open (what the agent sees / collapsible footers).
  const deg = from === "right" ? "90deg" : "180deg";
  return (
    <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", deg] }) }] }}>
      <Icon name={from === "right" ? "chevron-right" : "chevron-down"} size={size} color={color} />
    </Animated.View>
  );
}
