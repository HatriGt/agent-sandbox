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
import type { RepoLayout } from "./agent-prompt.js";
import { syncTreeToVps, cleanupStaging, stagingPathFor, repoStagingPath } from "./sync.js";
import { cloneRepoInStaging, applyPatchInStaging } from "./git-source.js";
import { acquireBox, refillPool, poolEligible, poolStatus } from "./pool.js";
import {
  runAgentTask,
  resumeAgentTask,
  agentBoundary,
  exec,
  countBoxes as msbCountBoxes,
  status as msbStatus,
  teardown as msbTeardown,
  gatherMonitor,
  gatherWatch,
  askInBox,
  driverStateLine,
  type AgentCreds,
  execWithInput,
  WORKSPACE_DIRS_SH,
} from "./msb.js";
import { runInteractive } from "./interactive.js";
import { runVerification } from "./verify.js";
import { safeWorkspacePath } from "./artifact.js";
import { shellQuote } from "./exec.js";
import type { Interact } from "./handlers.js";
import { formatMonitor, formatWatch } from "./monitor.js";
import { formatAsk } from "./ask.js";
import { newSessionId } from "./session.js";
import {
  loadStore,
  saveStore,
  ownerOf,
  candidateAccounts,
  decideAccess,
  upsertAccount,
  pickDefaultAccount,
  type Account,
  type TokenStore,
  type GitAccessResolution,
} from "./gh-token-store.js";
import { probeToken, canAccessRepo } from "./gh-probe.js";
import { localRepoOwnerName, parseOwnerName } from "./git-remote.js";

/** Promise sleep for the block-until-boundary wait loop. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Drive an interactive delegation to completion inside the still-open tool call.
 *
 * When the client supports native elicitation (Cursor does — `interact.elicit` is set), the loop
 * turns each in-box question into a native prompt via `elicit`, feeds the answer back with
 * `resumeAgentTask`, and continues — so the whole ask→answer→continue conversation happens WITHOUT
 * the tool call ever returning (the protocol enforces the turn-taking; the agent can't wander off).
 * Progress notifications keep a long, question-less run alive.
 *
 * When the client can't elicit (other MCP clients / CI), the loop returns at the first question with
 * the poll-model fallback string so the caller can reconnect via `status`.
 */
async function driveInteractive(cfg: Config, box: string, interact?: Interact): Promise<string> {
  const r = await runInteractive({
    poll: () => agentBoundary(cfg, box),
    elicit: interact?.elicit,
    resume: async (answer: string) => {
      // Re-resolve per-repo identity/token (same as an explicit resume) so the continued run commits
      // as the access-correct account, then continue the in-box Claude session with the answer.
      const creds = await resolveCredsForBox(cfg, box);
      await resumeAgentTask(cfg, box, answer, undefined, undefined, creds);
    },
    progress: interact?.progress,
    sleep,
    timeoutMs: cfg.waitTimeoutMs,
    intervalMs: cfg.waitIntervalMs,
  });

  if (r.status === "waiting") {
    // Native server-side elicitation doesn't render in Cursor for this remote/async tool-call flow
    // (the client advertises the capability but auto-declines with no card). So we hand the question
    // back to the CALLING agent with an explicit, imperative protocol: show the user a native prompt
    // using ITS OWN question UI (which works), then resume the box with the answer. This achieves the
    // same in-loop, native-prompt UX on a path that actually works in Cursor. The box is STILL running
    // and waiting — this is NOT a cancellation.
    const q = (r.question ?? r.text).trim();
    return (
      `run:waiting — the sandbox agent PAUSED and is waiting for an answer (it is NOT cancelled/done).\n\n` +
      `QUESTION FROM THE SANDBOX:\n${q}\n\n` +
      `WHAT YOU (the calling agent) MUST DO NOW — do NOT end your turn:\n` +
      `1. Ask the USER this exact question using your native question UI (e.g. the AskQuestion tool) ` +
      `— UNLESS you can answer it confidently from repo/task context yourself.\n` +
      `2. Take the answer and call resume({session:"${box}", message:"<answer>"}).\n` +
      `3. resume blocks until the next question or completion — keep repeating 1–2 until run:done.\n` +
      `NEVER report this as cancelled, declined, or "I'll check back later" — it is actively waiting on you.`
    );
  }

  if (r.status === "running") {
    // The wait window elapsed with the box still working (no question yet). We returned here so the
    // tool call ends under the client's request timeout — the box keeps running. The calling agent
    // must reconnect (NOT end its turn) so it's present when the next question/result lands.
    return (
      `run:running — still working after ${Math.round(cfg.waitTimeoutMs / 1000)}s; NOT done, NOT cancelled.\n\n` +
      `WHAT YOU (the calling agent) MUST DO NOW — do NOT end your turn:\n` +
      `Immediately call status({session:"${box}"}) to keep waiting. It returns as soon as the box asks ` +
      `a question or finishes. Keep reconnecting until you get run:done. ` +
      `NEVER say "I'll report back later" — reconnect now.`
    );
  }
  return r.text; // done or cancelled
}

/**
 * Whether a session's box still exists. status/resume/ask on a torn-down or mistyped session used
 * to fall through to `msb exec`, whose failure surfaced as either a raw ssh command line (leaking
 * controller plumbing to the caller) or — worse — a fabricated "run:running, keep waiting" that
 * sent the calling agent into a reconnect loop against a box that was never coming back.
 */
async function boxExists(cfg: Config, box: string): Promise<boolean> {
  const s = await msbStatus(cfg, box);
  return !/sandbox not found/i.test(s);
}

const GONE = (box: string) =>
  `run:gone — no sandbox exists for session '${box}'. It was torn down, expired, or the id is ` +
  `mistyped. Do NOT retry status/resume on it; start a new delegation with delegate(...) instead.`;

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
 * The repo dirs present under /workspace, as a RepoLayout. `ask` only has a box id, so this is how
 * the co-pilot learns where the repos are (a single repo means its dir is the natural cwd, matching
 * what the driver sees). Best-effort: an empty list just means "task-only box, /workspace is bare".
 */
async function boxRepoLayout(cfg: Config, box: string): Promise<RepoLayout[]> {
  try {
    const r = await exec(cfg, box, WORKSPACE_DIRS_SH);
    return r.stdout
      .split("\n")
      .map((n) => n.trim())
      .filter((n) => n && n !== "*")
      .map((name) => ({ name }));
  } catch {
    return [];
  }
}

/**
 * Read each in-box repo dir and its GitHub `owner/name` from the origin remote. Used by resume to
 * re-resolve access (identity + token) since resume only has a box id, not the original plan.
 * Returns [{name, repo}] where name is the /workspace/<name> dir and repo is canonical owner/name.
 */
async function boxRepoRefs(cfg: Config, box: string): Promise<Array<{ name: string; repo: string }>> {
  const r = await exec(
    cfg,
    box,
    'for d in /workspace/*/; do n=$(basename "$d"); u=$(git -C "$d" remote get-url origin 2>/dev/null); ' +
      'if [ -n "$u" ]; then echo "$n|$u"; fi; done'
  );
  const out: Array<{ name: string; repo: string }> = [];
  for (const line of r.stdout.split("\n")) {
    const [name, url] = line.split("|");
    if (!name || !url) continue;
    const ref = parseOwnerName(url.trim());
    if (ref) out.push({ name, repo: ref });
  }
  return out;
}

/**
 * Resolve per-repo identity/token for the repos already in a box (resume path). Mirrors delegate's
 * resolution: for each repo, find the stored account with access and record owner->token/login and
 * name->owner. Best-effort — a repo with no resolvable account is skipped (no default identity).
 */
export async function resolveCredsForBox(cfg: Config, box: string): Promise<AgentCreds | undefined> {
  const refs = await boxRepoRefs(cfg, box);
  const store = await loadStore(cfg);
  // Task-only box (no repo dirs): delegate injected the store's DEFAULT account as GH_TOKEN so `gh`
  // could read PRs etc. Resume must do the same, or the second turn silently loses GitHub auth —
  // the agent then stops to ask for a credential the controller already holds.
  if (refs.length === 0) {
    const d = pickDefaultAccount(store);
    return d ? { primaryToken: d.token, primaryLogin: d.login } : undefined;
  }
  const ownerTokens: Record<string, string> = {};
  const ownerLogins: Record<string, string> = {};
  const repoOwners: Record<string, string> = {};
  let primaryToken: string | undefined;
  let primaryLogin: string | undefined;
  for (let i = 0; i < refs.length; i++) {
    const { name, repo } = refs[i];
    const owner = ownerOf(repo);
    if (!owner) continue;
    repoOwners[name] = owner;
    const confirmed = await confirmedAccountsFor(cfg, store, repo);
    if (confirmed.length !== 1) continue; // 0 or ambiguous -> no identity (resume can't ask mid-run)
    ownerTokens[owner] = confirmed[0].token;
    ownerLogins[owner] = confirmed[0].login;
    if (i === 0) {
      primaryToken = confirmed[0].token;
      primaryLogin = confirmed[0].login;
    }
  }
  // Repos present but none resolved to an account (e.g. a public clone): still give `gh` a default
  // account so read-only GitHub calls work, without assigning any per-repo commit identity.
  if (!primaryToken) {
    const d = pickDefaultAccount(store);
    if (d) {
      primaryToken = d.token;
      primaryLogin = d.login;
    }
  }
  if (!primaryToken && Object.keys(ownerTokens).length === 0 && Object.keys(repoOwners).length === 0) return undefined;
  return { ownerTokens, ownerLogins, repoOwners, primaryToken, primaryLogin };
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
  const ownerLogins: Record<string, string> = {};
  let primaryToken: string | undefined;
  let primaryLogin: string | undefined;

  // Task-only (no repos): there's no repo to match by access, but a bare task often still needs to
  // reach GitHub (read a private PR, clone something the task names). Inject a DEFAULT account's token
  // as GH_TOKEN so `gh`/`curl` work, without setting any per-repo commit identity (there is no repo).
  // An explicit githubToken/githubAccount overrides the default.
  if (plan.repos.length === 0) {
    if (opts.githubToken?.trim()) {
      const probed = await probeToken(cfg, opts.githubToken.trim(), "");
      if (probed) {
        store = upsertAccount(store, probed);
        await saveStore(cfg, store);
        return { ok: true, ownerTokens, ownerLogins, primaryToken: probed.token, primaryLogin: probed.login };
      }
    }
    const chosen = opts.githubAccount?.trim()
      ? store.accounts[opts.githubAccount.trim()]
      : pickDefaultAccount(store);
    if (chosen) {
      return { ok: true, ownerTokens, ownerLogins, primaryToken: chosen.token, primaryLogin: chosen.login };
    }
    return { ok: true, ownerTokens, ownerLogins };
  }

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
    // For git source the delegate arg IS owner/name. For local it's a filesystem path, so derive the
    // GitHub id from the working tree's origin remote — that's how we pick the access-correct account
    // (identity + push token) for a locally-shipped repo too.
    const repo =
      plan.source === "git"
        ? plan.repos[i].repo
        : (await localRepoOwnerName(plan.repos[i].repo)) ?? "";
    const owner = ownerOf(repo);
    if (!owner) continue; // no GitHub origin (e.g. a local-only repo) — nothing to resolve/identity to set

    const confirmed = await confirmedAccountsFor(cfg, store, repo);

    // Explicit account choice: honor it if that account can access this repo.
    if (opts.githubAccount?.trim()) {
      const chosen = confirmed.find((a) => a.login === opts.githubAccount!.trim());
      if (!chosen) {
        // For local this is non-fatal (working tree already shipped); for git it's a hard stop.
        if (plan.source === "local") continue;
        return {
          ok: false,
          question:
            `Account '${opts.githubAccount}' can't access ${repo}. ` +
            `Options that can: ${confirmed.map((a) => a.login).join(", ") || "(none — provide githubToken)"}.`,
        };
      }
      ownerTokens[owner] = chosen.token;
      ownerLogins[owner] = chosen.login;
      if (i === 0) {
        primaryToken = chosen.token;
        primaryLogin = chosen.login;
      }
      // Record the confirmed access for next time.
      store = upsertAccount(store, { ...chosen, verifiedRepos: [repo] });
      continue;
    }

    const decision = decideAccess(confirmed, repo);
    if (decision.kind === "use") {
      ownerTokens[owner] = decision.account!.token;
      ownerLogins[owner] = decision.account!.login;
      if (i === 0) {
        primaryToken = decision.account!.token;
        primaryLogin = decision.account!.login;
      }
      store = upsertAccount(store, { ...decision.account!, verifiedRepos: [repo] });
    } else if (plan.source === "local") {
      // choose/need_token on local: don't block. Ship the tree with no injected identity for this
      // repo; the agent will ask for a token if a write actually needs one.
      continue;
    } else {
      // git: choose or need_token — surface the question and stop.
      return { ok: false, question: decision.message! };
    }
  }

  // Persist any newly-recorded verifiedRepos.
  await saveStore(cfg, store);
  return { ok: true, ownerTokens, ownerLogins, primaryToken, primaryLogin };
}

export const deps: HandlerDeps = {
  countBoxes: (cfg) => msbCountBoxes(cfg),

  resolveGitAccess: (cfg, plan, opts) => resolveGitAccessImpl(cfg, plan, opts),

  async runDelegation(
    cfg: Config,
    plan: DelegatePlan,
    allowDomains?: string[],
    creds?: AgentCreds,
    interact?: Interact
  ): Promise<DelegationResult> {
    // Per-call egress extras merge onto the curated allowlist for this delegation only.
    const runCfg = allowDomains?.length
      ? { ...cfg, egressDomains: Array.from(new Set([...cfg.egressDomains, ...allowDomains])) }
      : cfg;

    const id = newSessionId();

    // `creds` (owner->token/login) was resolved by the handler via resolveGitAccess (both sources).
    // Used to CLONE private repos and for the in-box per-owner git credentials, per-repo identity,
    // and `gh` CLI. No default account: if an owner didn't resolve, there's simply no token for it.

    // 1. Stage every repo into <sessionRoot>/<name> — rsync (local) or fresh git clone (remote).
    //    The whole session root is then copied into /workspace, so each repo -> /workspace/<name>.
    //    Also build name->owner so identity can be set per-repo dir in the box.
    //    TASK-ONLY (no repos): nothing is staged; the box boots with an empty /workspace and the
    //    agent just works on the task (e.g. "write a detailed report about X").
    const hasRepos = plan.repos.length > 0;
    const sessionRoot = hasRepos ? stagingPathFor(runCfg, id) : undefined;
    const repoOwners: Record<string, string> = {};
    try {
      for (const r of plan.repos) {
        const dest = repoStagingPath(runCfg, id, r.name);
        if (plan.source === "git") {
          const owner = ownerOf(r.repo);
          if (owner) repoOwners[r.name] = owner;
          // Clone with the owner's access-resolved token (private repos). No default fallback: a repo
          // that reached here without a token means resolution deemed it public/accessible.
          const token = owner ? creds?.ownerTokens?.[owner] : undefined;
          await cloneRepoInStaging({ ...runCfg, ghToken: token }, r.repo, r.ref, id, dest);
          // Uncommitted work from the caller's machine rides in as a diff over the fresh checkout.
          // A patch that doesn't apply aborts the delegation — never start a box on a half-applied tree.
          if (r.patch) await applyPatchInStaging(runCfg, dest, r.patch);
        } else {
          await syncTreeToVps(runCfg, r.repo, id, dest);
          // For local, derive the owner from the working tree's origin remote (best-effort).
          const on = await localRepoOwnerName(r.repo);
          const owner = on ? ownerOf(on) : undefined;
          if (owner) repoOwners[r.name] = owner;
        }
      }
    } catch (e) {
      // Staging failed mid-way (bad patch, clone error): what was already cloned/synced would
      // otherwise sit on the host forever — a full checkout of a private repo per failed attempt.
      if (sessionRoot) void cleanupStaging(runCfg, sessionRoot);
      throw e;
    }
    // Thread the name->owner map so applyGitCredentials can set per-repo identity.
    const runCreds: AgentCreds | undefined = creds ? { ...creds, repoOwners } : undefined;

    // 2. A restricted-egress delegation must not reuse an open-egress pooled box.
    const eligible = poolEligible(runCfg, !!allowDomains?.length);
    const { box, warm } = await acquireBox(runCfg, id, sessionRoot, eligible);

    // Operator attachments (pasted screenshots) land in the box before the agent's first tool call.
    for (const a of plan.attachments ?? []) {
      const safe = safeWorkspacePath(a.path);
      if (!safe.ok) throw new Error(`attachment: ${safe.message}`);
      const abs = `/workspace/${safe.relPath}`;
      const dir = abs.slice(0, abs.lastIndexOf("/"));
      await execWithInput(runCfg, box, `mkdir -p ${shellQuote(dir)} && base64 -d > ${shellQuote(abs)}`, a.base64.replace(/^data:[^,]*,/, ""));
    }

    // Staging is transient (already copied into the box). Clean it; refill pool on claim.
    if (sessionRoot) void cleanupStaging(runCfg, sessionRoot);
    if (warm) void refillPool(cfg);

    // Launch the agent DETACHED (the run keeps going in the box regardless), then BLOCK here until
    // it reaches an interactive boundary (asks a question / finishes) or the wait times out. The
    // open MCP call is the "listener" — this is what makes the calling agent wait for the box
    // instead of ending its turn. A timeout returns "still working, reconnect via status".
    await runAgentTask(runCfg, box, plan.task, plan.repos, runCreds);
    const output = await driveInteractive(runCfg, box, interact);
    return { box, warm, output };
  },

  async status(cfg, session, interact) {
    // status reconnects and drives the SAME interactive loop: on a client that can elicit, calling
    // status resumes the ask→answer→continue conversation; otherwise it blocks to the next boundary
    // and returns it. A quick box-level line is prefixed for context (running/stopped/gone).
    const box = await msbStatus(cfg, session);
    if (/sandbox not found/i.test(box)) return GONE(session);
    const progress = await driveInteractive(cfg, session, interact);
    return `state:\n${box}\n\n${progress}`;
  },

  async resume(cfg, session, message, secrets, interact) {
    if (!(await boxExists(cfg, session))) return GONE(session);
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
    // Re-resolve per-repo identity/token from the box's repos so the continued run commits as the
    // access-correct account (not a stale/baked identity). Same access model as delegate.
    const creds = await resolveCredsForBox(cfg, session);
    // Continue the in-box Claude session detached, then BLOCK until the next boundary (another
    // question, or done) or timeout — same turn-taking as delegate, so the answer→continue→next
    // step feels synchronous to the caller.
    await resumeAgentTask(cfg, session, message, undefined, secrets, creds);
    return driveInteractive(cfg, session, interact);
  },

  async resumeDetached(cfg, session, message, secrets) {
    // Same as `resume` minus the blocking wait for the next boundary: the dashboard streams the
    // transcript live, so it only needs the run to be kicked off. Returns as soon as claude is
    // started in the box (a few seconds: wake if asleep, inject creds, exec).
    const creds = await resolveCredsForBox(cfg, session);
    await resumeAgentTask(cfg, session, message, undefined, secrets, creds);
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

  async monitor(cfg) {
    return formatMonitor(await gatherMonitor(cfg));
  },

  async watch(cfg, session, lines) {
    return formatWatch(await gatherWatch(cfg, session, lines));
  },

  async ask(cfg, session, question, newThread) {
    if (!(await boxExists(cfg, session))) return GONE(session);
    // The co-pilot lane: a separate read-only Claude run in the same box. Deliberately does NOT go
    // through driveInteractive — that loop is the DRIVER's turn-taking, and touching it here would
    // be the one thing this feature exists to avoid.
    const repos = await boxRepoLayout(cfg, session);
    // Read-only gh needs a token (gh reads GH_TOKEN from env; nothing persists in the box) — give
    // the co-pilot the same default the driver would get, so `gh pr checks` etc. work.
    const creds = await resolveCredsForBox(cfg, session).catch(() => undefined);
    const [result, driver] = await Promise.all([
      askInBox(cfg, session, question, { newThread, repos, ghToken: creds?.primaryToken }),
      driverStateLine(cfg, session),
    ]);
    return formatAsk({ ...result, driverState: driver });
  },

  async verify(cfg, session, plan) {
    if (!(await boxExists(cfg, session))) {
      return { mode: plan.mode, pass: false, detail: `could not verify: no sandbox exists for session '${session}'` };
    }
    const repos = await boxRepoLayout(cfg, session);
    return runVerification(plan, {
      // Command mode: run in the driver's workdir; the exit code travels as a marker so the ssh
      // layer's non-zero-throws behaviour never turns a red test suite into a thrown exception.
      execCommand: async (cmd) => {
        const workdir = repos?.length === 1 ? `/workspace/${repos[0].name}` : "/workspace";
        const sh = `cd ${shellQuote(workdir)} && { ${cmd}\n} 2>&1 | tail -c 20000; echo "__VEXIT=$(( ${"$"}{PIPESTATUS[0]:-0} ))"`;
        const r = await exec(cfg, session, `bash -lc ${shellQuote(sh)}`);
        const m = r.stdout.match(/__VEXIT=(\d+)\s*$/);
        return { code: m ? Number(m[1]) : 1, output: r.stdout.replace(/__VEXIT=\d+\s*$/, "") };
      },
      // Criterion mode: one read-only co-pilot turn, fresh thread — the verifier must not inherit
      // an earlier ask conversation's framing.
      askCriterion: async (prompt) => {
        const creds = await resolveCredsForBox(cfg, session).catch(() => undefined);
        const r = await askInBox(cfg, session, prompt, { newThread: true, repos, ghToken: creds?.primaryToken });
        return { answer: r.answer };
      },
    });
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
