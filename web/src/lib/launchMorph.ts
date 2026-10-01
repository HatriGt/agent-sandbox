import * as React from "react";
import { animate } from "motion/react";

/**
 * New task → box: the Hub composer "becomes" the thread's Task bubble.
 *
 * The pane swap runs under AnimatePresence mode="wait", so the Hub has unmounted before the booting
 * pane mounts — a `layoutId` shared element cannot bridge that gap. Instead the Hub records where its
 * composer text sat at the moment of sending, and the Task bubble FLIPs from that rect to its own
 * (transform + opacity only, one-shot, consumed on first use).
 */
let origin: { rect: DOMRect; at: number } | null = null;

export function recordLaunchOrigin(el: Element | null | undefined) {
  origin = el ? { rect: el.getBoundingClientRect(), at: Date.now() } : null;
}

function takeLaunchOrigin(): DOMRect | null {
  const o = origin;
  origin = null;
  // Stale (a reload, a slow delegate that already re-rendered elsewhere) — no morph.
  return o && Date.now() - o.at < 2000 ? o.rect : null;
}

/** Attach to the Task bubble wrapper. Plays the morph once if a launch origin is pending. */
export function useLaunchMorph<T extends HTMLElement>(reduce: boolean | null) {
  const ref = React.useRef<T>(null);
  React.useLayoutEffect(() => {
    const from = takeLaunchOrigin();
    const el = ref.current;
    if (!from || !el || reduce) return;
    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) return;
    // Right-aligned bubble: scale from its top-right corner so the text appears to slide up-right.
    el.style.transformOrigin = "100% 0%";
    const dx = from.right - to.right;
    const dy = from.top - to.top;
    const sx = Math.min(Math.max(from.width / to.width, 0.6), 1.6);
    const controls = animate(
      el,
      { x: [dx, 0], y: [dy, 0], scale: [sx, 1], opacity: [0.4, 1] },
      { type: "spring", stiffness: 380, damping: 34, mass: 0.9 }
    );
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}
