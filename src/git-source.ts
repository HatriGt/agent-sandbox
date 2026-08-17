/**
 * Phase 1 / Step 2 — git source for REMOTE delegations.
 *
 * The Mac (stdio) controller ships the local working tree via rsync (sync.ts). A remote client
 * (Claude web / phone / CI) can't see the Mac's files, so the HTTP controller instead clones a
 * git repo/branch ON the VPS into a per-session staging dir, then hands that path to the same
 * acquireBox/copy flow.
 *
 * Design (see docs/remote-mcp-plan.md):
 *  - Always a FRESH shallow clone into a per-session dir (never pull/reuse) so a claimed warm box
 *    or stale staging dir can't run the wrong code.
 *  - GitHub-only for now, behind buildCloneUrl so other hosts can be added later.
 *  - Pure helpers (normalize/build/validate) are unit-tested; the clone itself shells out over
 *    the same multiplexed SSH used everywhere else.
 */
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import { stagingPathFor } from "./sync.js";
import type { Config } from "./config.js";

/** Normalize `owner/name`, `https://github.com/owner/name(.git)` -> canonical `owner/name`. */
export function normalizeRepo(repo: string): string {
  const s = (repo ?? "").trim();
  if (!s) throw new Error("repo is required (owner/name or a GitHub https URL)");

  let ownerName = s;
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    ownerName = u.pathname.replace(/^\/+/, "");
  }
  ownerName = ownerName.replace(/\.git$/i, "").replace(/\/+$/, "");

  const parts = ownerName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo '${repo}'. Use owner/name or a full GitHub https URL.`);
  }
  return `${parts[0]}/${parts[1]}`;
}

/** Build the clone URL. With a token, embed it so private repos clone over HTTPS non-interactively. */
export function buildCloneUrl(repo: string, token?: string): string {
  const canonical = normalizeRepo(repo);
  if (token) {
    return `https://x-access-token:${token}@github.com/${canonical}.git`;
  }
  return `https://github.com/${canonical}.git`;
}

/** git argv for a fresh shallow clone into `dest`. Omits --branch when no ref (default branch). */
export function buildCloneArgs(url: string, ref: string | undefined, dest: string): string[] {
  const args = ["clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push(url, dest);
  return args;
}

/**
 * Validate a git ref before it's used. Blocks shell/arg injection (we pass argv, but the ref also
 * flows through ssh's remote shell) and git option-injection (leading '-').
 */
export function isValidRef(ref: string): boolean {
  if (!ref || ref.length > 200) return false;
  if (ref.startsWith("-")) return false; // option injection e.g. --upload-pack=
  return /^[A-Za-z0-9._\/-]+$/.test(ref);
}

/**
 * Fresh shallow clone of `repo`@`ref` on the VPS into the per-session staging dir.
 * Returns the remote staging path (same shape stagingPathFor produces for rsync).
 */
export async function cloneRepoOnVps(
  cfg: Config,
  repo: string,
  ref: string | undefined,
  session: string
): Promise<string> {
  if (ref !== undefined && !isValidRef(ref)) {
    throw new Error(`Invalid ref '${ref}'.`);
  }
  const dest = stagingPathFor(cfg, session);
  const url = buildCloneUrl(repo, cfg.ghToken);

  // Fresh clone: remove any stale dir first, then clone. Both run on the VPS over one ssh mux.
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `rm -rf ${shellQuote(dest)}`], {
    check: false,
  });

  const gitCmd = ["git", ...buildCloneArgs(url, ref, dest)].map(shellQuote).join(" ");
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, gitCmd]);

  return dest;
}
