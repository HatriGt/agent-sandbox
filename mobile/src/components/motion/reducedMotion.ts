import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * One app-wide reduce-motion flag, resolved from the in-app preference (Account → Appearance,
 * mirrors web/src/lib/motion-pref.ts) and the OS setting: "system" follows the OS, "full" /
 * "reduced" override it. Read once at module load and kept current by the OS change event, so
 * every primitive answers synchronously instead of each one awaiting `isReduceMotionEnabled()`
 * and starting a frame late.
 */
export type MotionPref = "full" | "system" | "reduced";

const KEY = "asb-motion";
const isPref = (v: unknown): v is MotionPref => v === "full" || v === "system" || v === "reduced";

let os = false;
let pref: MotionPref = "system";
let reduced = false;
const listeners = new Set<() => void>();

AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => {
    os = v;
    apply();
  })
  .catch(() => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
  os = v;
  apply();
});
AsyncStorage.getItem(KEY)
  .then((v) => {
    if (isPref(v)) {
      pref = v;
      apply();
    }
  })
  .catch(() => {});

function apply() {
  const next = pref === "system" ? os : pref === "reduced";
  if (next === reduced) return;
  reduced = next;
  listeners.forEach((l) => l());
}

/** Current resolved value, for imperative callers (haptic-free animations, LayoutAnimation). */
export function isReducedMotion(): boolean {
  return reduced;
}

export function getMotionPref(): MotionPref {
  return pref;
}

/** True when the OS itself asks for reduced motion — what "System" would resolve to. */
export function isOsReducedMotion(): boolean {
  return os;
}

export function setMotionPref(p: MotionPref) {
  pref = p;
  (p === "system" ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, p)).catch(() => {});
  // Notify even when the resolved flag is unchanged so pref subscribers re-render.
  const before = reduced;
  apply();
  if (before === reduced) listeners.forEach((l) => l());
}

function useStore<V>(read: () => V): V {
  const [v, setV] = useState(read);
  useEffect(() => {
    const l = () => setV(read());
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, [read]);
  return v;
}

export function useReducedMotion(): boolean {
  return useStore(isReducedMotion);
}

export function useMotionPref(): MotionPref {
  return useStore(getMotionPref);
}
