/**
 * Heartbeat: a run is STALLED when it says running but its log has not moved for STALL_AFTER_MS.
 * The fleet sweep (src/msb.ts) stamps BoxView.stalled from this; notify.ts turns the edge into a
 * "stalled" event.
 */
export const STALL_AFTER_MS = 10 * 60_000;

export function isStalled(runState: string | undefined, lastOutputAtSec: number | undefined, nowMs: number, afterMs = STALL_AFTER_MS): boolean {
  return runState === "running" && !!lastOutputAtSec && nowMs - lastOutputAtSec * 1000 >= afterMs;
}
