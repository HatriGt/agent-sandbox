/**
 * Login-keyed, access-based GitHub token store.
 *
 * One entry per ACCOUNT (GitHub login). Each records the token, its type, and the access we probed
 * (orgs it belongs to + repos we've confirmed). A repo is matched to a token by ACCESS, never by
 * guessing from the owner name — so a personal token that can reach several orgs "just works".
 *
 * Flow (see docs/remote-mcp-plan.md):
 *  - delegate(git): find candidate accounts for the repo; 1 -> use, many -> ask which login, 0 ->
 *    ask the user for a token. A provided token is PROBED (login+orgs+repo access), stored by login,
 *    then used. All cross-checks are live where correctness matters (see gh-probe.ts).
 *
 * Lives on the VPS at ~/.agent-sandbox/gh-tokens.json (chmod 600). Pure helpers are unit-tested; the
 * load/save do IO over the same multiplexed SSH used everywhere else.
 */
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import type { Config } from "./config.js";

export type TokenType = "classic" | "fine-grained" | "unknown";

/** One stored GitHub account: the token plus the access we've observed for it. */
export interface Account {
  login: string;
  token: string;
  type: TokenType;
  /** Orgs this account belongs to (from GET /user/orgs at store time). */
  orgs: string[];
  /** Repos we've confirmed this token can access (owner/name), accumulated over time. */
  verifiedRepos: string[];
}

/** The on-disk store: login -> account. */
export interface TokenStore {
  accounts: Record<string, Account>;
  /** Login the operator marked as the default for task-only runs; falls back to a heuristic. */
  defaultLogin?: string;
}

/** Path to the store on the VPS (under the SSH user's home). */
const STORE_PATH = "$HOME/.agent-sandbox/gh-tokens.json";

/** Extract the GitHub owner from a repo id; undefined for a local filesystem path. */
export function ownerOf(repo: string): string | undefined {
  const s = (repo ?? "").trim();
  if (!s) return undefined;
  if (s.startsWith("/") || s.startsWith("~") || s.startsWith(".")) return undefined;
  let ownerName = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      ownerName = new URL(s).pathname.replace(/^\/+/, "");
    } catch {
      return undefined;
    }
  }
  ownerName = ownerName.replace(/\.git$/i, "").replace(/\/+$/, "");
  return ownerName.split("/").filter(Boolean)[0] || undefined;
}

/** Canonical `owner/name` (lowercased) for comparison; undefined if not a two-part repo id. */
function canonicalRepo(repo: string): string | undefined {
  const s = (repo ?? "").trim();
  if (!s || s.startsWith("/") || s.startsWith("~") || s.startsWith(".")) return undefined;
  let on = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      on = new URL(s).pathname.replace(/^\/+/, "");
    } catch {
      return undefined;
    }
  }
  on = on.replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = on.split("/").filter(Boolean);
  return parts.length === 2 ? `${parts[0]}/${parts[1]}`.toLowerCase() : undefined;
}

/** Parse the JSON store; malformed/missing content yields an empty store (never throws). */
export function parseStore(raw: string): TokenStore {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && obj.accounts && typeof obj.accounts === "object") {
      const defaultLogin = typeof obj.defaultLogin === "string" && obj.accounts[obj.defaultLogin] ? obj.defaultLogin : undefined;
      return defaultLogin ? { accounts: { ...obj.accounts }, defaultLogin } : { accounts: { ...obj.accounts } };
    }
  } catch {
    // fall through
  }
  return { accounts: {} };
}

/** Serialize the store to pretty JSON. */
export function serializeStore(store: TokenStore): string {
  return JSON.stringify(store, null, 2);
}

/** Add/overwrite an account by login (immutably), UNIONing verifiedRepos with any existing entry. */
export function upsertAccount(store: TokenStore, acc: Account): TokenStore {
  if (!acc.login?.trim() || !acc.token?.trim()) return store;
  const prev = store.accounts[acc.login];
  const verifiedRepos = Array.from(
    new Set([...(prev?.verifiedRepos ?? []), ...(acc.verifiedRepos ?? [])])
  );
  return {
    ...store,
    accounts: {
      ...store.accounts,
      [acc.login]: { ...acc, verifiedRepos },
    },
  };
}

/** Remove an account; clears the default if it pointed at it. */
export function removeAccount(store: TokenStore, login: string): TokenStore {
  const { [login]: _gone, ...accounts } = store.accounts;
  const next: TokenStore = { accounts };
  if (store.defaultLogin && store.defaultLogin !== login) next.defaultLogin = store.defaultLogin;
  return next;
}

/** Mark an account as the default for task-only runs (must exist). */
export function setDefaultAccount(store: TokenStore, login: string): TokenStore {
  if (!store.accounts[login]) return store;
  return { ...store, defaultLogin: login };
}

/**
 * Accounts whose CACHED access covers the repo: the login owns it (owner === login), the repo's
 * owner is in the account's orgs, or the exact repo is in verifiedRepos. This is a fast pre-filter;
 * the caller live-probes the survivors to be certain (access can change).
 */
export function candidateAccounts(store: TokenStore, repo: string): Account[] {
  const owner = ownerOf(repo)?.toLowerCase();
  const canon = canonicalRepo(repo);
  if (!owner) return [];
  return Object.values(store.accounts).filter((a) => {
    if (a.login.toLowerCase() === owner) return true;
    if (a.orgs.some((o) => o.toLowerCase() === owner)) return true;
    if (canon && a.verifiedRepos.some((r) => r.toLowerCase() === canon)) return true;
    return false;
  });
}

/**
 * A sensible default account for a task-only run (no repo to match by access). Prefers the account
 * with the widest observed access (most orgs, then most verified repos), so `gh`/`curl` inside a
 * bare task can still reach the private repos the user has. Returns undefined only for an empty store.
 */
export function pickDefaultAccount(store: TokenStore): Account | undefined {
  const accounts = Object.values(store.accounts);
  if (accounts.length === 0) return undefined;
  if (store.defaultLogin && store.accounts[store.defaultLogin]) return store.accounts[store.defaultLogin];
  return [...accounts].sort((a, b) => {
    const byOrgs = (b.orgs?.length ?? 0) - (a.orgs?.length ?? 0);
    if (byOrgs !== 0) return byOrgs;
    return (b.verifiedRepos?.length ?? 0) - (a.verifiedRepos?.length ?? 0);
  })[0];
}

/** The decision after resolving candidate accounts for a repo. */
export interface AccessDecision {
  kind: "use" | "choose" | "need_token";
  account?: Account;
  /** Populated for choose/need_token: a plain-text question to return to the caller. */
  message?: string;
}

/**
 * Result of resolving GitHub access for a whole delegation (all git repos):
 *  - ok: every repo resolved to an account; ownerTokens maps owner->token for clone + in-box creds.
 *  - question: something needs the user (a token or a login choice) — surface this text and stop.
 */
export type GitAccessResolution =
  | {
      ok: true;
      ownerTokens: Record<string, string>;
      /**
       * owner -> GitHub login of the account with access to that owner's repo. Drives the PER-REPO
       * git commit identity in the box: each repo is authored by the account that can actually push
       * it. There is deliberately NO default/global identity.
       */
      ownerLogins: Record<string, string>;
      primaryToken?: string;
      /** GitHub login of the account behind primaryToken — drives the `gh` CLI default (GH_TOKEN). */
      primaryLogin?: string;
      question?: undefined;
    }
  | {
      ok: false;
      question: string;
      ownerTokens?: undefined;
      ownerLogins?: undefined;
      primaryToken?: undefined;
      primaryLogin?: undefined;
    };

/** Turn a candidate list into a decision: 1 -> use, many -> choose (ask login), 0 -> need a token. */
export function decideAccess(candidates: Account[], repo: string): AccessDecision {
  if (candidates.length === 1) return { kind: "use", account: candidates[0] };
  if (candidates.length > 1) {
    const logins = candidates.map((a) => a.login).join(", ");
    return {
      kind: "choose",
      message:
        `Multiple GitHub accounts can access ${repo}: ${logins}. ` +
        `Re-call delegate with githubAccount:"<login>" to pick one.`,
    };
  }
  return {
    kind: "need_token",
    message:
      `No stored GitHub account can access ${repo}. ` +
      `Re-call delegate with githubToken:"<a token that can access it>" — it will be validated, ` +
      `stored by its account login, and reused automatically next time.`,
  };
}

// ----- VPS-backed I/O (over SSH) -------------------------------------------------------------

// Same SSH hop as the MCP store: cache briefly, refresh on every write.
const CACHE_TTL_MS = 60_000;
let cached: { raw: string; at: number } | null = null;

/** Load the store from the VPS (empty store if the file doesn't exist yet). */
export async function loadStore(cfg: Config): Promise<TokenStore> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return parseStore(cached.raw);
  const r = await run(
    "ssh",
    [...sshMuxOpts(cfg), cfg.vpsSsh, `cat ${STORE_PATH} 2>/dev/null || true`],
    { check: false }
  );
  cached = { raw: r.stdout ?? "", at: Date.now() };
  return parseStore(r.stdout ?? "");
}

/** Persist the store to the VPS with tight perms (dir 700, file 600). */
export async function saveStore(cfg: Config, store: TokenStore): Promise<void> {
  const json = serializeStore(store);
  const remote =
    `mkdir -p "$HOME/.agent-sandbox" && chmod 700 "$HOME/.agent-sandbox" && ` +
    `printf '%s' ${shellQuote(json)} > ${STORE_PATH}.tmp && chmod 600 ${STORE_PATH}.tmp && ` +
    `mv ${STORE_PATH}.tmp ${STORE_PATH}`;
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remote]);
  cached = { raw: json, at: Date.now() };
}
