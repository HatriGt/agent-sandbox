/**
 * When a finished box is put to sleep by the controller (http.ts maybeNap).
 *
 * The runtime's own idle timer is not the clock the dashboard shows: it counts every read the sweep
 * makes as activity, so a finished box could sit at "sleeps any moment" indefinitely. This rule is
 * the clock: the agent log's age against the idle timeout, for a session box whose run is over.
 */
export const NAP_TURN_GRACE_MS = 3 * 60_000;

/** The quiet clock's start: the agent log's age, or the last wake when that is newer (a wake is activity). */
export function quietSinceSec(lastOutputAtSec: number | undefined, wokenAtMs: number | undefined): number | undefined {
  const woke = wokenAtMs != null ? wokenAtMs / 1000 : undefined;
  if (woke == null) return lastOutputAtSec;
  return lastOutputAtSec == null ? woke : Math.max(lastOutputAtSec, woke);
}

export function shouldNap(o: {
  role: string;
  boxStatus: string;
  runState: string;
  /** Agent log mtime, epoch seconds; unknown → never napped here (nothing to count from). */
  lastOutputAtSec?: number;
  idleTimeoutSec: number;
  nowMs: number;
  /** When the controller last started a turn on the box (a reply): the agent may not have written yet. */
  turnStartedAtMs?: number;
}): boolean {
  if (o.role === "pool-free") return false;
  if (!/^running$/i.test(o.boxStatus)) return false;
  // Working: not idle. Waiting on a question: the ask-park owns that clock (src/ask-park.ts).
  if (o.runState !== "done" && o.runState !== "idle") return false;
  if (o.lastOutputAtSec == null || !(o.idleTimeoutSec > 0)) return false;
  if (o.turnStartedAtMs != null && o.nowMs - o.turnStartedAtMs < NAP_TURN_GRACE_MS) return false;
  return o.nowMs / 1000 - o.lastOutputAtSec >= o.idleTimeoutSec;
}
