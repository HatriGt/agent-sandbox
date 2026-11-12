/**
 * Warm pool: keep a small number of pre-booted, pre-bootstrapped boxes idle so a delegation
 * skips the ~4s microVM boot + bootstrap and only pays for the repo copy.
 *
 * Tradeoff (decided): pooled boxes boot with OPEN egress so they're reusable for any task.
 * Therefore the pool is only used when the delegation itself wants open egress
 * (EGRESS_ALLOW_ALL and no per-call domain restriction). A restricted-egress delegation does a
 * fresh cold boot with its exact allowlist — never a pooled open-egress box.
 *
 * The pool state lives on the VPS (the running `pool-*` boxes), so it survives MCP respawns.
 */
import { createBox, bootWarmBox, adoptWarmBox, listPoolBoxes, listWarmBoxes, hostFreeMb, claimWarmBox, reapDeadPoolBoxes, forceRemoveBox, OMP_MIN_MEMORY, OMP_MIN_DISK, OMP_CPUS, ompRootSource, claudeRootSource, type WarmBox } from "./msb.js";
import { BLANK_OWNER, activeWarmOwners, lastOwnerAgent, ownerTag } from "./warm-owners.js";
import { loadAgentPrefs } from "./agent-kind.js";
import { stagingPathFor } from "./sync.js";
import { parseDurationSec } from "./monitor.js";
import type { Config } from "./config.js";
import { preferredAgents, type AgentKind } from "./agent-kind.js";

/**
 * A pool box's --max-duration clock starts at BOOT, not at claim. Observed live: a box booted at
 * 04:24, claimed at 05:22, and killed by "max duration 3600s exceeded" at 05:24 — two minutes into
 * the user's run, reported as "the sandbox restarted mid-run". Freshness is judged from the boot
 * time embedded in the pool name (pool-<epochMs>-<rand>), which every bootWarmBox name carries.
 */
export function poolBoxAgeMs(name: string, nowMs = Date.now()): number | undefined {
  const m = name.match(/^pool-(\d+)-/);
  if (!m) return undefined;
  const t = Number(m[1]);
  return Number.isFinite(t) && t > 0 ? nowMs - t : undefined;
}

/** Only boxes young enough that a full run still fits before their own max-duration kill. An
 *  undatable name is treated as stale — handing it out risks a mid-run kill. */
export function freshPoolBoxes(available: readonly string[], maxAgeMs: number, nowMs = Date.now()): string[] {
  return available.filter((b) => {
    const age = poolBoxAgeMs(b, nowMs);
    return age !== undefined && age <= maxAgeMs;
  });
}

// The boot-time --max-duration budget lives in monitor.ts (next to parseDurationSec) because
// msb.ts needs it too and pool.ts already imports msb.ts — a cycle otherwise.
export { warmMaxDuration } from "./monitor.js";

/** Is a baked claude rootfs (image or snapshot) configured? Without one a claude box cold-installs. */
export function claudeSourceOn(cfg: Config): boolean {
  return !!(cfg.claudeImage || cfg.snapshot);
}

/** The Config a claude pool box boots with: the claude image (or snapshot) at the default tier. */
export function claudePoolCfg(cfg: Config): Config {
  return { ...cfg, ...claudeRootSource(cfg) };
}

/** Whether this delegation is eligible to use a (open-egress) pooled box. */
export function poolEligible(cfg: Config, allowDomainsProvided: boolean): boolean {
  return cfg.poolSize > 0 && claudeSourceOn(cfg) && cfg.egressAllowAll && !allowDomainsProvided;
}

/**
 * The pool carries TWO flavors since omp landed: claude boxes (1G, agent-base) and omp boxes
 * (2G/4G, agent-omp — whose ~3G rootfs makes a cold snapshot boot ~35s, the whole reason omp needs
 * a pool at all). The flavor is embedded in the NAME (pool-<epochMs>-omp-<rand>) so every existing
 * pool mechanism — the prefix filters, reaping, capacity exclusion, the age-from-name freshness
 * gate — applies to both flavors unchanged.
 */
export function poolBoxFlavor(name: string): AgentKind {
  return /^pool-\d+-omp-/.test(name) ? "omp" : "claude";
}

/** The Config an omp pool box boots with: the omp image (or snapshot) at omp's memory/disk tier. */
export function ompPoolCfg(cfg: Config): Config {
  return { ...cfg, ...ompRootSource(cfg), memory: OMP_MIN_MEMORY, cpus: OMP_CPUS, rootDisk: OMP_MIN_DISK, poolSize: cfg.ompPoolSize };
}

/** Is a baked omp rootfs (image or snapshot) configured? Without one an omp box cold-installs. */
function ompSourceOn(cfg: Config): boolean {
  return !!(cfg.ompImage || cfg.ompSnapshot);
}

/** Pool eligibility for an omp delegation (mirrors poolEligible on the omp fields). */
export function ompPoolEligible(cfg: Config, allowDomainsProvided: boolean): boolean {
  return cfg.ompPoolSize > 0 && ompSourceOn(cfg) && cfg.egressAllowAll && !allowDomainsProvided;
}

/**
 * Get a ready box for `session` with the repo copied in. Uses a warm box when eligible and one
 * is available; otherwise cold-boots via createBox. Returns the box name to use as the session.
 *
 * When a warm box is claimed its own pool name becomes the session/box id, so callers should use
 * the returned name (not the incoming session) for status/resume/teardown.
 */
/**
 * Boxes this process is mid-claim on. `listPoolBoxes` proves a box free by SSHing into it, which takes
 * seconds, and `claimWarmBox` only writes /.claimed after that returns — so two concurrent delegations
 * both saw the same `available[0]` and drove two agents into ONE sandbox. Observed in production: two
 * plans interleaved snapshot-by-snapshot in a single log, and one run self-healed to exit 254.
 *
 * A synchronous check-and-add is atomic on the event loop, so reserving here closes the window without
 * serialising the claims: a second delegation simply skips a reserved box and takes the next free one.
 * Released only on FAILURE — after a successful claim the box's own /.claimed marker keeps it out of
 * `listPoolBoxes`. Scope is this process, which is the whole controller; it does not coordinate across
 * replicas, and a second controller against one pool would still need a host-side lock.
 */
const claiming = new Set<string>();

/** The first listed box no in-flight delegation has reserved. Pure, so the choice itself is testable. */
export function pickFreeBox(available: readonly string[], reserved: ReadonlySet<string> = claiming): string | undefined {
  return available.find((b) => !reserved.has(b));
}

/**
 * The warm boxes this owner may take, their own first: a box prepared for them, then a blank one.
 * Never another owner's box, and never a legacy box (warmed before boxes had owners). Pure.
 */
export function claimableBoxes(boxes: readonly WarmBox[], owner: string | undefined): string[] {
  const tag = owner ? ownerTag(owner) : undefined;
  const mine = boxes.filter((b) => tag !== undefined && b.owner === tag);
  const blank = boxes.filter((b) => b.owner === BLANK_OWNER);
  return [...mine, ...blank].map((b) => b.name);
}

export async function acquireBox(
  cfg: Config,
  session: string,
  copyDir: string | undefined,
  eligible: boolean,
  agent: AgentKind = "claude",
  owner?: string
): Promise<{ box: string; warm: boolean }> {
  if (eligible) {
    // listPoolBoxes already reaps dead/wedged boxes, so anything it returns is Running + free.
    // Freshness gate on top: warm boxes boot with max-duration = poolIdleTimeout + maxDuration
    // (bootWarmBox), so any box younger than poolIdleTimeout still has a full run left. An older
    // (or pre-fix) box may be killed mid-run by its own boot-anchored timer — cold-booting is
    // slower but never dies two minutes in.
    const maxAgeMs = (parseDurationSec(cfg.poolIdleTimeout) ?? 0) * 1000;
    // Only THIS delegation's flavor: a claude task must never claim an omp box and vice versa —
    // wrong toolchain, wrong memory tier, wrong snapshot.
    const listed = (await listWarmBoxes(cfg)).filter((b) => poolBoxFlavor(b.name) === agent);
    const available = freshPoolBoxes(claimableBoxes(listed, owner), maxAgeMs);
    const warm = pickFreeBox(available);
    if (warm) {
      claiming.add(warm);
      try {
        await claimWarmBox(cfg, warm, copyDir);
        // Fast path: a pre-booted, pre-bootstrapped box was claimed. The caller kicks an async
        // reseed right after so the pool refills to size while this delegation runs.
        console.error(
          `[pool] claimed warm box ${warm} (fast path, ${available.length}/${cfg.poolSize} were ready); reseeding to ${cfg.poolSize}`
        );
        return { box: warm, warm: true };
      } catch (e) {
        // The box went sideways between listing and claiming (desync), or its disk cannot take a
        // run (claimWarmBox's floor). Don't hand back a box that would show run:running while
        // Stopped, or die before turn one: remove THIS box, reap the rest, cold-boot clean.
        console.error(`[pool] claim of ${warm} failed, removing it and cold-booting:`, e);
        await forceRemoveBox(cfg, warm).catch(() => {});
        await reapDeadPoolBoxes(cfg);
      } finally {
        claiming.delete(warm);
      }
    }
  }
  // Cold path: boot a box named after the session with the repo baked in / copied in.
  console.error(
    `[pool] cold boot: pool empty (eligible=${eligible}) — booting a fresh box for ${session}`
  );
  await createBox(cfg, { name: session, copyDir });
  return { box: session, warm: false };
}

/** IO seam for refillPool so its concurrency behavior is unit-testable without SSH. */
export interface RefillIO {
  listPoolBoxes: (cfg: Config) => Promise<string[]>;
  bootWarmBox: (cfg: Config, agent?: AgentKind, owner?: string | null) => Promise<string>;
  removeBox: (cfg: Config, box: string) => Promise<void>;
  /** The same listing with each box's owner; absent (tests) means every listed box is blank. */
  listWarmBoxes?: (cfg: Config) => Promise<WarmBox[]>;
  /** Re-prepare a blank box for an owner in place; absent means boot a new one instead. */
  adoptWarmBox?: (cfg: Config, box: string, agent: AgentKind, owner: string) => Promise<void>;
  /** MiB the host can still give out; absent or undefined means "do not hold back". */
  hostFreeMb?: (cfg: Config) => Promise<number | undefined>;
  /** Which agent an owner's box is warmed for. */
  ownerFlavor?: (owner: string) => AgentKind;
}
const realRefillIO: RefillIO = { listPoolBoxes, listWarmBoxes, bootWarmBox, adoptWarmBox, removeBox: forceRemoveBox, hostFreeMb };

/**
 * The pool flavor an owner's box is warmed for: the agent they last started a task with, and
 * until they start one, their default agent.
 */
export function ownerFlavor(owner: string, last: AgentKind | undefined = lastOwnerAgent(owner)): AgentKind {
  return last ?? (loadAgentPrefs(owner).defaultAgent === "omp" ? "omp" : "claude");
}

/** "1G" / "1536M" as MiB; an unreadable size counts as 1 GiB. Pure. */
export function memoryMb(size: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([GM])/i.exec(size.trim());
  if (!m) return 1024;
  return Math.round(Number(m[1]) * (m[2].toUpperCase() === "G" ? 1024 : 1));
}

/** Kept free on the host on top of a new warm box's own memory, in MiB. */
export const WARM_HOST_RESERVE_MB = 512;

/**
 * May the host take one more idle VM? A warm box is a convenience; on a host that is short of
 * memory it is the first thing to give up, because the run it would speed up needs that memory
 * more. Unknown free memory never holds a boot back. Pure.
 */
export function hostHasRoom(freeMb: number | undefined, boxMemory: string): boolean {
  return freeMb === undefined || freeMb >= memoryMb(boxMemory) + WARM_HOST_RESERVE_MB;
}

/** Said once per state, not once a minute by the maintainer. */
let saidNoRoom = false;

/**
 * At most ONE refill in flight per process. Observed live: a warm claim's reseed and the periodic
 * maintainer both listed the pool before either boot registered, computed deficit=1 twice, and
 * booted TWO warm boxes for poolSize=1 (3 seconds apart) — the surplus box then sat idle for the
 * whole 6h pool window, eating 1G RAM and one of the 5 capacity slots. Concurrent callers now share
 * the running flight; a caller arriving after it settled starts a fresh one (it re-lists anyway).
 */
let refillInFlight: Promise<void> | null = null;

/**
 * Reconcile the pool to exactly poolSize open-egress warm boxes: boot the deficit, or trim the
 * OLDEST surplus (oldest = nearest its boot-anchored max-duration, so the least useful to keep).
 * Fire-and-forget: errors are logged to stderr and swallowed so a refill failure never breaks a
 * delegation.
 */
export function refillPool(
  cfg: Config,
  io: RefillIO = realRefillIO,
  wanted: Set<AgentKind> = preferredAgents(),
  owners: readonly string[] = activeWarmOwners(cfg)
): Promise<void> {
  const claudeOn = cfg.poolSize > 0 && claudeSourceOn(cfg);
  const ompOn = (cfg.ompPoolSize ?? 0) > 0 && ompSourceOn(cfg);
  if ((!claudeOn && !ompOn) || !cfg.egressAllowAll) return Promise.resolve();
  if (refillInFlight) return refillInFlight;
  const flight = (async () => {
    try {
      // Reap dead/wedged boxes first so the deficit is real and a fresh boot won't collide with a
      // stale msb record ("cannot start: already running"). listPoolBoxes reaps as a side effect.
      // ONE listing serves both flavors; each reconciles its own partition. A flavor no user has
      // picked as their default gets a target of ZERO — its idle boxes are trimmed, not kept: the
      // pool follows the agent setting instead of paying RAM for both flavors at once.
      const listed: WarmBox[] = io.listWarmBoxes
        ? await io.listWarmBoxes(cfg)
        : (await io.listPoolBoxes(cfg)).map((name) => ({ name, owner: BLANK_OWNER }));
      const bootCfgOf = (agent: AgentKind): Config => (agent === "omp" ? ompPoolCfg(cfg) : claudePoolCfg(cfg));
      const room = async (agent: AgentKind): Promise<boolean> => {
        const free = io.hostFreeMb ? await io.hostFreeMb(cfg) : undefined;
        const ok = hostHasRoom(free, bootCfgOf(agent).memory);
        if (!ok && !saidNoRoom) console.error(`[pool] not booting a warm ${agent} box: the host has ${free} MB free, and a warm box is the first thing to give up`);
        saidNoRoom = !ok;
        return ok;
      };
      // Owner boxes first. Each owner on the list holds ONE box prepared with their own set, in
      // their own agent's flavor; a flavor whose pool is off gets none.
      const flavorOf = io.ownerFlavor ?? ownerFlavor;
      const holders = owners
        .map((owner) => ({ owner, tag: ownerTag(owner), agent: flavorOf(owner) }))
        .filter((o) => (o.agent === "omp" ? ompOn : claudeOn));
      const agentOfTag = new Map(holders.map((o) => [o.tag, o.agent]));
      const pool: WarmBox[] = [];
      for (const b of listed) {
        // A box nobody may claim is only RAM: one whose owner left the list, one in a flavor its
        // owner no longer uses, or one warmed before boxes had owners.
        const keep = b.owner === BLANK_OWNER || agentOfTag.get(b.owner) === poolBoxFlavor(b.name);
        if (keep || claiming.has(b.name)) pool.push(b);
        else {
          console.error(`[pool] removing warm box ${b.name}: ${b.owner === "legacy" ? "it was warmed before boxes had owners" : "its owner is no longer around"}`);
          await io.removeBox(cfg, b.name);
        }
      }
      for (const o of holders) {
        if (pool.some((b) => b.owner === o.tag && poolBoxFlavor(b.name) === o.agent)) continue;
        const blank = io.adoptWarmBox ? pool.find((b) => b.owner === BLANK_OWNER && poolBoxFlavor(b.name) === o.agent && !claiming.has(b.name)) : undefined;
        if (blank && io.adoptWarmBox) {
          // Reserved like a claim, so no task takes the box while it is being prepared.
          claiming.add(blank.name);
          try {
            await io.adoptWarmBox(cfg, blank.name, o.agent, o.owner);
            blank.owner = o.tag;
            console.error(`[pool] warm ${o.agent} box ${blank.name} is now prepared for one owner`);
          } catch (e) {
            pool.splice(pool.indexOf(blank), 1);
            console.error(`[pool] could not prepare ${blank.name} for its owner:`, (e as Error).message);
          } finally {
            claiming.delete(blank.name);
          }
          continue;
        }
        if (!(await room(o.agent))) continue;
        const name = await io.bootWarmBox(bootCfgOf(o.agent), o.agent, o.owner);
        pool.push({ name, owner: o.tag });
        console.error(`[pool] warm ${o.agent} box ready for one owner: ${name}`);
      }
      // Blank boxes: kept only while nobody is on the list, so a deployment nobody has used yet
      // still starts its first task warm. Once an owner holds a box, a blank one is spare RAM.
      const all = pool.filter((b) => b.owner === BLANK_OWNER).map((b) => b.name);
      const blankOn = holders.length === 0;
      const flavors: Array<{ agent: AgentKind; size: number; bootCfg: Config; on: boolean }> = [
        { agent: "claude", size: blankOn && wanted.has("claude") ? cfg.poolSize : 0, bootCfg: claudePoolCfg(cfg), on: claudeOn },
        { agent: "omp", size: blankOn && wanted.has("omp") ? cfg.ompPoolSize ?? 0 : 0, bootCfg: ompPoolCfg(cfg), on: ompOn },
      ];
      for (const f of flavors) {
        if (!f.on) continue;
        const available = all.filter((b) => poolBoxFlavor(b) === f.agent);
        const deficit = f.size - available.length;
        if (deficit > 0) {
          console.error(`[pool] refilling ${f.agent}: ${available.length}/${f.size} ready — booting ${deficit}`);
          for (let i = 0; i < deficit; i++) {
            if (!(await room(f.agent))) break;
            const name = await io.bootWarmBox(f.bootCfg, f.agent);
            console.error(`[pool] warm ${f.agent} box ready: ${name}`);
          }
        } else if (deficit < 0) {
          // A past double-refill left extras; keep the youngest (most run budget left), trim the rest.
          // Never trim a box an in-flight claim reserved: /.claimed lands only seconds after
          // `claiming.add`, and removing the box in that window kills the delegation that just picked it.
          const oldestFirst = [...available]
            .filter((b) => !claiming.has(b))
            .sort((a, b) => (poolBoxAgeMs(b) ?? Infinity) - (poolBoxAgeMs(a) ?? Infinity));
          for (const box of oldestFirst.slice(0, -deficit)) {
            console.error(`[pool] trimming surplus warm ${f.agent} box ${box} (${available.length}/${f.size} ready)`);
            await io.removeBox(cfg, box);
          }
        }
      }
    } catch (e) {
      console.error("[pool] refill failed:", e);
    }
  })();
  const tracked = flight.finally(() => {
    if (refillInFlight === tracked) refillInFlight = null;
  });
  refillInFlight = tracked;
  return tracked;
}

/**
 * Refill once more after whatever refill is running now. For a change the running flight cannot
 * have seen: an owner who just showed up needs their box prepared now, not at the next tick.
 */
export function kickRefill(cfg: Config): void {
  const after = refillInFlight;
  if (after) void after.then(() => refillPool(cfg));
  else void refillPool(cfg);
}

/**
 * Start a background maintainer that keeps the pool topped to size. A claim-only reseed can't cover
 * a pool that drained on its own — an unclaimed box hitting max-duration, a boot that failed, or a
 * long lull. This periodic refill (which reaps dead boxes first, then boots the deficit) is what
 * makes a warm box ALWAYS ready. Returns a stop handle; unref'd so it never holds the process open.
 */
export function startPoolMaintainer(cfg: Config): { stop: () => void } {
  const claudeOn = cfg.poolSize > 0 && claudeSourceOn(cfg);
  const ompOn = (cfg.ompPoolSize ?? 0) > 0 && ompSourceOn(cfg);
  if ((!claudeOn && !ompOn) || !cfg.egressAllowAll || cfg.poolRefillIntervalMs <= 0) {
    return { stop: () => {} };
  }
  console.error(
    `[pool] maintainer on: keeping ${claudeOn ? `${cfg.poolSize} claude` : ""}${claudeOn && ompOn ? " + " : ""}${
      ompOn ? `${cfg.ompPoolSize} omp` : ""
    } warm box(es) ready (every ${Math.round(cfg.poolRefillIntervalMs / 1000)}s)`
  );
  const timer = setInterval(() => {
    void refillPool(cfg);
  }, cfg.poolRefillIntervalMs);
  // Don't let the interval keep the event loop (and thus the process) alive on its own.
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}

/** Current pool status: how many warm boxes are available vs the configured target. */
export async function poolStatus(cfg: Config): Promise<{
  size: number;
  available: number;
  boxes: string[];
  enabled: boolean;
}> {
  const enabled = (cfg.poolSize > 0 && claudeSourceOn(cfg) && cfg.egressAllowAll) || ompPoolEligible(cfg, false);
  const boxes = enabled ? await listPoolBoxes(cfg) : [];
  return { size: cfg.poolSize + (ompSourceOn(cfg) ? cfg.ompPoolSize : 0), available: boxes.length, boxes, enabled };
}

/** Staging path helper re-export so index.ts has one import site for pool wiring. */
export { stagingPathFor };
