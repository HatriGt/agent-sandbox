/**
 * Fleet view — the dashboard's primary read, shaped for a UI rather than a CLI.
 *
 * Three things a plain box listing does not give:
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
import { MEMORY_TIERS, DISK_TIERS } from "./msb.js";

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
  /** How long a non-kept sandbox may sleep before it is destroyed, seconds. */
  sleepTtlSec?: number;
  /** Memory tiers a box may be resized to, so the UI never hardcodes them. */
  memoryTiers?: string[];
  /** The tier every new box boots with (MSB_MEMORY). */
  memoryDefault?: string;
  /** Root-disk tiers a box may GROW to — the runtime cannot shrink a managed disk. */
  diskTiers?: string[];
}

export interface FleetSnapshot {
  boxes: BoxView[];
  lifecycle: FleetLifecycle;
  /** Server time (ms) the sweep completed — lets the client compute honest freshness. */
  at: number;
  /** Every host is being left asleep (src/host-sleep.ts): this is the last sweep, not a fresh one. */
  hostAsleep?: boolean;
}

export function lifecycleOf(cfg: Config): FleetLifecycle {
  return {
    idleTimeoutSec: parseDurationSec(cfg.idleTimeout),
    poolIdleTimeoutSec: parseDurationSec(cfg.poolIdleTimeout),
    maxDurationSec: parseDurationSec(cfg.maxDuration),
    capacity: cfg.maxBoxes,
    poolSize: cfg.poolSize,
    sleepTtlSec: parseDurationSec(cfg.sleepTtl),
    memoryTiers: [...MEMORY_TIERS],
    memoryDefault: cfg.memory,
    diskTiers: [...DISK_TIERS],
  };
}

export interface MergeOpts {
  /**
   * Hosts this sweep could not read (asleep or unreachable) and served from their last snapshot. A
   * remembered box on one of them is NOT forgotten for being absent — the snapshot may be empty
   * (right after a controller restart it always is) — it is listed as Stopped until the host answers.
   * On 2026-11-18 a deploy restarted the controller while the Freestyle host's tunnel was down; the
   * first sweep saw an empty snapshot for it, forgot every box there and deleted their durable
   * memory, and a pinned thread was "gone" for hours while its machine sat untouched on the host.
   */
  stale?: ReadonlySet<string>;
  /**
   * Is this box someone's: kept, claimed, or owned (the host markers and the owner table)? A Stopped
   * box the memory does not know is dead capacity ONLY when nobody holds it; one that is held is a
   * sleeping thread whose memory was lost, and it is listed under its name so it can be opened.
   */
  held?: (name: string) => boolean;
}

/** A remembered box, shown asleep: last-seen description, no live vitals (a frozen meter looks live). */
function asleep(known: BoxView): BoxView {
  return { ...known, boxStatus: "Stopped", cpu: undefined, mem: undefined, memUsage: undefined, disk: undefined };
}

/**
 * Merge the latest sweep with what we last knew about each box.
 *
 * A Stopped box still appears in `msb ls`, but its sentinels are unreadable, so the sweep reports it
 * with no task/question and runState "idle". If we saw it running earlier we know better: keep its
 * task, question and last run state so the UI can show "sleeping — wakes on reply". Unclaimed pool
 * boxes that stopped are just dead capacity (the maintainer reaps them) and are dropped — unless
 * someone holds them (`opts.held`). Boxes that left `msb ls` are forgotten, unless their host did
 * not answer this sweep (`opts.stale`): absence from a snapshot the host never gave is no evidence.
 */
export function mergeWithMemory(latest: BoxView[], memory: Map<string, BoxView>, opts: MergeOpts = {}): BoxView[] {
  const out: BoxView[] = [];
  const seen = new Set<string>();
  for (const b of latest) {
    seen.add(b.name);
    // An away thread (src/threads.ts): the box is gone and the thread table speaks for it. Nothing
    // to remember about a box that does not exist.
    if (b.absent) {
      memory.delete(b.name);
      out.push(b);
      continue;
    }
    if (isRunning(b.boxStatus)) {
      memory.set(b.name, b);
      out.push(b);
      continue;
    }
    const known = memory.get(b.name);
    if (known) {
      // Keep the last-seen uptime as "ran for"; the host tag follows the sweep (a box is where it is listed).
      out.push(asleep({ ...known, host: b.host ?? known.host }));
      continue;
    }
    // A stopped box's role cannot be read (no exec): held by someone, it is a sleeping thread; else dead capacity.
    if (!opts.held?.(b.name)) continue;
    const view: BoxView = { ...b, role: b.role === "pool-free" ? "pool-claimed" : b.role, runState: "idle" };
    memory.set(b.name, view);
    out.push(asleep(view));
  }
  for (const [name, known] of [...memory]) {
    if (seen.has(name)) continue;
    if (known.host && opts.stale?.has(known.host)) {
      out.push(asleep(known));
      continue;
    }
    memory.delete(name);
  }
  return out;
}

/**
 * Cached fleet reader: at most one sweep in flight, results reused for `ttlMs`.
 * `sweep` is the SSH-backed gatherMonitor in production.
 */
export interface RunMemoryStore {
  /** All remembered runs (loaded at the first sweep, and again while `incomplete()` says a source was missed). */
  load(): Promise<Map<string, Partial<BoxView> & { name: string }>>;
  /** Persist one running box's description (called only when it changed). */
  save(meta: Partial<BoxView> & { name: string }): Promise<void>;
  /** Forget a box that left `msb ls`. */
  forget(box: string): Promise<void>;
  /** True while some source of memory (a host that was asleep or unreachable) has not been read yet. */
  incomplete?(): boolean;
}

/** What one sweep answers: the boxes, and (from a host pool) which hosts were served from memory and who holds a box. */
export type SweepAnswer = BoxView[] | { boxes: BoxView[]; stale?: readonly string[]; held?: (name: string) => boolean };

export function makeFleetReader(
  cfg: Config,
  sweep: () => Promise<SweepAnswer>,
  opts: {
    ttlMs?: number;
    now?: () => number;
    decorate?: (boxes: BoxView[]) => BoxView[];
    store?: RunMemoryStore;
    /** How long an in-flight sweep may be shared before a new caller starts its own. */
    sweepTtlMs?: number;
    /** Host sleep (src/host-sleep.ts): while asleep the last snapshot is served and no sweep runs. */
    sleep?: { asleep(): boolean; noteFleet(boxes: readonly BoxView[]): void };
    /** Slots across every box host (src/host-pool.ts), read per snapshot so an added host shows at once. */
    capacity?: () => number;
    /**
     * Stale-while-revalidate: a snapshot older than ttl but younger than this is handed out at
     * once and a sweep is started behind it. 0 (the default) waits for the sweep. The dashboard
     * polls every 3 s and a sweep over a Freestyle VM's SSH proxy takes ~3.4 s, so without this
     * every poll waited on a sweep and the page was always a sweep behind anyway.
     */
    staleMs?: number;
  } = {}
): FleetReader {
  const ttl = opts.ttlMs ?? 1500;
  const stale = opts.staleMs ?? 0;
  // Comfortably above a healthy sweep (~1.2s measured with 3 boxes) and below the client's own
  // patience, so a wedged sweep costs one slow response rather than every response thereafter.
  const sweepTtl = opts.sweepTtlMs ?? 20_000;
  const now = opts.now ?? Date.now;
  const memory = new Map<string, BoxView>();
  const lifecycle = lifecycleOf(cfg);
  let cached: FleetSnapshot | null = null;
  let inFlight: Promise<FleetSnapshot> | null = null;
  let inFlightAt = 0;
  // Durable memory (run-memory.ts): hydrate once so sleeping runs survive a controller restart, and
  // write back a box's description whenever it changes while running. Fingerprints avoid a write per
  // sweep; failures are swallowed — memory is a convenience layer, never a reason to fail the fleet.
  let hydrated = !opts.store;
  const written = new Map<string, string>();
  const persist = (boxes: BoxView[]) => {
    if (!opts.store) return;
    for (const b of boxes) {
      if (!isRunning(b.boxStatus) || b.role === "pool-free") continue;
      const meta = { name: b.name, host: b.host, role: b.role, runState: b.runState, exitCode: b.exitCode, task: b.task, question: b.question, repos: b.repos, uptime: b.uptime };
      const fp = JSON.stringify(meta);
      if (written.get(b.name) === fp) continue;
      written.set(b.name, fp);
      void opts.store.save(meta).catch(() => {});
    }
  };

  const run = (): Promise<FleetSnapshot> => {
    inFlightAt = now();
    const mine = (async () => {
      // Hydrate until every source answered: a host asleep or unreachable at startup is read when it
      // is back, and its sleeping threads appear then instead of never.
      if (opts.store && (!hydrated || opts.store.incomplete?.())) {
        try {
          for (const [name, meta] of await opts.store.load()) {
            if (!memory.has(name)) memory.set(name, { boxStatus: "Stopped", runState: "idle", role: "session", ...meta } as BoxView);
          }
          hydrated = true;
        } catch {
          /* start without memory; the next sweep tries again */
        }
      }
      return sweep();
    })()
      .then((answer) => {
        const boxes = Array.isArray(answer) ? answer : answer.boxes;
        const stale = Array.isArray(answer) ? undefined : new Set(answer.stale ?? []);
        const held = Array.isArray(answer) ? undefined : answer.held;
        const before = new Set(memory.keys());
        const merged = mergeWithMemory(boxes, memory, { stale, held });
        persist(boxes);
        if (opts.store) for (const name of before) if (!memory.has(name)) void opts.store.forget(name).catch(() => {});
        cached = { boxes: opts.decorate ? opts.decorate(merged) : merged, lifecycle: opts.capacity ? { ...lifecycle, capacity: opts.capacity() } : lifecycle, at: now() };
        opts.sleep?.noteFleet(boxes);
        return cached;
      })
      .finally(() => {
        // Only the CURRENT sweep may clear the slot: a slow sweep that finally settles after being
        // superseded would otherwise cancel the de-duplication for whichever sweep replaced it.
        if (inFlight === mine) inFlight = null;
      });
    inFlight = mine;
    return mine;
  };
  const read = (): Promise<FleetSnapshot> => {
    // Asleep: every SSH would wake the host, and the sweep is the one that runs on a timer. Hand
    // out the last snapshot (flagged, so the UI can say so) until a launch wakes us.
    if (opts.sleep?.asleep() && cached) return Promise.resolve({ ...cached, hostAsleep: true });
    if (cached && now() - cached.at < ttl) return Promise.resolve(cached);
    const serveStale = !!cached && now() - cached.at < stale;
    // A sweep that never settles must not be shared forever. `inFlight` de-duplicates concurrent
    // callers, but it used to be cleared ONLY in .finally() — so one unsettleable sweep (a wedged
    // `msb exec` into a box caught mid-shutdown) meant every later reader was handed that same dead
    // promise and the dashboard hung on skeletons until the controller was restarted. Observed in
    // production. Stop sharing a sweep that has outlived any plausible runtime; the next caller
    // starts a fresh one, and the abandoned promise settles (or doesn't) harmlessly on its own.
    if (inFlight && now() - inFlightAt < sweepTtl) return serveStale ? Promise.resolve(cached!) : inFlight;
    const mine = run();
    if (serveStale) {
      mine.catch(() => {});
      return Promise.resolve(cached!);
    }
    return mine;
  };
  // A box the controller itself just destroyed: out of the snapshot now, so a stale-while-revalidate
  // read a moment later does not show the machine the user watched disappear.
  read.forget = (name: string) => {
    if (cached) cached = { ...cached, boxes: cached.boxes.filter((b) => b.name !== name) };
  };
  return read;
}

export type FleetReader = (() => Promise<FleetSnapshot>) & { forget: (name: string) => void };
