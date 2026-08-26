/**
 * Fleet view — the dashboard's primary read, shaped for a UI rather than a CLI.
 *
 * Adds three things `/monitor.json` never had:
 *
 *   1. **Lifecycle facts.** The configured idle timeout and max duration (as seconds) and the fleet
 *      capacity, so the UI can show "1h cap · 42m left" and "3 of 5 slots" from real configuration.
 *   2. **Sleeping machines.** A box that idle-stopped while parked on a question, or after finishing,
 *      is Stopped but INTACT — its rootfs and Claude session survive, and `resume` restarts it. The
 *      monitor filtered those out entirely, so a run the operator walked away from silently vanished
 *      from the dashboard. Here they stay listed, with the last-known task/question merged in from
 *      this process's memory (a stopped box cannot be exec'd to re-read its sentinels).
 *   3. **A short shared cache** so several open tabs (or a rapid refocus) cost one SSH sweep, not N.
 *
 * Pure parts (merging, lifecycle shaping) are here and tested; IO is injected.
 */
import type { Config } from "./config.js";
import { isRunning, parseDurationSec, type BoxView } from "./monitor.js";

export interface FleetLifecycle {
  /** Per-session idle timeout, seconds (undefined if unparseable). */
  idleTimeoutSec?: number;
  /** Idle timeout for unclaimed warm-pool boxes, seconds. */
  poolIdleTimeoutSec?: number;
  /** Hard cap on any box's lifetime, seconds. */
  maxDurationSec?: number;
  /** Max concurrent live boxes. */
  capacity: number;
  /** Warm boxes the pool tries to keep ready. */
  poolSize: number;
}

export interface FleetSnapshot {
  boxes: BoxView[];
  lifecycle: FleetLifecycle;
  /** Server time (ms) the sweep completed — lets the client compute honest freshness. */
  at: number;
}

export function lifecycleOf(cfg: Config): FleetLifecycle {
  return {
    idleTimeoutSec: parseDurationSec(cfg.idleTimeout),
    poolIdleTimeoutSec: parseDurationSec(cfg.poolIdleTimeout),
    maxDurationSec: parseDurationSec(cfg.maxDuration),
    capacity: cfg.maxBoxes,
    poolSize: cfg.poolSize,
  };
}

/**
 * Merge the latest sweep with what we last knew about each box.
 *
 * A Stopped box still appears in `msb ls`, but its sentinels are unreadable, so the sweep reports it
 * with no task/question and runState "idle". If we saw it running earlier we know better: keep its
 * task, question and last run state so the UI can show "sleeping — wakes on reply". Unclaimed pool
 * boxes that stopped are just dead capacity (the maintainer reaps them) and are dropped. Boxes that
 * left `msb ls` entirely are forgotten.
 */
export function mergeWithMemory(latest: BoxView[], memory: Map<string, BoxView>): BoxView[] {
  const out: BoxView[] = [];
  for (const b of latest) {
    if (isRunning(b.boxStatus)) {
      memory.set(b.name, b);
      out.push(b);
      continue;
    }
    const known = memory.get(b.name);
    if (b.role === "pool-free" && !known) continue; // never-claimed pool box that died: not a run
    if (known) {
      out.push({
        ...known,
        boxStatus: "Stopped",
        // Metrics of a stopped box are stale; keep the last-seen uptime as "ran for" and drop live vitals.
        cpu: undefined,
        mem: undefined,
      });
    } else {
      out.push(b);
    }
  }
  const alive = new Set(latest.map((b) => b.name));
  for (const name of [...memory.keys()]) if (!alive.has(name)) memory.delete(name);
  return out;
}

/**
 * Cached fleet reader: at most one sweep in flight, results reused for `ttlMs`.
 * `sweep` is the SSH-backed gatherMonitor in production.
 */
export function makeFleetReader(
  cfg: Config,
  sweep: () => Promise<BoxView[]>,
  opts: { ttlMs?: number; now?: () => number; decorate?: (boxes: BoxView[]) => BoxView[] } = {}
): () => Promise<FleetSnapshot> {
  const ttl = opts.ttlMs ?? 1500;
  const now = opts.now ?? Date.now;
  const memory = new Map<string, BoxView>();
  const lifecycle = lifecycleOf(cfg);
  let cached: FleetSnapshot | null = null;
  let inFlight: Promise<FleetSnapshot> | null = null;

  return () => {
    if (cached && now() - cached.at < ttl) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = sweep()
      .then((boxes) => {
        const merged = mergeWithMemory(boxes, memory);
        cached = { boxes: opts.decorate ? opts.decorate(merged) : merged, lifecycle, at: now() };
        return cached;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
