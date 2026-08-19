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
export async function acquireBox(
  cfg: Config,
  session: string,
  copyDir: string,
  eligible: boolean
): Promise<{ box: string; warm: boolean }> {
  if (eligible) {
    // listPoolBoxes already reaps dead/wedged boxes, so anything it returns is Running + free.
    const available = await listPoolBoxes(cfg);
    const warm = available[0];
    if (warm) {
      try {
        await claimWarmBox(cfg, warm, copyDir);
        return { box: warm, warm: true };
      } catch (e) {
        // The box went sideways between listing and claiming (desync). Don't hand back a dead box
        // that would show run:running while Stopped — reap it and fall through to a clean cold boot.
        console.error(`[pool] claim of ${warm} failed, reaping and cold-booting:`, e);
        await reapDeadPoolBoxes(cfg);
      }
    }
  }
  // Cold path: boot a box named after the session with the repo baked in / copied in.
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
    for (let i = 0; i < deficit; i++) {
      await bootWarmBox(cfg);
    }
  } catch (e) {
    console.error("[pool] refill failed:", e);
  }
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
