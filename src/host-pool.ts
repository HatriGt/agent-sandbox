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
import { makeHostSleep, registerSleepResolver, type HostSleep } from "./host-sleep.js";
import { pickHost, totalCapacity, type HostCandidate, type PickResult } from "./host-pick.js";
import { providerFor, type ProviderState } from "./host-providers.js";
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
}

/** Boxes that hold a session on a host: the figure capacity is measured against. */
export function sessionBoxes(boxes: readonly BoxView[]): number {
  return boxes.filter((b) => /^running$/i.test(b.boxStatus) && b.role !== "pool-free").length;
}

export interface HostPool {
  hosts(): HostRuntime[];
  enabled(): HostRuntime[];
  get(id: string): HostRuntime | undefined;
  primary(): HostRuntime;
  cfgFor(id: string): Config;
  cfgForBox(box: string): Config;
  hostOfBox(box: string): string | undefined;
  rememberBox(box: string, hostId: string): void;
  forgetBox(box: string): void;
  /** Hosts that keep warm boxes, as bound configs (for the pool refill loops). */
  warmCfgs(): Config[];
  pick(opts?: { warmReady?: (h: HostRuntime) => boolean; minAllowanceHours?: number }): PickResult & { host?: HostRuntime; release: () => void };
  capacity(): number;
  noteSweep(id: string, boxes: BoxView[]): void;
  noteSweepError(id: string, err: string): void;
  noteDisk(id: string, disk: HostRuntime["disk"]): void;
  wake(id: string, reason?: string): void;
  allAsleep(): boolean;
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

  const monthOf = (spec: HostSpec): string => billingMonth(now(), spec.allowance?.resetDay ?? 1);

  const build = (spec: HostSpec, prev?: HostRuntime): HostRuntime => {
    const cfg = configForHost(base, spec);
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
      check: prev?.check,
      disk: prev?.disk,
    };
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
  };

  seedPrimaryHost(db, base);
  reload();

  const primary = (): HostRuntime => runtimes.get(PRIMARY_HOST_ID)!;
  const hosts = (): HostRuntime[] => [...runtimes.values()];
  const enabled = (): HostRuntime[] => hosts().filter((h) => h.spec.enabled);
  const get = (id: string): HostRuntime | undefined => runtimes.get(id);

  const candidates = (warmReady?: (h: HostRuntime) => boolean, minAllowanceHours?: number): HostCandidate[] =>
    hosts().map((h) => {
      const left = allowanceLeft(h.spec, h.awakeMs);
      return {
        id: h.spec.id,
        enabled: h.spec.enabled,
        unreachable: !!h.unreachableSince,
        running: sessionBoxes(h.lastBoxes),
        reserved: h.reserved,
        maxBoxes: h.cfg.maxBoxes,
        warmReady: warmReady ? warmReady(h) : h.lastBoxes.some((b) => b.role === "pool-free" && /^running$/i.test(b.boxStatus)),
        asleep: h.sleep.asleep(),
        priority: h.spec.priority,
        allowanceLeft: left?.leftHours,
        minAllowance: minAllowanceHours,
      };
    });

  const providerSync = async (h: HostRuntime, what: "pause" | "start"): Promise<void> => {
    const p = providerFor(h.spec);
    if (!p.metered) return;
    const r = await p[what](h.spec);
    h.provider = r;
    log(`[hosts] ${what} ${h.spec.id}: ${r.state}${r.detail ? ` (${r.detail})` : ""}`);
  };

  const wake = (id: string, reason?: string): void => {
    const h = get(id);
    if (!h) return;
    const was = h.sleep.asleep();
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
    asleep: () => h.sleep.asleep(),
    state: () => h.sleep.state(),
  });
  registerSleepResolver((cfg) => sleepFacade((cfg.hostId && runtimes.get(cfg.hostId)) || primary()));

  const pool: HostPool = {
    hosts,
    enabled,
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
    warmCfgs: () => enabled().filter((h) => h.spec.warm && !h.unreachableSince).map((h) => h.cfg),
    pick: (o = {}) => {
      const r = pickHost(candidates(o.warmReady, o.minAllowanceHours));
      const host = r.id ? get(r.id) : undefined;
      if (!host) return { ...r, release: () => {} };
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
    noteSweep: (id, untagged) => {
      const h = get(id);
      if (!h) return;
      // Every box carries its host from here on, whoever read it.
      const boxes = untagged.map((b) => (b.host === id ? b : { ...b, host: id }));
      const wasAsleep = h.sleep.asleep();
      h.lastBoxes = boxes;
      h.lastSweepAt = now();
      h.lastError = undefined;
      h.unreachableSince = undefined;
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
    },
    noteDisk: (id, disk) => {
      const h = get(id);
      if (h) h.disk = disk;
    },
    wake,
    allAsleep: () => {
      const on = enabled();
      return on.length > 0 && on.every((h) => h.sleep.asleep() || !!h.unreachableSince) && on.some((h) => h.sleep.asleep());
    },
    tickUsage: () => {
      const t = now();
      for (const h of hosts()) {
        const since = h.lastUsageTickAt;
        h.lastUsageTickAt = t;
        if (!h.spec.allowance) continue;
        const month = monthOf(h.spec);
        if (month !== h.usageMonth) {
          h.usageMonth = month;
          h.awakeMs = awakeMsOf(db, h.spec.id, month);
        }
        if (!h.spec.enabled) continue;
        // A host that fell asleep since the last tick was awake up to that moment.
        const until = h.sleep.asleep() ? h.sleep.state().since : t;
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
            asleep: h.sleep.asleep(),
            sleepSince: h.sleep.state().since,
            unreachable: !!h.unreachableSince,
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
      reload();
      log(`[hosts] removed ${id}`);
    },
    check: async (id) => {
      const h = get(id);
      if (!h) throw new Error(`no host "${id}"`);
      const t0 = now();
      let r: HostCheck;
      try {
        const detail = opts.probe ? await withTimeout(opts.probe(h.cfg), opts.answerTimeoutMs ?? HOST_ANSWER_TIMEOUT_MS, `check of ${id}`) : "no probe configured";
        r = { ok: true, ms: now() - t0, detail, at: now() };
        h.lastError = undefined;
        h.unreachableSince = undefined;
      } catch (e) {
        r = { ok: false, ms: now() - t0, detail: (e as Error).message.slice(0, 300), at: now() };
        // A host that does not answer a check is not picked until a sweep or a check gets through.
        h.lastError = r.detail;
        h.unreachableSince ??= now();
      }
      h.check = r;
      return r;
    },
    refreshProvider: async (id) => {
      const h = get(id);
      if (!h) throw new Error(`no host "${id}"`);
      h.provider = await providerFor(h.spec).state(h.spec);
      return h.provider;
    },
    pause: async (id) => {
      const h = get(id);
      if (!h) throw new Error(`no host "${id}"`);
      await providerSync(h, "pause");
      return h.provider ?? { state: "n/a", at: now() };
    },
    start: async (id) => {
      const h = get(id);
      if (!h) throw new Error(`no host "${id}"`);
      wake(id, "operator");
      await providerSync(h, "start");
      return h.provider ?? { state: "n/a", at: now() };
    },
    reload,
  };
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

/** The configs to refill warm boxes on, or just the given one when no pool is configured. */
export function warmCfgs(cfg: Config): Config[] {
  return shared ? shared.warmCfgs() : [cfg];
}

/** Capacity across the pool, or the one host's when no pool is configured. */
export function poolCapacity(cfg: Config): number {
  return shared ? shared.capacity() : cfg.maxBoxes;
}
