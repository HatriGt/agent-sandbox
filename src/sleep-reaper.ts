/**
 * The sleep TTL as the controller's own rule, judged from the thread table (src/threads.ts), so
 * it holds on every host in every state.
 *
 * The maintainer in src/msb.ts (reapDeadPoolBoxes) judges a sleeping box by a marker on its host,
 * and only when that host is awake and warms boxes: a temporary box asleep on a paused Freestyle or
 * Instabox machine, or on any host without a warm pool, was never judged at all, and the fleet
 * listed it as "temporary" with no countdown for as long as the host slept (ten such rows on
 * 2026-11-20, some a day old). Each thread row now carries `asleep_since` (the sweep that saw its
 * box go running → stopped); this sweep reads the rows, wakes a host once for every box past its
 * TTL on it, and destroys them. The host's own sleep gate puts it back to sleep.
 *
 * Automation boxes (a run a trigger or a PR follow-up started) go as soon as their box is not
 * running: the run's result is archived on the finish edge, and the box exists only to produce it.
 * One whose box the host no longer lists at all (`absent`) has nothing left to destroy; its thread
 * row is closed. A run paused on a question is held to `parkTtlSec`, which the caller sets to the
 * sleep TTL unless ask-park stops a box the moment it asks (then the park TTL, src/snapshot.ts): the
 * owner's rule is that every temporary box goes an hour after it fell asleep, question or not, and
 * on 2026-11-21 one sat asleep on a greeting for 14 h under the 48 h park hold. A kept (pinned)
 * thread is never touched; the teardown refuses one anyway.
 */
import type { ThreadRow } from "./threads.js";
import type { StartedBy } from "./started-by.js";

export interface ReapInput {
  rows: ThreadRow[];
  startedBy: (id: string) => StartedBy | undefined;
  nowMs: number;
  sleepTtlSec: number;
  /** How long a box parked on a question is held; the sleep TTL unless ask-park is on (src/snapshot.ts askParkTtlSec). */
  parkTtlSec: number;
}

export type ReapAction =
  /** Stop the box for good: the teardown path, which wakes the host when it must. */
  | { id: string; host: string | null; action: "destroy"; why: string }
  /** The box is gone already (the host listed the thread without it): close the row only. */
  | { id: string; host: string | null; action: "forget"; why: string }
  /** Asleep with no clock yet: the clock starts now, the row is judged on a later sweep. */
  | { id: string; host: string | null; action: "clock"; why: string };

export const isAutomationRun = (s: StartedBy | undefined): boolean => s?.kind === "trigger" || s?.kind === "followup";

/** Pure: what this sweep does with each thread row. */
export function reapVerdicts(i: ReapInput): ReapAction[] {
  const out: ReapAction[] = [];
  for (const r of i.rows) {
    if (r.deleted_at || r.kept) continue;
    if (r.box_status === "running" || r.box_status === "unknown") continue;
    const automation = isAutomationRun(i.startedBy(r.id));
    if (r.run_state === "waiting" && !automation) {
      // Parked on a question: the longer TTL, from the same clock.
      if (r.box_status !== "stopped") continue;
      if (r.asleep_since == null) {
        out.push({ id: r.id, host: r.host, action: "clock", why: "asleep on a question, no clock yet" });
        continue;
      }
      const asleepSec = (i.nowMs - r.asleep_since) / 1000;
      const ttl = Math.max(i.sleepTtlSec, i.parkTtlSec);
      if (asleepSec >= ttl) out.push({ id: r.id, host: r.host, action: "destroy", why: `parked on a question for ${Math.round(asleepSec / 3600)}h, past the ${Math.round(ttl / 3600)}h park TTL` });
      continue;
    }
    if (automation) {
      if (r.run_state === "waiting") continue; // an automation run asking something: the operator's to answer
      if (r.box_status === "absent") out.push({ id: r.id, host: r.host, action: "forget", why: "automation run whose box is gone" });
      else out.push({ id: r.id, host: r.host, action: "destroy", why: `automation run ${r.run_state === "running" ? "whose box stopped mid-run" : "finished"}; the box is not kept past its run` });
      continue;
    }
    if (r.box_status !== "stopped") continue; // absent = Away, the user's thread with its copy
    if (r.asleep_since == null) {
      out.push({ id: r.id, host: r.host, action: "clock", why: "asleep, no clock yet" });
      continue;
    }
    const asleepSec = (i.nowMs - r.asleep_since) / 1000;
    if (asleepSec >= i.sleepTtlSec) out.push({ id: r.id, host: r.host, action: "destroy", why: `asleep ${Math.round(asleepSec / 60)}m, past the ${Math.round(i.sleepTtlSec / 60)}m sleep TTL` });
  }
  return out;
}

/** Seconds a stopped box has been asleep by the thread's clock, for the fleet's countdown when the host's marker is not at hand. */
export function asleepSecOf(r: Pick<ThreadRow, "box_status" | "asleep_since"> | undefined, nowMs: number): number | undefined {
  if (!r || r.box_status !== "stopped" || r.asleep_since == null) return undefined;
  return Math.max(0, Math.round((nowMs - r.asleep_since) / 1000));
}

/** The destroys grouped by host, so a paused host is woken once for all of its overdue boxes. */
export function groupByHost(actions: ReapAction[]): Map<string, ReapAction[]> {
  const m = new Map<string, ReapAction[]>();
  for (const a of actions) {
    const k = a.host ?? "";
    const l = m.get(k) ?? [];
    l.push(a);
    m.set(k, l);
  }
  return m;
}
