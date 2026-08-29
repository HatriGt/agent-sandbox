/**
 * Repositories the connected GitHub accounts can reach — for the dashboard's repo picker, for
 * auto-attaching a repo the task merely NAMES, and for attaching a repo to a run already in flight.
 *
 *   · `listAccountRepos`  — GET /user/repos for every stored account (owner + collaborator + org
 *                           membership), merged and cached a few minutes. One call, many keystrokes.
 *   · `matchRepos`        — rank the list against a query the way a picker expects.
 *   · `inferRepos`        — "review the last PR in elseco deal service" → atom-insurance/elseco-deal-service.
 *                           Only exact-ish matches on the repo NAME (spaces/underscores ≈ hyphens),
 *                           never fuzzy, so a task never gets a repo it did not mean.
 *   · `attachRepoToBox`   — shallow-clone on the VPS with the account that can access the repo, copy
 *                           into the running box at /workspace/<name>, set that repo's git identity.
 *
 * Pure helpers are exported for tests; IO is injected or delegated to existing helpers.
 */
import { ownerKey } from "./user-store.js";
import type { Config } from "./config.js";
import { candidateAccounts, loadStore, pickDefaultAccount, type Account, type TokenStore } from "./gh-token-store.js";
import { canAccessRepo, ghGetJson } from "./gh-probe.js";
import { cloneRepoOnVps } from "./git-source.js";
import { repoDirName } from "./delegate-input.js";
import { applyGitCredentials, copyDirIntoBox, exec } from "./msb.js";
import { stagingPathFor } from "./sync.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";

export interface RepoInfo {
  /** owner/name */
  fullName: string;
  private: boolean;
  defaultBranch: string;
  /** ISO time of the last push, for recency ordering. */
  pushedAt?: string;
  /** Stored account(s) that can see it. */
  logins: string[];
  description?: string;
}

interface GhRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
  pushed_at?: string;
  description?: string | null;
  archived?: boolean;
}

/** Merge per-account listings: one entry per repo, logins unioned, newest push wins for metadata. */
export function mergeRepoLists(perAccount: Array<{ login: string; repos: GhRepo[] }>): RepoInfo[] {
  const byName = new Map<string, RepoInfo>();
  for (const { login, repos } of perAccount) {
    for (const r of repos) {
      if (!r?.full_name || r.archived) continue;
      const key = r.full_name.toLowerCase();
      const prev = byName.get(key);
      if (prev) {
        if (!prev.logins.includes(login)) prev.logins.push(login);
        continue;
      }
      byName.set(key, {
        fullName: r.full_name,
        private: !!r.private,
        defaultBranch: r.default_branch || "main",
        pushedAt: r.pushed_at ?? undefined,
        logins: [login],
        description: r.description ?? undefined,
      });
    }
  }
  return [...byName.values()].sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
}

/** Picker ranking: name prefix > name substring > owner/description substring; recency breaks ties. */
export function matchRepos(repos: RepoInfo[], query: string, limit = 30): RepoInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return repos.slice(0, limit);
  const scored: Array<[number, RepoInfo]> = [];
  repos.forEach((r, i) => {
    const full = r.fullName.toLowerCase();
    const name = full.slice(full.indexOf("/") + 1);
    let score: number | null = null;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (full.includes(q) || (r.description ?? "").toLowerCase().includes(q)) score = 2;
    if (score !== null) scored.push([score * 100_000 + i, r]);
  });
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, limit).map(([, r]) => r);
}

/** "elseco deal service" / "elseco_deal_service" / "ElsecoDealService" → "elseco-deal-service". */
function slug(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "");
}

/**
 * Which known repos does the task text name? Two signals, both exact on the repo name:
 *   1. an explicit `owner/name` token;
 *   2. the repo's name (as a hyphen slug) appearing in the slugged task text as a whole "word".
 * A bare name that several owners share is ambiguous and is NOT inferred (the picker exists for that).
 */
export function inferRepos(task: string, known: RepoInfo[]): RepoInfo[] {
  const text = task.toLowerCase();
  const slugged = `-${slug(task)}-`;
  const out: RepoInfo[] = [];
  const byName = new Map<string, RepoInfo[]>();
  for (const r of known) {
    const name = r.fullName.slice(r.fullName.indexOf("/") + 1).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), r]);
    if (text.includes(r.fullName.toLowerCase())) out.push(r);
  }
  for (const [name, rs] of byName) {
    if (name.length < 4) continue; // "api", "web": too generic to infer from prose
    if (rs.length !== 1) continue; // ambiguous across owners
    if (out.includes(rs[0])) continue;
    if (slugged.includes(`-${name}-`)) out.push(rs[0]);
  }
  return out;
}

/** Cached, store-driven listing. `fetchRepos(token)` is injected (GitHub over the VPS in production). */
export function makeRepoLister(
  cfg: Config,
  fetchRepos: (cfg: Config, token: string) => Promise<GhRepo[]>,
  opts: { ttlMs?: number; now?: () => number } = {}
) {
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  // One cache per owner: user A's repository list must never answer user B's picker.
  const caches = new Map<string, { at: number; logins: string; repos: RepoInfo[] }>();
  const inFlights = new Map<string, Promise<RepoInfo[]>>();

  return async function list(force = false): Promise<RepoInfo[]> {
    const owner = ownerKey();
    const store = await loadStore(cfg);
    const logins = Object.keys(store.accounts).sort().join(",");
    const cache = caches.get(owner);
    if (!force && cache && cache.logins === logins && now() - cache.at < ttl) return cache.repos;
    const inFlight = inFlights.get(owner);
    if (inFlight) return inFlight;
    const p = Promise.all(
      Object.values(store.accounts).map(async (a) => ({
        login: a.login,
        repos: await fetchRepos(cfg, a.token).catch(() => [] as GhRepo[]),
      }))
    )
      .then((per) => {
        const repos = mergeRepoLists(per);
        caches.set(owner, { at: now(), logins, repos });
        return repos;
      })
      .finally(() => {
        inFlights.delete(owner);
      });
    inFlights.set(owner, p);
    return p;
  };
}

/** GitHub: every repo the token's user owns, collaborates on, or sees through an org (first 300). */
export async function fetchGithubRepos(cfg: Config, token: string): Promise<GhRepo[]> {
  const out: GhRepo[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await ghGetJson<GhRepo[]>(
      cfg,
      token,
      `/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/** The stored account that can access `repo`: cached candidates first (probed), then the default. */
export async function accountForRepo(cfg: Config, store: TokenStore, repo: string): Promise<Account | undefined> {
  for (const acc of candidateAccounts(store, repo)) {
    if (await canAccessRepo(cfg, acc.token, repo)) return acc;
  }
  const d = pickDefaultAccount(store);
  if (d && (await canAccessRepo(cfg, d.token, repo))) return d;
  for (const acc of Object.values(store.accounts)) {
    if (acc === d) continue;
    if (await canAccessRepo(cfg, acc.token, repo)) return acc;
  }
  return undefined;
}

/**
 * Attach `repo`@`ref` to a running box: clone on the VPS with the right account, copy into
 * /workspace/<name>, set that repo's push credential + commit identity. Returns the in-box dir name.
 */
export async function attachRepoToBox(
  cfg: Config,
  box: string,
  repo: string,
  ref?: string
): Promise<{ name: string; login?: string }> {
  const store = await loadStore(cfg);
  const acc = await accountForRepo(cfg, store, repo);
  const name = repoDirName(repo);
  const owner = repo.split("/")[0]?.toLowerCase();

  // Refuse to overwrite a directory that already exists in the box.
  const exists = await exec(cfg, box, `test -e ${shellQuote(`/workspace/${name}`)} && echo yes || echo no`);
  if (exists.stdout.trim().endsWith("yes")) throw new Error(`/workspace/${name} already exists in this sandbox.`);

  const staging = `${stagingPathFor(cfg, box)}-attach-${name}`;
  try {
    await cloneRepoOnVps({ ...cfg, ghToken: acc?.token }, repo, ref, box, staging);
    await copyDirIntoBox(cfg, box, staging, `/workspace/${name}`);
    if (acc && owner) {
      await applyGitCredentials(cfg, box, {
        ownerTokens: { [owner]: acc.token },
        ownerLogins: { [owner]: acc.login },
        repoOwners: { [name]: owner },
        primaryToken: acc.token,
        primaryLogin: acc.login,
      });
    }
  } finally {
    await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `rm -rf ${shellQuote(staging)}`], { check: false });
  }
  return { name, login: acc?.login };
}
