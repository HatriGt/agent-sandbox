import * as React from "react";
import type { BoxView } from "@/lib/api";

/**
 * Hold a machine in the list briefly after it stops being reported.
 *
 * A polled list must not trust a single response. A machine being reaped at its max-duration makes
 * the host disagree with itself for a few seconds — `msb ls` still says running while metrics say
 * exited — and without this the card blinked in and out once a second, which reads as a broken UI
 * rather than as a machine shutting down.
 *
 * A machine that has genuinely gone stays gone: it disappears once it has been absent for
 * `graceMs`, and while it is in that window it is marked `leaving` so the UI can dim it and say so
 * instead of pretending it is healthy.
 */
export interface StableBox extends BoxView {
  /** True while the machine is missing from the latest poll but still inside the grace window. */
  leaving?: boolean;
}

export function useStableBoxes(boxes: BoxView[] | null, graceMs = 9000): StableBox[] {
  // name -> { box, lastSeen }. A ref, because holding it in state would re-render on every poll.
  const seen = React.useRef(new Map<string, { box: BoxView; at: number }>());
  const [, bump] = React.useState(0);

  const now = Date.now();
  if (boxes) {
    for (const b of boxes) seen.current.set(b.name, { box: b, at: now });
    for (const [name, entry] of seen.current) {
      if (now - entry.at > graceMs) seen.current.delete(name);
    }
  }

  // Re-render once when the oldest grace window is due to expire, so a leaving machine actually
  // disappears rather than waiting for the next poll to notice.
  React.useEffect(() => {
    if (!seen.current.size) return;
    const oldest = Math.min(...[...seen.current.values()].map((e) => e.at));
    const due = oldest + graceMs - Date.now();
    if (due <= 0) return;
    const t = window.setTimeout(() => bump((n) => n + 1), due + 50);
    return () => window.clearTimeout(t);
  }, [boxes, graceMs]);

  const live = new Set((boxes ?? []).map((b) => b.name));
  return [...seen.current.values()].map(({ box }) =>
    live.has(box.name) ? box : { ...box, leaving: true }
  );
}
