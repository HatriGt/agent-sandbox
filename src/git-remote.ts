/**
 * Read a local git repo's origin remote and normalize it to a GitHub `owner/name`.
 *
 * Needed for source=local: the delegate arg is a filesystem path, but to pick the access-correct
 * GitHub account (identity + push token) we must know the repo's owner. We read `origin` from the
 * working tree on the Mac and parse it. Both SSH and HTTPS remote forms are supported.
 *
 * The parser is pure (unit-tested); reading the remote shells out to `git -C <path>` locally.
 */
import { run } from "./exec.js";

/**
 * Parse a git remote URL into canonical `owner/name` (no `.git`). Supports:
 *   git@github.com:owner/name.git
 *   ssh://git@github.com/owner/name.git
 *   https://github.com/owner/name(.git)
 * Returns undefined for anything that isn't a two-segment GitHub-style path.
 */
export function parseOwnerName(remoteUrl: string): string | undefined {
  const s = (remoteUrl ?? "").trim();
  if (!s) return undefined;

  let path: string;
  const scp = s.match(/^[^@]+@[^:]+:(.+)$/); // git@host:owner/name(.git)
  if (scp) {
    path = scp[1];
  } else if (/^ssh:\/\//i.test(s) || /^https?:\/\//i.test(s)) {
    try {
      path = new URL(s).pathname;
    } catch {
      return undefined;
    }
  } else {
    return undefined;
  }

  path = path.replace(/^\/+/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : undefined;
}

/** Read the origin remote URL of a local git repo (empty string if none). */
export async function readOriginUrl(localPath: string): Promise<string> {
  const r = await run("git", ["-C", localPath, "remote", "get-url", "origin"], { check: false });
  return (r.stdout ?? "").trim();
}

/** Convenience: local path -> canonical GitHub `owner/name`, or undefined if not a GitHub origin. */
export async function localRepoOwnerName(localPath: string): Promise<string | undefined> {
  return parseOwnerName(await readOriginUrl(localPath));
}
