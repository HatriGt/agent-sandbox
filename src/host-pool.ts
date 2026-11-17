/**
 * The host pool: every box host the controller may use (src/hosts.ts), each with its own bound
 * Config, its own sleep clock (src/host-sleep.ts) and the last thing a sweep saw on it.
 *
 * What the rest of the controller asks it:
 *
 *   - `cfgForBox(box)`: the Config for the host a box lives on. Every box-scoped call in http.ts
 *     and deps.ts goes through this, so an exec, a resume or a teardown lands on the right machine.
 *     Answered from the last sweep, then from the `box_hosts` table (a restart before the first
 *     sweep), then the primary host (the single-host install, and any box from before the pool).
 *   - `pick()`: where the next run goes (src/host-pick.ts), with a per-host in-flight count so a
 *     parallel fan-out cannot overshoot one host while the total gate still passes.
 *   - `noteSweep(id, boxes)`: what a sweep saw on a host; feeds that host's sleep clock and the
 *     box → host map. `noteSweepError` marks the host unreachable until a sweep succeeds.
 *   - `allAsleep()`: the loops that used to ask the one sleep instance ask this.
 *
 * Metered hosts: awake time is counted per billing month (`tickUsage`, every minute from http.ts)
 * so the picker can prefer the account with the most allowance left and refuse a spent one; a host
 * that just fell asleep is paused through its provider at once (five fewer billed minutes per
 * cycle than waiting for its own idle timer), and a wake starts it so the resume overlaps the SSH.
 */
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { BoxView } from "./monitor.js";
import { isWorkingBox, makeHostSleep, registerSleepResolver, type HostSleep } from "./host-sleep.js";
import { pickHost, totalCapacity, type HostCandidate, type PickResult } from "./host-pick.js";
import { providerFor, type ProviderState } from "./host-providers.js";
import { dropTunnel, ensureTunnel } from "./ssh-tunnel.js";
import {
  PRIMARY_HOST_ID,
  addAwakeMs,
  allBoxHosts,
  allowanceLeft,
  awakeMsOf,
  billingMonth,
  configForHost,
  forgetBoxHost,
  getHostSpec,
  listHostSpecs,
  normalizeHostSpec,
  publicHostSpec,
  rememberBoxHost,
  removeHostSpec,
  saveHostSpec,
  seedPrimaryHost,
  type HostSpec,
} from "./hosts.js";

export interface HostCheck {
  ok: boolean;
  ms: number;
  detail: string;
  at: number;
}

export interface HostRuntime {
  spec: HostSpec;
  cfg: Config;
  sleep: HostSleep;
  lastBoxes: BoxView[];
  lastSweepAt: number;
  lastError?: string;
  unreachableSince?: number;
  /** When `ready` last gave up on this host; it is not picked again for READY_COOLDOWN_MS. */
  readyFailedAt?: number;
  /** When the provider first said paused or stopped (the reading itself is refreshed every minute). */
  dormantSince?: number;
  /** Boots in flight (picked, not yet in `msb ls`). */
  reserved: number;
  /** Awake milliseconds this billing month (metered hosts), mirrored from the table. */
  awakeMs: number;
  usageMonth: string;
  lastUsageTickAt: number;
  provider?: ProviderState;
  check?: HostCheck;
  disk?: { reading?: import("./host-disk.js").DiskReading; at: number; error?: string };
}

/** What the dashboard sees for one host. */
export interface HostStateView {
  id: string;
  name: string;
  provider: string;
  primary: boolean;
  ssh: string;
  enabled: boolean;
  warm: boolean;
  priority: number;
  sleepAfterMs: number;
  maxBoxes: number;
  running: number;
  reserved: number;
  asleep: boolean;
  sleepSince: number;
  /** When the host's clock will put it to sleep if nothing starts working (awake, clock on, nothing working). */
  sleepsAt?: number;
  /** Disabled, but boxes still live on it: swept until they are gone, never picked. */
  draining: boolean;
  unreachable: boolean;
  lastError?: string;
  lastSweepAt: number;
  allowance?: { vcpuHours: number; vcpu: number; resetDay: number; month: string; usedHours: number; leftHours: number; pct: number };
  providerState?: ProviderState;
  check?: HostCheck;
  disk?: { reading?: import("./host-disk.js").DiskReading; at: number; error?: string };
  freestyle?: { vmId: string; hasApiKey: boolean };
  msbHome?: string;
  stagingDir?: string;
  msb?: string;
  snapshot?: string;
  ompSnapshot?: string;
  claudeImage?: string;
  ompImage?: string;
}

export interface HostPoolOpts {
  now?: () => number;
  log?: (m: string) => void;
  /** A quick reachability probe (msb ls over SSH), injected so this module stays IO-free. */
  probe?: (cfg: Config) => Promise<string>;
  /** Tests: a shorter cap on the probe than HOST_ANSWER_TIMEOUT_MS. */
  answerTimeoutMs?: number;
  /** Tests: how often ready() asks the provider for the VM's state (5 s; 1.5 s once a start is out). */
  readyPollMs?: number;
  /** The direct SSH route to a proxied host (src/ssh-tunnel.ts); tests pass their own or none. */
  tunnel?: { ensure: (cfg: Config, wanted: () => boolean) => Promise<boolean>; drop: (cfg: Config) => void } | null;
}

/** Boxes that hold a session on a host: the figure capacity is measured against. */
export function sessionBoxes(boxes: readonly BoxView[]): number {
  return boxes.filter((b) => /^running$/i.test(b.boxStatus) && b.role !== "pool-free").length;
}

export interface HostPool {
  hosts(): HostRuntime[];
  enabled(): HostRuntime[];
  /** Enabled hosts plus the disabled ones that still hold boxes (see `draining`): what a sweep reads. */
  active(): HostRuntime[];
  /** Disabled with boxes still on it: its runs are watched to their end, no new run lands there. */
  draining(id: string): boolean;
  /** The provider readings the pool asked for at construction; http.ts waits for it before the boot-time loops. */
  init(): Promise<void>;
  get(id: string): HostRuntime | undefined;
  primary(): HostRuntime;
  cfgFor(id: string): Config;
  cfgForBox(box: string): Config;
  hostOfBox(box: string): string | undefined;
  rememberBox(box: string, hostId: string): void;
  forgetBox(box: string): void;
  /** Hosts that keep warm boxes, as bound configs (for the pool refill loops). */
  warmCfgs(): Config[];
  pick(opts?: { warmReady?: (h: HostRuntime) => boolean; minAllowanceHours?: number; exclude?: readonly string[]; awakeOnly?: boolean }): PickResult & { host?: HostRuntime; release: () => void };
  /**
   * The host is awake and answering before a run is launched on it: wakes the clock, starts a paused
   * VM through its provider and waits for "running", then for one probe to get through (a resumed VM
   * crawls for about a minute while memory pages back in). Throws when it never answers, so the
   * caller can place the run elsewhere.
   */
  ready(id: string, reason?: string, opts?: { patienceMs?: number }): Promise<void>;
  /**
   * The Config for a box's host, after that host is up: a reply, a resume or a teardown on a box
   * whose VM is paused has to wait for the start, not die on the first SSH. An awake host answers
   * at once.
   */
  readyForBox(box: string, reason?: string): Promise<Config>;
  capacity(): number;
  /** A box was just created on a host: it counts as running until the next sweep lists it. */
  notePlaced(id: string, box: string): void;
  noteSweep(id: string, boxes: BoxView[]): void;
  noteSweepError(id: string, err: string): void;
  noteDisk(id: string, disk: HostRuntime["disk"]): void;
  wake(id: string, reason?: string): void;
  allAsleep(): boolean;
  /** Asleep by its clock, or paused/stopped at its provider (see `dormant`). */
  dormant(id: string): boolean;
  /** Count awake time against each metered host's month. */
  tickUsage(): void;
  state(): HostStateView[];
  publicSpec(id: string): ReturnType<typeof publicHostSpec> | undefined;
  upsert(raw: Partial<HostSpec> & { id?: string }): HostSpec;
  remove(id: string): void;
  check(id: string): Promise<HostCheck>;
  refreshProvider(id: string): Promise<ProviderState>;
  pause(id: string): Promise<ProviderState>;
  start(id: string): Promise<ProviderState>;
  reload(): void;
}

/**
 * One run, placed: pick a host, bring it up, attempt. A failure before the box exists (the host
 * did not wake, SSH died, msb refused) is the host's fault, not the task's, so that host is marked
 * unreachable and the run is attempted on the next one; once `onAcquired` has been called the
 * run stays where it is and its error is the caller's. Without a pool the attempt runs on `cfg`.
 */
export async function placeRun<T>(
  pool: HostPool | null,
  cfg: Config,
  label: string,
  attempt: (hostCfg: Config, onAcquired: (box?: string) => void) => Promise<T>,
  log: (m: string) => void = (m) => console.error(m),
  o: { awakeOnly?: boolean } = {}
): Promise<T> {
  const tried: string[] = [];
  for (;;) {
    const picked = pool?.pick({ minAllowanceHours: 1, exclude: tried, awakeOnly: o.awakeOnly });
    if (picked && !picked.host) {
      throw new Error(tried.length ? `No other box host can take this run after ${tried.join(", ")} failed: ${picked.reason}.` : `No box host can take this run: ${picked.reason}.`);
    }
    const hostCfg: Config = picked?.host ? { ...cfg, ...picked.host.cfg } : cfg;
    let acquired = false;
    try {
      if (picked?.host && pool) {
        // How long to wait for a paused VM: 2.5 minutes when it is the only host that can take the
        // run, 75 s when an awake host with room is standing by (the run goes there, and the VM,
        // started meanwhile, is up for the next one). The picker decides what "standing by" means,
        // so a host sitting out a cooldown or out of allowance is not counted on.
        const alt = pool.pick({ minAllowanceHours: 1, exclude: [...tried, picked.host.spec.id], awakeOnly: true });
        alt.release();
        await pool.ready(picked.host.spec.id, label, { patienceMs: alt.host ? 75_000 : 150_000 });
      }
      return await attempt(hostCfg, (box) => {
        acquired = true;
        // The box exists: it is counted as running from now on, so the slot it reserved is given
        // back at once instead of being held, on top of the box, until the launch returns.
        if (picked?.host && pool && box) pool.notePlaced(picked.host.spec.id, box);
        picked?.release();
      });
    } catch (e) {
      const id = picked?.host?.spec.id;
      const others = pool && id ? pool.enabled().filter((h) => h.spec.id !== id && !tried.includes(h.spec.id)).length : 0;
      const msg = String((e as Error).message ?? e);
      // A bad ref, a patch that does not apply, a clone the token cannot see: the task's, however
      // early it failed. Marking the host dead for it would knock every host out, one per attempt.
      if (acquired || !id || !others || isTaskFault(msg)) throw e;
      log(`[hosts] boot on ${id} failed before the box existed, trying another host: ${msg.slice(0, 200)}`);
      pool!.noteSweepError(id, `boot failed: ${msg.slice(0, 200)}`);
      tried.push(id);
    } finally {
      picked?.release();
    }
  }
}

/** Failures before the box exists that are the run's own and not the host's (src/git-source.ts, deps.ts). */
export function isTaskFault(msg: string): boolean {
  return /Could not check out |Invalid ref |patch too large|The patch does not apply|^attachment: |Nothing was started\./.test(msg);
}

/**
 * Dormant: the host's own clock is asleep, or its provider says the VM is paused or stopped (paused
 * by the operator, by the provider's idle timer, or by a controller that has since restarted). A
 * dormant host is served from its last sweep, never SSHed to by a loop, ranked behind awake hosts,
 * and brought up by `ready` when a run picks it. It is not "unreachable": SSH failing to a paused
 * VM is expected, and an unreachable host would never be picked, so never woken.
 */
export function dormant(h: HostRuntime): boolean {
  // "starting" too: a VM resuming (by `ready`, by the operator, or by the provider's proxy on an SSH
  // that reached it) does not answer SSH for a minute; a loop that tried would time out and call it
  // unreachable, and `readyForBox` would skip the wait a reply needs (seen live 2026-11-17: 172 s).
  const p = h.provider?.state;
  return h.sleep.asleep() || p === "paused" || p === "stopped" || p === "starting";
}

/** A host that `ready` gave up on is left out of the ranking this long, so every run does not pay the wait again. */
export const READY_COOLDOWN_MS = 5 * 60_000;

/** How long one host gets to answer a sweep or a check before it is treated as unreachable this round. */
export const HOST_ANSWER_TIMEOUT_MS = Math.max(5_000, Number(process.env.HOST_ANSWER_TIMEOUT_MS ?? "45000") || 45_000);

/** Rejects with `what timed out after Ns` when `p` has not settled in `ms`; the work itself is not cancelled. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const gate = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, gate]).finally(() => clearTimeout(timer));
}

export function makeHostPool(base: Config, db: Db, opts: HostPoolOpts = {}): HostPool {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const runtimes = new Map<string, HostRuntime>();
  // Where each box was last seen (sweeps) or started (rememberBox); the table backs it.
  const boxHost = new Map<string, string>();
  // Boxes counted before a sweep listed them (notePlaced), with when; a sweep that began before the
  // box existed must not drop them. And how many sweeps in a row a mapped box has been missing from.
  const placedAt = new Map<string, number>();
  const misses = new Map<string, number>();
  // One `ready` in flight per host: three runs picking the same paused VM share one start and one probe.
  const readying = new Map<string, Promise<void>>();
  // The provider readings asked for at construction (a paused VM is dormant from the first sweep on).
  const initial: Promise<unknown>[] = [];

  const monthOf = (spec: HostSpec): string => billingMonth(now(), spec.allowance?.resetDay ?? 1);

  // The direct SSH route for a host behind its provider's proxy: dialled once the host answers
  // (a sweep, a check, a ready), wanted only while it is enabled, awake and this runtime is current,
  // dropped before a pause. A static host is reached directly already.
  const tunnel = opts.tunnel === undefined ? { ensure: ensureTunnel, drop: dropTunnel } : opts.tunnel;
  const tunnelWanted = (h: HostRuntime) => (): boolean => runtimes.get(h.spec.id) === h && h.spec.enabled && !dormant(h) && !h.unreachableSince;
  const dialTunnel = (h: HostRuntime): void => {
    if (!tunnel || h.spec.provider === "static") return;
    void tunnel.ensure(h.cfg, tunnelWanted(h)).catch(() => {});
  };

  const build = (spec: HostSpec, prev?: HostRuntime): HostRuntime => {
    const cfg = configForHost(base, spec);
    // A target that changed: the old tunnel points at a machine this host no longer is.
    if (prev && prev.cfg.vpsSsh !== cfg.vpsSsh) tunnel?.drop(prev.cfg);
    const month = monthOf(spec);
    const sleep =
      prev && prev.spec.sleepAfterMs === spec.sleepAfterMs
        ? prev.sleep
        : makeHostSleep(spec.sleepAfterMs, { now, log: (m) => log(`${m} [${spec.id}]`) });
    return {
      spec,
      cfg,
      sleep,
      lastBoxes: prev?.lastBoxes ?? [],
      lastSweepAt: prev?.lastSweepAt ?? 0,
      lastError: prev?.lastError,
      unreachableSince: prev?.unreachableSince,
      reserved: prev?.reserved ?? 0,
      awakeMs: awakeMsOf(db, spec.id, month),
      usageMonth: month,
      lastUsageTickAt: prev?.lastUsageTickAt ?? now(),
      provider: prev?.provider,
      dormantSince: prev?.dormantSince,
      check: prev?.check,
      disk: prev?.disk,
    };
  };

  /** The provider's latest word, and from when the VM has been paused or stopped. */
  const setProvider = (h: HostRuntime, r: ProviderState): ProviderState => {
    const off = r.state === "paused" || r.state === "stopped";
    const wasOff = h.provider?.state === "paused" || h.provider?.state === "stopped";
    if (off && !wasOff) h.dormantSince = r.at || now();
    else if (!off) h.dormantSince = undefined;
    h.provider = r;
    return r;
  };

  const reload = (): void => {
    const specs = listHostSpecs(db);
    const seen = new Set<string>();
    for (const spec of specs) {
      seen.add(spec.id);
      runtimes.set(spec.id, build(spec, runtimes.get(spec.id)));
    }
    for (const id of [...runtimes.keys()]) if (!seen.has(id)) runtimes.delete(id);
    if (!runtimes.has(PRIMARY_HOST_ID)) {
      const spec = seedPrimaryHost(db, base);
      runtimes.set(spec.id, build(spec));
    }
    for (const [box, id] of allBoxHosts(db)) if (runtimes.has(id) && !boxHost.has(box)) boxHost.set(box, id);
    // A metered host the pool has no reading for yet (a restart while its VM was paused): asked now,
    // so the first sweep serves it from memory instead of burning HOST_ANSWER_TIMEOUT_MS on a dead SSH.
    for (const h of runtimes.values()) {
      if (!h.provider && h.spec.enabled && providerFor(h.spec).metered && h.spec.freestyle?.apiKey) initial.push(refreshProvider(h.spec.id).catch(() => undefined));
    }
  };

  const primary = (): HostRuntime => runtimes.get(PRIMARY_HOST_ID)!;
  const hosts = (): HostRuntime[] => [...runtimes.values()];
  const enabled = (): HostRuntime[] => hosts().filter((h) => h.spec.enabled);
  const get = (id: string): HostRuntime | undefined => runtimes.get(id);
  // Disabled, with boxes still on it (seen by a sweep, or started there and not yet torn down): its
  // runs keep their finish edges, notifications and history, and the operator can "disable the host
  // and let them finish" as the remove refusal suggests. The mapping of a box two sweeps have not
  // listed is dropped (noteSweep), so this ends by itself.
  const draining = (h: HostRuntime): boolean => !h.spec.enabled && (sessionBoxes(h.lastBoxes) > 0 || [...boxHost.values()].includes(h.spec.id));
  const active = (): HostRuntime[] => hosts().filter((h) => h.spec.enabled || draining(h));

  const candidates = (warmReady?: (h: HostRuntime) => boolean, minAllowanceHours?: number): HostCandidate[] =>
    hosts().map((h) => {
      const left = allowanceLeft(h.spec, h.awakeMs);
      return {
        id: h.spec.id,
        enabled: h.spec.enabled,
        unreachable: (!!h.unreachableSince && !dormant(h)) || now() - (h.readyFailedAt ?? -Infinity) < READY_COOLDOWN_MS,
        running: sessionBoxes(h.lastBoxes),
        reserved: h.reserved,
        maxBoxes: h.cfg.maxBoxes,
        // A warm box on a dormant host is frozen with it: a resume plus a claim is slower than a cold boot elsewhere.
        warmReady: !dormant(h) && (warmReady ? warmReady(h) : h.lastBoxes.some((b) => b.role === "pool-free" && /^running$/i.test(b.boxStatus))),
        asleep: dormant(h),
        priority: h.spec.priority,
        allowanceLeft: left?.leftHours,
        minAllowance: minAllowanceHours,
      };
    });

  const providerSync = async (h: HostRuntime, what: "pause" | "start"): Promise<void> => {
    const p = providerFor(h.spec);
    if (!p.metered) return;
    // Before the pause lands: a forward still open to a VM that pauses would be re-dialled through
    // the proxy, and that SSH would resume it.
    if (what === "pause") tunnel?.drop(h.cfg);
    const r = await p[what](h.spec);
    // A call that failed says nothing about the VM: the last good reading stays, with the error on it.
    setProvider(h, r.state === "unknown" && h.provider && h.provider.state !== "unknown" ? { ...h.provider, detail: r.detail } : r);
    log(`[hosts] ${what} ${h.spec.id}: ${r.state}${r.detail ? ` (${r.detail})` : ""}`);
  };

  async function refreshProvider(id: string): Promise<ProviderState> {
    const h = get(id);
    if (!h) throw new Error(`no host "${id}"`);
    setProvider(h, await providerFor(h.spec).state(h.spec));
    // SSH failing to a paused VM was expected; it is dormant, not unreachable.
    if (h.provider!.state === "paused" || h.provider!.state === "stopped") h.unreachableSince = undefined;
    return h.provider!;
  }

  seedPrimaryHost(db, base);
  reload();

  const wake = (id: string, reason?: string): void => {
    const h = get(id);
    if (!h) return;
    // Dormant by its clock or by its provider (paused by the operator or the provider's own idle
    // timer while the clock read awake): either way the VM has to be started, not only marked awake.
    const was = dormant(h);
    h.sleep.wake(reason);
    if (was && h.spec.provider !== "static" && h.spec.freestyle?.apiKey) void providerSync(h, "start").catch(() => {});
  };

  // What a launch path gets from sleepFor(cfg): the host's clock, with a wake that goes through the
  // pool so a paused VM is started through its provider, not only marked awake.
  const sleepFacade = (h: HostRuntime): HostSleep => ({
    get enabled() {
      return h.sleep.enabled;
    },
    wake: (reason) => wake(h.spec.id, reason),
    noteFleet: (boxes) => h.sleep.noteFleet(boxes),
    asleep: () => dormant(h),
    state: () => ({ ...h.sleep.state(), asleep: dormant(h) }),
  });
  registerSleepResolver((cfg) => sleepFacade((cfg.hostId && runtimes.get(cfg.hostId)) || primary()));

  const pool: HostPool = {
    hosts,
    enabled,
    active,
    draining: (id) => {
      const h = get(id);
      return !!h && draining(h);
    },
    init: () => withTimeout(Promise.allSettled(initial), 10_000, "provider readings").then(() => undefined, () => undefined),
    get,
    primary,
    cfgFor: (id) => (get(id) ?? primary()).cfg,
    hostOfBox: (box) => boxHost.get(box),
    cfgForBox: (box) => {
      const id = boxHost.get(box);
      return (id && runtimes.get(id)?.cfg) || primary().cfg;
    },
    rememberBox: (box, hostId) => {
      boxHost.set(box, hostId);
      try {
        rememberBoxHost(db, box, hostId, now());
      } catch {
        /* the in-memory map still answers */
      }
    },
    forgetBox: (box) => {
      boxHost.delete(box);
      try {
        forgetBoxHost(db, box);
      } catch {
        /* nothing to do */
      }
    },
    warmCfgs: () => enabled().filter((h) => h.spec.warm && !h.unreachableSince && !dormant(h)).map((h) => h.cfg),
    pick: (o = {}) => {
      const skip = new Set(o.exclude ?? []);
      // awakeOnly: the controller's own canary never wakes a paused VM; it checks what is up.
      const all = candidates(o.warmReady, o.minAllowanceHours).filter((c) => !skip.has(c.id));
      const r = pickHost(all.filter((c) => !(o.awakeOnly && c.asleep)));
      const host = r.id ? get(r.id) : undefined;
      if (!host) {
        // The refusal names what was really in the way: "no box host is configured" would be wrong
        // when every host is merely asleep and this caller does not wake one.
        if (o.awakeOnly && all.some((c) => c.asleep && c.enabled)) return { ...r, reason: "every box host is asleep, and this run does not wake one", release: () => {} };
        return { ...r, release: () => {} };
      }
      host.reserved++;
      let released = false;
      return {
        ...r,
        host,
        release: () => {
          if (released) return;
          released = true;
          host.reserved = Math.max(0, host.reserved - 1);
        },
      };
    },
    capacity: () => totalCapacity(candidates()),
    notePlaced: (id, box) => {
      const h = get(id);
      if (!h) return;
      placedAt.set(box, now());
      misses.delete(box);
      boxHost.set(box, id);
      // A warm box just claimed is listed as pool-free by the last sweep: it holds a session now.
      const have = h.lastBoxes.find((b) => b.name === box);
      if (have) {
        if (have.role === "pool-free") h.lastBoxes = h.lastBoxes.map((b) => (b.name === box ? { ...b, role: "pool-claimed", boxStatus: "Running" } : b));
        return;
      }
      h.lastBoxes = [...h.lastBoxes, { name: box, role: "session", boxStatus: "Running", runState: "idle", host: id }];
    },
    noteSweep: (id, untagged) => {
      const h = get(id);
      if (!h) return;
      // Every box carries its host from here on, whoever read it.
      const boxes = untagged.map((b) => (b.host === id ? b : { ...b, host: id }));
      const wasAsleep = h.sleep.asleep();
      // A box placed a moment ago that this sweep does not list yet (the read began before the box
      // existed) stays counted for one more round; dropping it would also send its next exec to the
      // primary (cfgForBox) for fifteen seconds.
      const listed = new Set(boxes.map((b) => b.name));
      for (const b of h.lastBoxes) {
        const at = placedAt.get(b.name);
        if (at !== undefined && !listed.has(b.name) && now() - at < 90_000) boxes.push(b);
      }
      for (const [box, at] of placedAt) if (listed.has(box) || now() - at >= 90_000) placedAt.delete(box);
      // A box this host was mapped to that two sweeps in a row have not listed is gone (reaped,
      // removed by hand): its mapping is dropped, so cfgForBox stops answering for it and a disabled
      // host with nothing left on it stops being swept.
      for (const [box, owner] of [...boxHost]) {
        if (owner !== id) continue;
        if (listed.has(box) || placedAt.has(box)) {
          misses.delete(box);
          continue;
        }
        const n = (misses.get(box) ?? 0) + 1;
        if (n < 2) {
          misses.set(box, n);
          continue;
        }
        misses.delete(box);
        boxHost.delete(box);
        try {
          forgetBoxHost(db, box);
        } catch {
          /* the map is what answers */
        }
      }
      h.lastBoxes = boxes;
      h.lastSweepAt = now();
      h.lastError = undefined;
      h.unreachableSince = undefined;
      h.readyFailedAt = undefined;
      dialTunnel(h);
      for (const b of boxes) {
        if (boxHost.get(b.name) !== id) {
          boxHost.set(b.name, id);
          try {
            rememberBoxHost(db, b.name, id, now());
          } catch {
            /* map still answers */
          }
        }
      }
      h.sleep.noteFleet(boxes);
      if (!wasAsleep && h.sleep.asleep() && h.spec.provider !== "static" && h.spec.freestyle?.apiKey) void providerSync(h, "pause").catch(() => {});
    },
    noteSweepError: (id, err) => {
      const h = get(id);
      if (!h) return;
      h.lastError = err.slice(0, 200);
      if (!h.unreachableSince) {
        h.unreachableSince = now();
        log(`[hosts] ${id} unreachable: ${h.lastError}`);
      }
      // A VM that is paused at its provider is not dead; the next round serves it from memory.
      if (providerFor(h.spec).metered && h.spec.freestyle?.apiKey) void refreshProvider(id).catch(() => {});
    },
    noteDisk: (id, disk) => {
      const h = get(id);
      if (h) h.disk = disk;
    },
    wake,
    allAsleep: () => {
      const on = enabled();
      return on.length > 0 && on.every((h) => dormant(h) || !!h.unreachableSince) && on.some((h) => dormant(h));
    },
    dormant: (id) => {
      const h = get(id);
      return !!h && dormant(h);
    },
    tickUsage: () => {
      const t = now();
      for (const h of hosts()) {
        const since = h.lastUsageTickAt;
        h.lastUsageTickAt = t;
        if (!h.spec.enabled) continue;
        // A dormant metered host is asked how its VM is doing (one API read a minute), so a VM that came
        // up late, or was paused or started behind the controller's back, is noticed without an SSH.
        // One that runs while the clock says asleep (the pause call failed, or someone started it by
        // hand) and has nothing working on it is paused again; it would bill until somebody noticed.
        if (dormant(h) && providerFor(h.spec).metered && h.spec.freestyle?.apiKey) {
          void refreshProvider(h.spec.id)
            .then((st) => {
              if (st.state === "running" && h.sleep.asleep() && st.at - h.sleep.state().since > 90_000 && !h.lastBoxes.some(isWorkingBox)) {
                log(`[hosts] ${h.spec.id} runs at its provider while asleep here; pausing it again`);
                return providerSync(h, "pause");
              }
            })
            .catch(() => {});
        }
        if (!h.spec.allowance) continue;
        const month = monthOf(h.spec);
        if (month !== h.usageMonth) {
          h.usageMonth = month;
          h.awakeMs = awakeMsOf(db, h.spec.id, month);
        }
        // A VM paused at the provider bills nothing, however the clock reads. A host that fell asleep
        // since the last tick was awake up to that moment, unless the provider has since said the VM
        // runs anyway (a pause that failed): then it bills until it is paused for real.
        const paused = h.provider?.state === "paused" || h.provider?.state === "stopped";
        const runsAnyway = h.provider?.state === "running" && h.provider.at > h.sleep.state().since;
        const until = paused ? Math.min(t, h.provider!.at) : h.sleep.asleep() && !runsAnyway ? h.sleep.state().since : t;
        const ms = Math.max(0, Math.min(until - since, 10 * 60_000));
        if (!ms) continue;
        h.awakeMs += ms;
        try {
          addAwakeMs(db, h.spec.id, month, ms);
        } catch {
          /* memory keeps counting */
        }
      }
    },
    state: () =>
      hosts()
        .sort((a, b) => a.spec.priority - b.spec.priority || a.spec.id.localeCompare(b.spec.id))
        .map((h) => {
          const left = allowanceLeft(h.spec, h.awakeMs);
          const pub = publicHostSpec(h.spec);
          return {
            id: h.spec.id,
            name: h.spec.name,
            provider: h.spec.provider,
            primary: h.spec.id === PRIMARY_HOST_ID,
            ssh: pub.ssh,
            enabled: h.spec.enabled,
            warm: h.spec.warm,
            priority: h.spec.priority,
            sleepAfterMs: h.spec.sleepAfterMs,
            maxBoxes: h.cfg.maxBoxes,
            running: sessionBoxes(h.lastBoxes),
            reserved: h.reserved,
            asleep: dormant(h),
            sleepSince: h.sleep.state().since || h.dormantSince || 0,
            ...(h.sleep.enabled && h.spec.enabled && !dormant(h) && !h.lastBoxes.some(isWorkingBox) ? { sleepsAt: h.sleep.state().lastWorkAt + h.spec.sleepAfterMs } : {}),
            draining: draining(h),
            unreachable: !!h.unreachableSince && !dormant(h),
            lastError: h.lastError,
            lastSweepAt: h.lastSweepAt,
            ...(h.spec.allowance && left ? { allowance: { ...h.spec.allowance, month: h.usageMonth, ...left } } : {}),
            ...(h.provider ? { providerState: h.provider } : {}),
            ...(h.check ? { check: h.check } : {}),
            ...(h.disk ? { disk: h.disk } : {}),
            ...(pub.freestyle ? { freestyle: pub.freestyle } : {}),
            msbHome: h.cfg.msbHome,
            stagingDir: h.cfg.vpsStagingDir,
            msb: h.cfg.msb,
            ...(h.spec.snapshot !== undefined ? { snapshot: h.spec.snapshot } : {}),
            ...(h.spec.ompSnapshot !== undefined ? { ompSnapshot: h.spec.ompSnapshot } : {}),
            ...(h.spec.claudeImage !== undefined ? { claudeImage: h.spec.claudeImage } : {}),
            ...(h.spec.ompImage !== undefined ? { ompImage: h.spec.ompImage } : {}),
          };
        }),
    publicSpec: (id) => {
      const h = get(id);
      return h ? publicHostSpec(h.spec) : undefined;
    },
    upsert: (raw) => {
      const existing = raw.id ? getHostSpec(db, raw.id) : undefined;
      let spec = normalizeHostSpec(raw, existing);
      if (spec.id === PRIMARY_HOST_ID) {
        // The primary's connection comes from .env; only the tunable fields take.
        const env = primary().spec;
        spec = { ...env, name: spec.name, priority: spec.priority, sleepAfterMs: spec.sleepAfterMs, warm: spec.warm, enabled: spec.enabled, ...(spec.allowance ? { allowance: spec.allowance } : {}) };
        if (!spec.allowance) delete spec.allowance;
      }
      saveHostSpec(db, spec, now());
      reload();
      log(`[hosts] ${existing ? "updated" : "added"} ${spec.id} (${spec.provider}, priority ${spec.priority}${spec.enabled ? "" : ", disabled"})`);
      return spec;
    },
    remove: (id) => {
      removeHostSpec(db, id);
      for (const [box, h] of [...boxHost]) if (h === id) boxHost.delete(box);
      const gone = runtimes.get(id);
      if (gone) tunnel?.drop(gone.cfg);
      reload();
      log(`[hosts] removed ${id}`);
    },
    check: async (id) => {
      const h = get(id);
      if (!h) throw new Error(`no host "${id}"`);
      const t0 = now();
      let r: HostCheck;
      if (providerFor(h.spec).metered && h.spec.freestyle?.apiKey) {
        const st = await refreshProvider(id).catch((e): ProviderState => ({ state: "unknown", detail: String((e as Error).message ?? e), at: now() }));
        if (st.state === "paused" || st.state === "stopped") {
          // No SSH to a paused VM: it is dormant, and `ready` starts it for the next run that picks it.
          h.lastError = undefined;
          h.unreachableSince = undefined;
          h.check = r = { ok: true, ms: now() - t0, detail: `${st.state} at the provider; it is started for the next run`, at: now() };
          return r;
        }
      }
      try {
        const detail = opts.probe ? await withTimeout(opts.probe(h.cfg), opts.answerTimeoutMs ?? HOST_ANSWER_TIMEOUT_MS, `check of ${id}`) : "no probe configured";
        r = { ok: true, ms: now() - t0, detail, at: now() };
        h.lastError = undefined;
        h.unreachableSince = undefined;
        h.readyFailedAt = undefined;
        dialTunnel(h);
      } catch (e) {
        r = { ok: false, ms: now() - t0, detail: (e as Error).message.slice(0, 300), at: now() };
        // A host that does not answer a check is not picked until a sweep or a check gets through.
        h.lastError = r.detail;
        h.unreachableSince ??= now();
      }
      h.check = r;
      return r;
    },
    ready: (id, reason, o = {}) => {
      const h = get(id);
      if (!h) return Promise.reject(new Error(`no host "${id}"`));
      // Callers that arrive while one is in flight share it (one start, one set of probes); the
      // patience is the first caller's.
      let p = readying.get(id);
      if (!p) {
        p = readyInner(h, reason, o)
          .catch((e) => {
            h.readyFailedAt = now();
            throw e;
          })
          .finally(() => {
            if (readying.get(id) === p) readying.delete(id);
          });
        readying.set(id, p);
      }
      return p;
    },
    readyForBox: async (box, reason) => {
      const id = boxHost.get(box);
      const h = (id && runtimes.get(id)) || primary();
      if (dormant(h) || h.unreachableSince) await pool.ready(h.spec.id, reason ?? `box ${box}`);
      return h.cfg;
    },
    refreshProvider,
    pause: async (id) => {
      const h = get(id);
      if (!h) throw new Error(`no host "${id}"`);
      await providerSync(h, "pause");
      return h.provider ?? { state: "n/a", at: now() };
    },
    start: async (id) => {
      const h = get(id);
      if (!h) throw new Error(`no host "${id}"`);
      // The clock directly: wake() would issue its own start and this one would be the second.
      h.sleep.wake("operator");
      await providerSync(h, "start");
      return h.provider ?? { state: "n/a", at: now() };
    },
    reload,
  };

  async function readyInner(h: HostRuntime, reason: string | undefined, o: { patienceMs?: number }): Promise<void> {
    const id = h.spec.id;
    const wasAsleep = dormant(h);
    // The clock directly, not wake(): the provider start is this function's, with the wait that follows.
    h.sleep.wake(reason);
    const p = providerFor(h.spec);
    const cap = opts.answerTimeoutMs ?? HOST_ANSWER_TIMEOUT_MS;
    const patience = o.patienceMs ?? 150_000;
    let cameUp = false;
    if (p.metered && h.spec.freestyle?.apiKey) {
      // Until the provider says running, within the patience given (a Freestyle resume answered in
      // 18 s to 2 min live, and once not at all). A VM seen paused or stopped is started, including one
      // that was still pausing at the first read: the pause issued when the host fell asleep can be in
      // flight when a run picks the host a moment later (seen live 2026-11-17: the canary woke a host
      // mid-pause, no start was issued, and the run waited 150 s for a VM nobody had started).
      const t0 = now();
      const read = async (prev?: ProviderState): Promise<ProviderState> =>
        setProvider(h, await p.state(h.spec).catch((e): ProviderState => prev ?? { state: "unknown", detail: String((e as Error).message ?? e), at: now() }));
      // A fresh "paused" from the dormant host's minute-by-minute read (tickUsage) saves the read
      // before the start: the start goes out half a second sooner, and starting a VM that woke
      // meanwhile is answered "running" by the provider.
      const fresh = h.provider && now() - h.provider.at < 45_000 && (h.provider.state === "paused" || h.provider.state === "stopped") ? h.provider : undefined;
      let state = fresh ?? (await read());
      let startedAt = 0;
      // Polls to skip before a start that failed is tried again (three polls: 15 s live).
      let holdStart = 0;
      // Reads in a row the provider could not answer after a start was issued.
      let unknownReads = 0;
      while (state.state !== "running") {
        // The provider cannot be asked (API down, wrong key) and nothing has been started: the
        // probe below decides, instead of a wait that ends in "unknown after 150s". After a start
        // the API gets three reads to come back before the probe takes over here too.
        unknownReads = state.state === "unknown" ? unknownReads + 1 : 0;
        if (state.state === "unknown" && (!startedAt || unknownReads >= 3)) {
          log(`[hosts] ${id}: provider state unknown${state.detail ? ` (${state.detail})` : ""}; probing instead`);
          cameUp = true;
          break;
        }
        cameUp = true;
        if ((state.state === "paused" || state.state === "stopped") && !startedAt && !holdStart) {
          const r = await p.start(h.spec).catch((e): ProviderState => ({ state: "unknown", detail: String((e as Error).message ?? e), at: now() }));
          log(`[hosts] start ${id}: ${r.state}${r.detail ? ` (${r.detail})` : ""}`);
          if (r.state === "unknown") {
            // The start call failed (a pause still landing at the provider, an API hiccup): once more in a moment.
            holdStart = 3;
          } else {
            setProvider(h, r);
            startedAt = now();
            // The start's own reply is the newest reading. A Freestyle VM resumed from a clean pause
            // answers "running" inside the call (under a second, measured 2026-11-17); waiting a
            // whole poll to read the same thing again was most of a 9 s reply.
            state = r;
            continue;
          }
        }
        if (now() - t0 >= patience) throw new Error(`host ${id} is ${state.state} after ${Math.round((now() - t0) / 1000)}s${state.detail ? ` (${state.detail})` : ""}`);
        // Quick polls once a start is out: a resume takes seconds and a state read ~150 ms.
        await new Promise((r) => setTimeout(r, opts.readyPollMs ?? (startedAt ? 1_500 : 5_000)));
        if (holdStart) holdStart--;
        const next = await read(state);
        // Paused again after a start (the provider's own idle timer, or a pause that landed late): start once more.
        if (startedAt && next.state === "paused" && state.state !== "paused") startedAt = 0;
        state = next;
      }
      // The direct route is dialled now, beside the probe, not after it: its own check is the same
      // first SSH, and the reply's commands then find it up (seen live: a resume's commands went
      // through the proxy for the 5 s the dial took after the probe).
      if (cameUp && state.state === "running") dialTunnel(h);
    }
    // A host that was asleep, unreachable or just came up has to answer once before a box is launched on it.
    if (!opts.probe || (!wasAsleep && !cameUp && !h.unreachableSince)) {
      if (cameUp || wasAsleep) dialTunnel(h);
      return;
    }
    let lastErr = "";
    // A resumed VM's first SSH or two can die at once on the proxy ("Connection closed"), so the
    // tries are spaced out, 2 s then 4 s then 8 s: back-to-back refusals would give up on a host
    // that answers a moment later, and a fixed 10 s between tries made every refusal cost 10 s.
    const spacing = (i: number): number => opts.readyPollMs ?? 2_000 * 2 ** i;
    for (let i = 0; i < 4; i++) {
      try {
        await withTimeout(opts.probe(h.cfg), cap, `probe of ${id}`);
        h.lastError = undefined;
        h.unreachableSince = undefined;
        h.readyFailedAt = undefined;
        dialTunnel(h);
        return;
      } catch (e) {
        lastErr = (e as Error).message;
        log(`[hosts] ${id} not answering yet (${i + 1}/4): ${lastErr.slice(0, 120)}`);
        if (i < 3) await new Promise((r) => setTimeout(r, spacing(i)));
      }
    }
    h.lastError = lastErr.slice(0, 300);
    h.unreachableSince ??= now();
    throw new Error(`host ${id} did not answer: ${lastErr}`);
  }
  return pool;
}

// The one pool this controller runs; CLI tools and tests that never configure one get a stand-in
// that answers "the config you gave me" and never sleeps, so single-host code paths need no pool.
let shared: HostPool | null = null;

export function configureHostPool(pool: HostPool): HostPool {
  shared = pool;
  return pool;
}

export function hostPool(): HostPool | null {
  return shared;
}

/** The Config for a box, or the given one when no pool is configured. */
export function cfgForBox(cfg: Config, box: string): Config {
  return shared ? shared.cfgForBox(box) : cfg;
}

/** The Config for a box with its host up (a paused VM is started and waited for), or the given one without a pool. */
export function cfgForBoxReady(cfg: Config, box: string, reason?: string): Promise<Config> {
  return shared ? shared.readyForBox(box, reason) : Promise.resolve(cfg);
}

/** The configs to refill warm boxes on, or just the given one when no pool is configured. */
export function warmCfgs(cfg: Config): Config[] {
  return shared ? shared.warmCfgs() : [cfg];
}

/** Capacity across the pool, or the one host's when no pool is configured. */
export function poolCapacity(cfg: Config): number {
  return shared ? shared.capacity() : cfg.maxBoxes;
}
