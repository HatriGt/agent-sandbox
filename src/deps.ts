/**
 * Real HandlerDeps implementation — the side-effecting wiring shared by both entry points.
 *
 * runDelegation is the one branch point in Phase 1:
 *   - source "local": rsync the local working tree to the VPS staging dir (sync.ts).
 *   - source "git":   fresh shallow clone owner/name on the VPS (git-source.ts).
 * Both produce a staging path that acquireBox copies into the box; from there the flow is identical.
 */
import type { Config } from "./config.js";
import type { HandlerDeps, DelegationResult } from "./handlers.js";
import type { DelegatePlan } from "./delegate-input.js";
import { syncTreeToVps, cleanupStaging, stagingPathFor, repoStagingPath } from "./sync.js";
import { cloneRepoOnVps } from "./git-source.js";
import { acquireBox, refillPool, poolEligible, poolStatus } from "./pool.js";
import {
  runAgentTask,
  resumeAgentTask,
  exec,
  countBoxes as msbCountBoxes,
  status as msbStatus,
  teardown as msbTeardown,
} from "./msb.js";
import { newSessionId } from "./session.js";

export const deps: HandlerDeps = {
  countBoxes: (cfg) => msbCountBoxes(cfg),

  async runDelegation(
    cfg: Config,
    plan: DelegatePlan,
    allowDomains?: string[]
  ): Promise<DelegationResult> {
    // Per-call egress extras merge onto the curated allowlist for this delegation only.
    const runCfg = allowDomains?.length
      ? { ...cfg, egressDomains: Array.from(new Set([...cfg.egressDomains, ...allowDomains])) }
      : cfg;

    const id = newSessionId();

    // 1. Stage every repo into <sessionRoot>/<name> — rsync (local) or fresh git clone (remote).
    //    The whole session root is then copied into /workspace, so each repo -> /workspace/<name>.
    const sessionRoot = stagingPathFor(runCfg, id);
    for (const r of plan.repos) {
      const dest = repoStagingPath(runCfg, id, r.name);
      if (plan.source === "git") {
        await cloneRepoOnVps(runCfg, r.repo, r.ref, id, dest);
      } else {
        await syncTreeToVps(runCfg, r.repo, id, dest);
      }
    }

    // 2. A restricted-egress delegation must not reuse an open-egress pooled box.
    const eligible = poolEligible(runCfg, !!allowDomains?.length);
    const { box, warm } = await acquireBox(runCfg, id, sessionRoot, eligible);

    // Staging is transient (already copied into the box). Clean it; refill pool on claim.
    void cleanupStaging(runCfg, sessionRoot);
    if (warm) void refillPool(cfg);

    const result = await runAgentTask(runCfg, box, plan.task, plan.repos);
    return { box, warm, output: result.stdout.trim() || result.stderr.trim() };
  },

  async status(cfg, session) {
    const state = await msbStatus(cfg, session);
    const log = await exec(cfg, session, "tail -n 40 /workspace/.agent.log 2>/dev/null || true");
    return `state:\n${state}\n\nrecent log:\n${log.stdout.trim()}`;
  },

  async resume(cfg, session, message) {
    const result = await resumeAgentTask(cfg, session, message);
    return result.stdout.trim() || result.stderr.trim();
  },

  async teardown(cfg, session) {
    await msbTeardown(cfg, session, stagingPathFor(cfg, session));
  },

  async poolStatus(cfg) {
    const s = await poolStatus(cfg);
    if (!s.enabled) {
      return `Pool disabled (needs MSB_POOL_SIZE>0, a snapshot, and EGRESS_ALLOW_ALL=1). size=${s.size}`;
    }
    return `Pool ${s.available}/${s.size} ready${s.boxes.length ? `: ${s.boxes.join(", ")}` : ""}`;
  },
};
