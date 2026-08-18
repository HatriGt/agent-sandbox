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
  agentProgress,
  exec,
  countBoxes as msbCountBoxes,
  status as msbStatus,
  teardown as msbTeardown,
  type AgentCreds,
} from "./msb.js";
import { newSessionId } from "./session.js";
import {
  loadStore,
  saveStore,
  ownerOf,
  candidateAccounts,
  decideAccess,
  upsertAccount,
  type Account,
  type TokenStore,
  type GitAccessResolution,
} from "./gh-token-store.js";
import { probeToken, canAccessRepo } from "./gh-probe.js";

/** GitHub owners this box works with, read from each repo's `origin` remote under /workspace. */
async function boxRepoOwners(cfg: Config, box: string): Promise<string[]> {
  const r = await exec(
    cfg,
    box,
    'for d in /workspace/*/; do git -C "$d" remote get-url origin 2>/dev/null; done'
  );
  const owners = new Set<string>();
  for (const url of r.stdout.split("\n")) {
    const o = ownerOf(url.trim());
    if (o) owners.add(o);
  }
  return [...owners];
}

/**
 * Live-confirm which stored accounts can access a repo. We pre-filter by cached access
 * (candidateAccounts) then probe each survivor with GitHub (access can change). Returns the
 * confirmed accounts. Cheap when the store is small.
 */
async function confirmedAccountsFor(
  cfg: Config,
  store: TokenStore,
  repo: string
): Promise<Account[]> {
  const pre = candidateAccounts(store, repo);
  const confirmed: Account[] = [];
  for (const acc of pre) {
    if (await canAccessRepo(cfg, acc.token, repo)) confirmed.push(acc);
  }
  return confirmed;
}

/**
 * Resolve GitHub access for every git repo in the plan. Precedence:
 *  1. githubToken provided -> probe it; if it can't reach a needed repo, ask again; else store + use.
 *  2. githubAccount provided -> use that stored account for repos it can access.
 *  3. otherwise per repo: confirmed accounts -> 1 use / many choose / 0 need-token (decideAccess).
 * On success returns owner->token for all repos + the primary token (first repo) for the gh CLI.
 */
async function resolveGitAccessImpl(
  cfg: Config,
  plan: DelegatePlan,
  opts: { githubToken?: string; githubAccount?: string }
): Promise<GitAccessResolution> {
  let store = await loadStore(cfg);
  const ownerTokens: Record<string, string> = {};
  let primaryToken: string | undefined;

  // A freshly provided token: probe against the FIRST repo (the one that triggered the ask), store
  // it by login, then let the normal per-repo resolution below pick it up.
  if (opts.githubToken?.trim()) {
    const probed = await probeToken(cfg, opts.githubToken.trim(), plan.repos[0].repo);
    if (!probed) {
      return {
        ok: false,
        question:
          "That token is invalid or expired (GitHub /user rejected it). Re-call delegate with a working githubToken.",
      };
    }
    store = upsertAccount(store, probed);
    await saveStore(cfg, store);
  }

  for (let i = 0; i < plan.repos.length; i++) {
    const repo = plan.repos[i].repo;
    const owner = ownerOf(repo);
    if (!owner) continue; // non-GitHub id (shouldn't happen for git source)

    const confirmed = await confirmedAccountsFor(cfg, store, repo);

    // Explicit account choice: honor it if that account can access this repo.
    if (opts.githubAccount?.trim()) {
      const chosen = confirmed.find((a) => a.login === opts.githubAccount!.trim());
      if (!chosen) {
        return {
          ok: false,
          question:
            `Account '${opts.githubAccount}' can't access ${repo}. ` +
            `Options that can: ${confirmed.map((a) => a.login).join(", ") || "(none — provide githubToken)"}.`,
        };
      }
      ownerTokens[owner] = chosen.token;
      if (i === 0) primaryToken = chosen.token;
      // Record the confirmed access for next time.
      store = upsertAccount(store, { ...chosen, verifiedRepos: [repo] });
      continue;
    }

    const decision = decideAccess(confirmed, repo);
    if (decision.kind === "use") {
      ownerTokens[owner] = decision.account!.token;
      if (i === 0) primaryToken = decision.account!.token;
      store = upsertAccount(store, { ...decision.account!, verifiedRepos: [repo] });
    } else {
      // choose or need_token — surface the question and stop.
      return { ok: false, question: decision.message! };
    }
  }

  // Persist any newly-recorded verifiedRepos.
  await saveStore(cfg, store);
  return { ok: true, ownerTokens, primaryToken };
}

export const deps: HandlerDeps = {
  countBoxes: (cfg) => msbCountBoxes(cfg),

  resolveGitAccess: (cfg, plan, opts) => resolveGitAccessImpl(cfg, plan, opts),

  async runDelegation(
    cfg: Config,
    plan: DelegatePlan,
    allowDomains?: string[],
    creds?: AgentCreds
  ): Promise<DelegationResult> {
    // Per-call egress extras merge onto the curated allowlist for this delegation only.
    const runCfg = allowDomains?.length
      ? { ...cfg, egressDomains: Array.from(new Set([...cfg.egressDomains, ...allowDomains])) }
      : cfg;

    const id = newSessionId();

    // `creds` (owner->token, primary) was resolved by the handler via resolveGitAccess for git
    // source. Used to CLONE private repos and for the in-box per-owner git credentials + `gh` CLI.

    // 1. Stage every repo into <sessionRoot>/<name> — rsync (local) or fresh git clone (remote).
    //    The whole session root is then copied into /workspace, so each repo -> /workspace/<name>.
    const sessionRoot = stagingPathFor(runCfg, id);
    for (const r of plan.repos) {
      const dest = repoStagingPath(runCfg, id, r.name);
      if (plan.source === "git") {
        // Clone with the owner's resolved token when we have one (private repos), else cfg default.
        const token = creds?.ownerTokens?.[ownerOf(r.repo) ?? ""] ?? runCfg.ghToken;
        await cloneRepoOnVps({ ...runCfg, ghToken: token }, r.repo, r.ref, id, dest);
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

    // Launch the agent DETACHED and return now — the run keeps going in the box. The caller polls
    // status(session) for progress/result. This is what fixes the MCP response timeout.
    await runAgentTask(runCfg, box, plan.task, plan.repos, creds);
    return {
      box,
      warm,
      output: "Task launched in the background. Poll with status(session) for progress and result.",
    };
  },

  async status(cfg, session) {
    const state = await msbStatus(cfg, session);
    const progress = await agentProgress(cfg, session);
    return `state:\n${state}\n\n${progress}`;
  },

  async resume(cfg, session, message, secrets) {
    // If a GitHub token is supplied here, probe + store it (login-keyed) so it's reusable later; it's
    // also injected ephemerally for this step via secrets. Best-effort capture (never breaks resume).
    if (secrets) {
      const token = (secrets.GITHUB_TOKEN || secrets.GH_TOKEN || "").trim();
      if (token) {
        try {
          const owners = await boxRepoOwners(cfg, session);
          const probeRepo = owners[0] ? `${owners[0]}/_probe` : "";
          const acc = await probeToken(cfg, token, probeRepo);
          if (acc) await saveStore(cfg, upsertAccount(await loadStore(cfg), acc));
        } catch {
          // capture is a convenience; ignore failures.
        }
      }
    }
    // Continues the in-box Claude session detached; poll status(session) for the result.
    await resumeAgentTask(cfg, session, message, undefined, secrets);
    return "Follow-up launched in the background. Poll with status(session) for progress and result.";
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

  async addGhToken(cfg, token, repo) {
    const tok = token?.trim();
    if (!tok) return "No token provided.";
    // Probe the token: validate (login), list orgs, and confirm access to `repo` if given.
    const acc = await probeToken(cfg, tok, repo ?? "");
    if (!acc) {
      return "That token is invalid or expired (GitHub /user rejected it).";
    }
    await saveStore(cfg, upsertAccount(await loadStore(cfg), acc));
    const orgs = acc.orgs.length ? ` orgs: ${acc.orgs.join(", ")}.` : "";
    const repoNote = repo
      ? acc.verifiedRepos.length
        ? ` Confirmed access to ${repo}.`
        : ` NOTE: this token could NOT access ${repo}.`
      : "";
    return `Stored GitHub account '${acc.login}' (${acc.type}).${orgs}${repoNote} It will be used automatically for repos it can access.`;
  },
};
