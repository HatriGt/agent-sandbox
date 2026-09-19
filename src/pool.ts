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
import { createBox, bootWarmBox, listPoolBoxes, claimWarmBox, reapDeadPoolBoxes, forceRemoveBox } from "./msb.js";
import { stagingPathFor } from "./sync.js";
import { parseDurationSec } from "./monitor.js";
import type { Config } from "./config.js";

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

/** Whether this delegation is eligible to use a (open-egress) pooled box. */
export function poolEligible(cfg: Config, allowDomainsProvided: boolean): boolean {
  return cfg.poolSize > 0 && !!cfg.snapshot && cfg.egressAllowAll && !allowDomainsProvided;
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

export async function acquireBox(
  cfg: Config,
  session: string,
  copyDir: string | undefined,
  eligible: boolean
): Promise<{ box: string; warm: boolean }> {
  if (eligible) {
    // listPoolBoxes already reaps dead/wedged boxes, so anything it returns is Running + free.
    // Freshness gate on top: warm boxes boot with max-duration = poolIdleTimeout + maxDuration
    // (bootWarmBox), so any box younger than poolIdleTimeout still has a full run left. An older
    // (or pre-fix) box may be killed mid-run by its own boot-anchored timer — cold-booting is
    // slower but never dies two minutes in.
    const maxAgeMs = (parseDurationSec(cfg.poolIdleTimeout) ?? 0) * 1000;
    const available = freshPoolBoxes(await listPoolBoxes(cfg), maxAgeMs);
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
        // The box went sideways between listing and claiming (desync). Don't hand back a dead box
        // that would show run:running while Stopped — reap it and fall through to a clean cold boot.
        console.error(`[pool] claim of ${warm} failed, reaping and cold-booting:`, e);
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
  bootWarmBox: (cfg: Config) => Promise<string>;
  removeBox: (cfg: Config, box: string) => Promise<void>;
}
const realRefillIO: RefillIO = { listPoolBoxes, bootWarmBox, removeBox: forceRemoveBox };

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
export function refillPool(cfg: Config, io: RefillIO = realRefillIO): Promise<void> {
  if (cfg.poolSize <= 0 || !cfg.snapshot || !cfg.egressAllowAll) return Promise.resolve();
  if (refillInFlight) return refillInFlight;
  const flight = (async () => {
    try {
      // Reap dead/wedged boxes first so the deficit is real and a fresh boot won't collide with a
      // stale msb record ("cannot start: already running"). listPoolBoxes reaps as a side effect.
      const available = await io.listPoolBoxes(cfg);
      const deficit = cfg.poolSize - available.length;
      if (deficit > 0) {
        console.error(`[pool] refilling: ${available.length}/${cfg.poolSize} ready — booting ${deficit}`);
        for (let i = 0; i < deficit; i++) {
          const name = await io.bootWarmBox(cfg);
          console.error(`[pool] warm box ready: ${name}`);
        }
      } else if (deficit < 0) {
        // A past double-refill left extras; keep the youngest (most run budget left), trim the rest.
        // Never trim a box an in-flight claim reserved: /.claimed lands only seconds after
        // `claiming.add`, and removing the box in that window kills the delegation that just picked it.
        const oldestFirst = [...available]
          .filter((b) => !claiming.has(b))
          .sort((a, b) => (poolBoxAgeMs(b) ?? Infinity) - (poolBoxAgeMs(a) ?? Infinity));
        for (const box of oldestFirst.slice(0, -deficit)) {
          console.error(`[pool] trimming surplus warm box ${box} (${available.length}/${cfg.poolSize} ready)`);
          await io.removeBox(cfg, box);
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
 * Start a background maintainer that keeps the pool topped to size. A claim-only reseed can't cover
 * a pool that drained on its own — an unclaimed box hitting max-duration, a boot that failed, or a
 * long lull. This periodic refill (which reaps dead boxes first, then boots the deficit) is what
 * makes a warm box ALWAYS ready. Returns a stop handle; unref'd so it never holds the process open.
 */
export function startPoolMaintainer(cfg: Config): { stop: () => void } {
  if (cfg.poolSize <= 0 || !cfg.snapshot || !cfg.egressAllowAll || cfg.poolRefillIntervalMs <= 0) {
    return { stop: () => {} };
  }
  console.error(
    `[pool] maintainer on: keeping ${cfg.poolSize} warm box(es) ready (every ${Math.round(
      cfg.poolRefillIntervalMs / 1000
    )}s)`
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
  const enabled = cfg.poolSize > 0 && !!cfg.snapshot && cfg.egressAllowAll;
  const boxes = enabled ? await listPoolBoxes(cfg) : [];
  return { size: cfg.poolSize, available: boxes.length, boxes, enabled };
}

/** Staging path helper re-export so index.ts has one import site for pool wiring. */
export { stagingPathFor };
