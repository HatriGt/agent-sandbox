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
import { createBox, bootWarmBox, listPoolBoxes, claimWarmBox, reapDeadPoolBoxes } from "./msb.js";
import { stagingPathFor } from "./sync.js";
import type { Config } from "./config.js";

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
    const available = await listPoolBoxes(cfg);
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

/**
 * Top the pool back up to poolSize with open-egress warm boxes. Fire-and-forget: errors are
 * logged to stderr and swallowed so a refill failure never breaks a delegation.
 */
export async function refillPool(cfg: Config): Promise<void> {
  if (cfg.poolSize <= 0 || !cfg.snapshot || !cfg.egressAllowAll) return;
  try {
    // Reap dead/wedged boxes first so the deficit is real and a fresh boot won't collide with a
    // stale msb record ("cannot start: already running"). listPoolBoxes reaps as a side effect.
    const available = await listPoolBoxes(cfg);
    const deficit = cfg.poolSize - available.length;
    if (deficit <= 0) return;
    console.error(`[pool] refilling: ${available.length}/${cfg.poolSize} ready — booting ${deficit}`);
    for (let i = 0; i < deficit; i++) {
      const name = await bootWarmBox(cfg);
      console.error(`[pool] warm box ready: ${name}`);
    }
  } catch (e) {
    console.error("[pool] refill failed:", e);
  }
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
