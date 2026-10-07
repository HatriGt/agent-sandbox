import * as React from "react";

/**
 * In-app motion preference. "system" follows the OS reduced-motion setting; "full" / "reduced" override
 * it. The resolved value lands on `<html data-motion="full|reduced">`, which the CSS and the Tailwind
 * `motion-reduce:` / `motion-safe:` variants key off. This is the only place that reads the media query.
 */
export type MotionPref = "full" | "system" | "reduced";

const KEY = "asb.motion";
const QUERY = "(prefers-reduced-motion: reduce)";
const listeners = new Set<() => void>();
let mq: MediaQueryList | null = null;

const isPref = (v: unknown): v is MotionPref => v === "full" || v === "system" || v === "reduced";

export function getMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY);
    return isPref(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function resolvedReduced(): boolean {
  const p = getMotionPref();
  if (p !== "system") return p === "reduced";
  return typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches;
}

function onSystemChange() {
  apply();
}

/** Writes `data-motion`, (un)subscribes the media query, and notifies hook subscribers. */
function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.motion = resolvedReduced() ? "reduced" : "full";
  const wantQuery = getMotionPref() === "system" && typeof window !== "undefined" && !!window.matchMedia;
  if (wantQuery && !mq) {
    mq = window.matchMedia(QUERY);
    mq.addEventListener("change", onSystemChange);
  } else if (!wantQuery && mq) {
    mq.removeEventListener("change", onSystemChange);
    mq = null;
  }
  for (const l of listeners) l();
}

export function setMotionPref(p: MotionPref) {
  try {
    if (p === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* storage unavailable: the choice still applies for this page */
  }
  apply();
}

/** Call once before the first render. */
export function initMotionPref() {
  apply();
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) apply();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** True when motion should be reduced (setting, or OS when the setting is "system"). */
export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, resolvedReduced, () => false);
}

export function useMotionPref(): MotionPref {
  return React.useSyncExternalStore(subscribe, getMotionPref, () => "system");
}
