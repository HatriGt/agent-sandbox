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
  resolveToken,
  ownerOf,
  rememberOwnerToken,
  deriveLogin,
  saveStore,
} from "./gh-token-store.js";

/** GitHub token keys we recognize in resume `secrets` for permanent capture. */
const GH_SECRET_KEYS = ["GITHUB_TOKEN", "GH_TOKEN"];

/** The GitHub owners this box works with, read from each repo's `origin` remote under /workspace. */
async function boxOwners(cfg: Config, box: string): Promise<string[]> {
  const r = await exec(
    cfg,
    box,
    "for d in /workspace/*/; do git -C \"$d\" remote get-url origin 2>/dev/null; done"
  );
  const owners = new Set<string>();
  for (const url of r.stdout.split("\n")) {
    const o = ownerOf(url.trim());
    if (o) owners.add(o);
  }
  return [...owners];
}

/**
 * If resume `secrets` carries a GitHub token, PERMANENTLY store it keyed by every owner this box
 * touches (so future delegations to those owners are automatic). Also keyed by the token's own
 * login as a fallback. Best-effort — never throws into the resume path.
 */
async function captureResumeToken(
  cfg: Config,
  box: string,
  secrets?: Record<string, string>
): Promise<void> {
  if (!secrets) return;
  const key = GH_SECRET_KEYS.find((k) => secrets[k]?.trim());
  if (!key) return;
  const token = secrets[key].trim();
  try {
    const [owners, login] = await Promise.all([boxOwners(cfg, box), deriveLogin(cfg, token)]);
    let store = await loadStore(cfg);
    const keys = owners.length ? owners : login ? [login] : [];
    for (const owner of keys) store = rememberOwnerToken(store, owner, token, login);
    if (keys.length) await saveStore(cfg, store);
  } catch {
    // capture is a convenience; a failure must not break the resume.
  }
}

/**
 * Resolve GitHub creds for a set of repos from the persistent token store:
 *  - ownerTokens: owner -> token for every repo owner we have a token for (per-owner git creds).
 *  - primaryToken: token for the FIRST repo's owner (drives the `gh` CLI / PR creation).
 * Falls back to cfg.ghToken per owner. Returns undefined when nothing resolves (local-only / none).
 */
async function resolveCreds(
  cfg: Config,
  repos: Array<{ repo: string }>
): Promise<AgentCreds | undefined> {
  const store = await loadStore(cfg);
  const ownerTokens: Record<string, string> = {};
  for (const r of repos) {
    const owner = ownerOf(r.repo);
    if (!owner) continue;
    const tok = resolveToken(store, r.repo, cfg.ghToken);
    if (tok) ownerTokens[owner] = tok;
  }
  const primaryToken = resolveToken(store, repos[0]?.repo ?? "", cfg.ghToken);
  if (Object.keys(ownerTokens).length === 0 && !primaryToken) return undefined;
  return { ownerTokens, primaryToken };
}

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

    // Resolve per-owner GitHub tokens from the store up front: used both to CLONE private repos
    // (git source) and, later, for the in-box agent's per-owner git credentials + `gh` CLI.
    const creds = await resolveCreds(runCfg, plan.repos);

    // 1. Stage every repo into <sessionRoot>/<name> — rsync (local) or fresh git clone (remote).
    //    The whole session root is then copied into /workspace, so each repo -> /workspace/<name>.
    const sessionRoot = stagingPathFor(runCfg, id);
    for (const r of plan.repos) {
      const dest = repoStagingPath(runCfg, id, r.name);
      if (plan.source === "git") {
        // Clone with the owner's token when we have one (private repos), else cfg default.
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
    // If a GitHub token was supplied, remember it permanently (keyed by this box's repo owners) so
    // future delegations are automatic — while STILL injecting it ephemerally for this step.
    await captureResumeToken(cfg, session, secrets);
    // Reload creds so a just-captured token also flows in as per-owner git creds + gh CLI token.
    const owners = await boxOwners(cfg, session);
    const creds = await resolveCreds(cfg, owners.map((o) => ({ repo: `${o}/_` })));
    // Continues the in-box Claude session detached; poll status(session) for the result.
    await resumeAgentTask(cfg, session, message, undefined, secrets, creds);
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

  async addGhToken(cfg, token, owner) {
    const tok = token?.trim();
    if (!tok) return "No token provided.";
    // The token identifies itself; key under the explicit owner, else the derived login.
    const login = await deriveLogin(cfg, tok);
    const key = owner?.trim() || login;
    if (!key) {
      return "Could not validate the token (GET /user failed) and no owner was given. Pass owner explicitly.";
    }
    const store = await loadStore(cfg);
    await saveStore(cfg, rememberOwnerToken(store, key, tok, login));
    const who = login ? ` (login: ${login})` : "";
    return `Saved GitHub token for owner '${key}'${who}. Delegations to ${key}/* will use it automatically.`;
  },
};
