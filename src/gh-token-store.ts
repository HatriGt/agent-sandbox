/**
 * Persistent, multi-account GitHub token store — maps a GitHub owner/org to the token that can
 * access it, so private-repo delegations reuse the right credential automatically with no prompts.
 *
 * Design (see docs/remote-mcp-plan.md):
 *  - Lives on the VPS at ~/.agent-sandbox/gh-tokens.json (chmod 600) — survives MCP respawns and
 *    sits on the same host that runs the boxes.
 *  - Keyed by OWNER (a token for `atom-insurance` is reused for every `atom-insurance/*` repo).
 *  - Tokens identify themselves: when a new one arrives we call GET /user to record its `login`,
 *    so the caller never types a username.
 *  - Pure helpers (ownerOf/parse/serialize/resolve/remember) are unit-tested; the load/save and
 *    deriveLogin do I/O over the same multiplexed SSH used everywhere else.
 */
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import type { Config } from "./config.js";

/** One stored credential: the token plus the GitHub login it authenticates as (for display). */
export interface OwnerCred {
  token: string;
  login?: string;
}

/** The on-disk store: owner/org -> credential. */
export interface TokenStore {
  owners: Record<string, OwnerCred>;
}

const EMPTY: TokenStore = { owners: {} };

/** Path to the store on the VPS (under the SSH user's home). */
const STORE_PATH = "$HOME/.agent-sandbox/gh-tokens.json";

/**
 * Extract the GitHub owner from a repo id (`owner/name`, a GitHub URL, or `owner/name.git`).
 * Returns undefined for a local filesystem path (no GitHub owner to key on).
 */
export function ownerOf(repo: string): string | undefined {
  const s = (repo ?? "").trim();
  if (!s) return undefined;
  // A local absolute path is not a GitHub repo.
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
  const owner = ownerName.split("/").filter(Boolean)[0];
  return owner || undefined;
}

/** Parse the JSON store; any malformed/missing content yields an empty store (never throws). */
export function parseStore(raw: string): TokenStore {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && obj.owners && typeof obj.owners === "object") {
      return { owners: { ...obj.owners } };
    }
  } catch {
    // fall through
  }
  return { owners: {} };
}

/** Serialize the store to pretty JSON. */
export function serializeStore(store: TokenStore): string {
  return JSON.stringify(store, null, 2);
}

/**
 * Resolve the token for a repo: the owner's stored token if present, else the provided default.
 * A local path (no owner) always falls back to the default.
 */
export function resolveToken(
  store: TokenStore,
  repo: string,
  fallback: string | undefined
): string | undefined {
  const owner = ownerOf(repo);
  if (owner && store.owners[owner]?.token) return store.owners[owner].token;
  return fallback;
}

/** Return a copy of the store with `owner` set to `token` (+optional login). Blanks are ignored. */
export function rememberOwnerToken(
  store: TokenStore,
  owner: string,
  token: string,
  login?: string
): TokenStore {
  if (!owner?.trim() || !token?.trim()) return store;
  return {
    owners: { ...store.owners, [owner.trim()]: { token: token.trim(), login } },
  };
}

// ----- VPS-backed I/O (over SSH) -------------------------------------------------------------

/** Load the store from the VPS (empty store if the file doesn't exist yet). */
export async function loadStore(cfg: Config): Promise<TokenStore> {
  const r = await run(
    "ssh",
    [...sshMuxOpts(cfg), cfg.vpsSsh, `cat ${STORE_PATH} 2>/dev/null || true`],
    { check: false }
  );
  return parseStore(r.stdout ?? "");
}

/** Persist the store to the VPS with tight perms (dir 700, file 600). Content passed via stdin. */
export async function saveStore(cfg: Config, store: TokenStore): Promise<void> {
  const json = serializeStore(store);
  // Write atomically: mkdir, write to a temp, chmod, move. Content is single-quoted for the shell.
  const remote =
    `mkdir -p "$HOME/.agent-sandbox" && chmod 700 "$HOME/.agent-sandbox" && ` +
    `printf '%s' ${shellQuote(json)} > ${STORE_PATH}.tmp && chmod 600 ${STORE_PATH}.tmp && ` +
    `mv ${STORE_PATH}.tmp ${STORE_PATH}`;
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remote]);
}

/**
 * Ask GitHub who a token belongs to (GET /user -> login). Runs from the VPS so it works even when
 * the client can't reach GitHub. Returns undefined if the token is invalid/unreachable.
 */
export async function deriveLogin(cfg: Config, token: string): Promise<string | undefined> {
  const remote =
    `curl -sf -H "Authorization: token ${token}" https://api.github.com/user ` +
    `| grep -o '"login"[ ]*:[ ]*"[^"]*"' | head -1 | sed 's/.*"login"[ ]*:[ ]*"\\([^"]*\\)".*/\\1/'`;
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remote], { check: false });
  const login = r.stdout.trim();
  return login || undefined;
}

/**
 * Store a token for one repo's owner: derive its login (best-effort) then persist owner->token.
 * Returns the owner it was stored under, or undefined if the repo has no GitHub owner (local path).
 */
export async function captureTokenForRepo(
  cfg: Config,
  repo: string,
  token: string
): Promise<string | undefined> {
  const owner = ownerOf(repo);
  if (!owner) return undefined;
  const login = await deriveLogin(cfg, token);
  const store = await loadStore(cfg);
  await saveStore(cfg, rememberOwnerToken(store, owner, token, login));
  return owner;
}
