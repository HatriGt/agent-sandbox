/**
 * Host sleep: let a metered box host (a Freestyle VM, docs/freestyle-host.md) pause itself when
 * nobody is running anything.
 *
 * The host pauses on its own after a few minutes without network traffic and wakes on the next SSH
 * connection, so the controller never starts or stops it. What the controller has to do is go
 * QUIET: the fleet sweep (every 15s), the warm-pool refill (every minute), the host-disk reading
 * and the canary each open an SSH connection, and any one of them keeps the host awake around the
 * clock. This module is the one decision those loops ask before touching the host:
 *
 *   - a box whose agent is working keeps the host awake;
 *   - a fleet with no working box for `afterMs` puts the controller to sleep: the loops skip their
 *     tick and the fleet read serves its last snapshot, marked `hostAsleep`;
 *   - the launch paths (a new box, a resumed box, an agent exec) call `wake()` first, so the sweep
 *     that notices the new run is never the thing we are waiting for.
 *
 * A box waiting on a question or sitting idle after a finish does not need the host up: the answer
 * or the follow-up message is a launch, and launches wake. `afterMs` 0 turns the whole thing off
 * (a host of our own never sleeps). Pure: the clock is injected, no IO.
 */

export interface HostSleepState {
  enabled: boolean;
  asleep: boolean;
  /** When the controller went quiet (ms), 0 while awake. */
  since: number;
  /** The last moment work was seen or asked for (ms). */
  lastWorkAt: number;
  afterMs: number;
  /** The host is held awake until this moment (ms) because someone is using it; 0 when not held. */
  heldUntil: number;
}

/**
 * How long a host stays up after the operator touched one of its threads (opened it, woke its box,
 * sent a reply). Seen live 2026-11-19: a kept thread was opened, its host woken, and six minutes
 * later the clock paused the host again while the thread was being read, so the reply paid a
 * second resume through the proxy (165 s). Attention is activity.
 */
export const ATTENTION_HOLD_MS = Math.max(0, Number(process.env.HOST_ATTENTION_MS ?? "") || 60 * 60_000);

export interface SleepyBox {
  boxStatus: string;
  runState: string;
  role: string;
}

/** A box whose agent is working right now: the one thing that keeps the host up by itself. */
export function isWorkingBox(b: SleepyBox): boolean {
  return /^running$/i.test(b.boxStatus) && b.role !== "pool-free" && b.runState === "running";
}

export interface HostSleep {
  readonly enabled: boolean;
  /** Something needs the host now (a launch). Clears sleep and restarts the quiet clock. */
  wake(reason?: string): void;
  /** What a real sweep saw. Working boxes keep the host up; a quiet fleet for `afterMs` sleeps. */
  noteFleet(boxes: readonly SleepyBox[]): void;
  /** Someone is using a thread on this host: no sleep before now + ms, whatever the sweeps see. Wakes too. */
  hold(ms: number, reason?: string): void;
  asleep(): boolean;
  state(): HostSleepState;
  /**
   * When the host last came back from sleep (ms), 0 if it never slept. The pool reaper reads it: a
   * VM that resumed moments ago answers slowly or not at all for a while, and a box that misses one
   * probe in that window is not wedged, it is waking up.
   */
  wokeAt(): number;
}

export function makeHostSleep(afterMs: number, opts: { now?: () => number; log?: (m: string) => void } = {}): HostSleep {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const enabled = afterMs > 0;
  let lastWorkAt = now();
  let asleep = false;
  let since = 0;
  let wokeAt = 0;
  let heldUntil = 0;
  const wake = (reason?: string): void => {
    lastWorkAt = now();
    if (!asleep) return;
    asleep = false;
    since = 0;
    wokeAt = now();
    log(`[host-sleep] awake${reason ? `: ${reason}` : ""}`);
  };
  return {
    enabled,
    wake,
    hold(ms, reason) {
      const until = now() + Math.max(0, ms);
      const longer = until > heldUntil;
      if (longer) heldUntil = until;
      wake(reason);
      if (longer && enabled) log(`[host-sleep] held awake ${Math.round(ms / 60_000)}m${reason ? `: ${reason}` : ""}`);
    },
    noteFleet(boxes) {
      if (!enabled) return;
      // Held (someone is using a thread here) counts as work: the quiet clock restarts when it ends.
      if (boxes.some(isWorkingBox) || now() <= heldUntil) {
        lastWorkAt = now();
        return;
      }
      if (asleep || now() - lastWorkAt < afterMs) return;
      asleep = true;
      since = now();
      log(`[host-sleep] quiet for ${Math.round(afterMs / 60_000)}m: letting the host sleep`);
    },
    asleep: () => asleep,
    state: () => ({ enabled, asleep, since, lastWorkAt, afterMs, heldUntil: now() <= heldUntil ? heldUntil : 0 }),
    wokeAt: () => wokeAt,
  };
}

// Each box host has its own instance (src/host-pool.ts). The launch paths in msb.ts and the refill
// in pool.ts hold a Config bound to a host, so they ask for THAT host's sleep; before the pool is
// configured (CLI tools, tests) the one shared instance answers for every config.
let shared: HostSleep = makeHostSleep(0);
let resolver: (cfg: { hostId?: string }) => HostSleep = () => shared;

/** Install the configured instance (http.ts, at boot). Before that, nothing sleeps. */
export function configureHostSleep(sleep: HostSleep): HostSleep {
  shared = sleep;
  return shared;
}

export function hostSleep(): HostSleep {
  return shared;
}

/** The pool installs this so `sleepFor` answers per host. */
export function registerSleepResolver(r: ((cfg: { hostId?: string }) => HostSleep) | null): void {
  resolver = r ?? (() => shared);
}

/** The sleep state of the host a Config is bound to. */
export function sleepFor(cfg: { hostId?: string }): HostSleep {
  return resolver(cfg);
}
