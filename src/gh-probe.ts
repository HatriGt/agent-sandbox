/**
 * Live GitHub token probing (runs curl on the VPS so it works even when the client can't reach
 * GitHub). Given a token we determine: is it valid, what account (login) is it, which orgs does it
 * belong to, and can it access a specific repo. The results populate the login-keyed token store.
 *
 * Pure parsers (tokenType/parseLogin/parseOrgs) are unit-tested; the probe* functions do IO.
 */
import { shellQuote } from "./exec.js";
import { run } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import { ownerOf, type Account, type TokenType } from "./gh-token-store.js";
import type { Config } from "./config.js";

/** Classify a token by its prefix. Best-effort; only affects display. */
export function tokenType(token: string): TokenType {
  if (/^github_pat_/.test(token)) return "fine-grained";
  if (/^gh[po]_/.test(token)) return "classic";
  return "unknown";
}

/** Pull the "login" field out of a GET /user JSON body. */
export function parseLogin(body: string): string | undefined {
  const m = body.match(/"login"\s*:\s*"([^"]+)"/);
  return m ? m[1] : undefined;
}

/** Pull every "login" from a GET /user/orgs JSON array. */
export function parseOrgs(body: string): string[] {
  const out: string[] = [];
  const re = /"login"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

/** A GitHub API path we are willing to put in a URL: absolute, and only URL-safe characters. */
export function isSafeApiPath(path: string): boolean {
  return /^\/[\w./%?=&+,:@-]*$/.test(path);
}

/** curl a GitHub API path on the VPS with the token; returns the response body (empty on failure). */
async function ghGet(cfg: Config, token: string, path: string): Promise<string> {
  // Token and path are caller-supplied; both go through the VPS shell, so both are single-quoted.
  if (!isSafeApiPath(path)) return "";
  const remote =
    `curl -sf -H ${shellQuote(`Authorization: token ${token}`)} ` +
    `-H "Accept: application/vnd.github+json" ${shellQuote(`https://api.github.com${path}`)}`;
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remote], { check: false });
  return r.stdout ?? "";
}

/** GET a GitHub API path as parsed JSON (undefined when the body is not JSON / the call failed). */
export async function ghGetJson<T>(cfg: Config, token: string, path: string): Promise<T | undefined> {
  const body = await ghGet(cfg, token, path);
  try {
    return body ? (JSON.parse(body) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** True if the token can access the repo (GET /repos/{owner}/{name} returns 200 with a body). */
/**
 * Whether `owner/name` is a PUBLIC repo — an anonymous API call, no token involved. Lets delegate
 * proceed tokenless on public repos (read-only clone; no push identity injected) instead of
 * refusing with "no stored account can access it".
 */
export async function isPublicRepo(cfg: Config, repo: string): Promise<boolean> {
  const m = repo.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return false;
  const path = `/repos/${m[1]}/${m[2]}`;
  if (!isSafeApiPath(path)) return false;
  // -L: a transferred repo answers 301 Moved Permanently; the probe must follow to the new home
  // (git clone follows the same redirect, so a moved public repo still clones fine).
  const remote = `curl -sfL -H "Accept: application/vnd.github+json" ${shellQuote(`https://api.github.com${path}`)}`;
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remote], { check: false });
  try {
    const j = JSON.parse(r.stdout ?? "") as { private?: boolean; full_name?: string };
    return j.private === false;
  } catch {
    return false;
  }
}

export async function canAccessRepo(cfg: Config, token: string, repo: string): Promise<boolean> {
  const owner = ownerOf(repo);
  const name = repo.replace(/\.git$/i, "").split("/").filter(Boolean)[1];
  if (!owner || !name) return false;
  const body = await ghGet(cfg, token, `/repos/${owner}/${name}`);
  return /"full_name"\s*:/.test(body);
}

/**
 * Probe a token into an Account: validate it (GET /user -> login), list its orgs, and confirm it can
 * access `repo`. Returns undefined if the token is invalid (no login) — the caller then asks again.
 * `verifiedRepos` includes `repo` only when access is confirmed.
 */
export async function probeToken(
  cfg: Config,
  token: string,
  repo: string
): Promise<Account | undefined> {
  const userBody = await ghGet(cfg, token, "/user");
  const login = parseLogin(userBody);
  if (!login) return undefined; // invalid/expired token

  const [orgsBody, hasRepo] = await Promise.all([
    ghGet(cfg, token, "/user/orgs"),
    canAccessRepo(cfg, token, repo),
  ]);

  return {
    login,
    token,
    type: tokenType(token),
    orgs: parseOrgs(orgsBody),
    verifiedRepos: hasRepo ? [repo.replace(/\.git$/i, "")] : [],
  };
}
