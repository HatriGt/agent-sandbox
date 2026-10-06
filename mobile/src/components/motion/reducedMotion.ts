import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * One app-wide reduce-motion flag. Read once at module load and kept current by the OS change
 * event, so every primitive answers synchronously instead of each one awaiting
 * `isReduceMotionEnabled()` and starting a frame late.
 */
let reduced = false;
const listeners = new Set<(v: boolean) => void>();

AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => set(v))
  .catch(() => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => set(v));

function set(v: boolean) {
  if (v === reduced) return;
  reduced = v;
  listeners.forEach((l) => l(v));
}

/** Current value, for imperative callers (haptic-free animations, LayoutAnimation). */
export function isReducedMotion(): boolean {
  return reduced;
}

export function useReducedMotion(): boolean {
  const [v, setV] = useState(reduced);
  useEffect(() => {
    listeners.add(setV);
    setV(reduced);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}
