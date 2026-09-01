/**
 * git source — how the agent sandbox obtains code it cannot read from the caller's disk.
 *
 * A stdio controller ships the local working tree via rsync (sync.ts) because it runs ON the
 * caller's machine. Any other client (an agentic IDE over the HTTP entry, Claude web, CI) cannot
 * share a filesystem with the sandbox, so the sandbox instead clones a git repo/branch into the
 * per-session staging dir on its own host, then hands that path to the same acquireBox/copy flow.
 *
 * Uncommitted local work from such a caller arrives as a PATCH: the caller diffs its tree against
 * the pushed ref it asks us to clone, and applyPatchInStaging lays that diff over the fresh
 * checkout — so a half-finished feature can be continued in the sandbox without being pushed.
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
 * A caller-supplied diff has to stay small enough to travel through the MCP transport and the JSON
 * body parser. 8 MB covers any sane feature-in-progress; a diff bigger than that is usually a
 * generated-file or vendored-deps mistake the caller should exclude.
 */
export const MAX_PATCH_BYTES = 8 * 1024 * 1024;

/** git argv to apply a caller diff (on stdin) to the checkout at `dest`. */
export function buildApplyArgs(dest: string): string[] {
  // --index stages the result so the in-box agent's `git status`/`git diff HEAD` show the shipped
  // changes exactly as they'd look mid-feature. --whitespace=nowarn: the caller's tree is theirs.
  return ["-C", dest, "apply", "--index", "--whitespace=nowarn"];
}

/**
 * Lay a caller-generated `git diff` over the fresh checkout in the sandbox's staging dir, so
 * uncommitted work from the caller's machine rides into the box. The patch travels on stdin
 * (never argv / a remote command line), through the same multiplexed ssh as the clone.
 *
 * Throws with git's own stderr on failure — "does not apply" etc. must reach the caller verbatim,
 * and the box must not start on a half-applied tree.
 */
export async function applyPatchInStaging(cfg: Config, dest: string, patch: string): Promise<void> {
  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
    throw new Error(
      `patch too large (> ${MAX_PATCH_BYTES / 1024 / 1024} MB). Exclude generated/vendored files ` +
        `from the diff, or push the work to a branch and delegate that ref instead.`
    );
  }
  // A diff with no trailing newline is rejected by git; delegate callers routinely paste one.
  const body = patch.endsWith("\n") ? patch : patch + "\n";
  const gitCmd = ["git", ...buildApplyArgs(dest)].map(shellQuote).join(" ");
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, gitCmd], { input: body, check: false });
  if (r.code !== 0) {
    throw new Error(
      `The patch does not apply to the fresh checkout at ${dest.split("/").pop()}. ` +
        `Regenerate it against the same ref you delegate (git diff origin/<ref> --binary) and re-call. ` +
        `git said:\n${r.stderr.trim()}`
    );
  }
}

/**
 * Fresh shallow clone of `repo`@`ref` into the sandbox's per-session staging dir.
 * Returns the staging path (same shape stagingPathFor produces for rsync).
 */
export async function cloneRepoInStaging(
  cfg: Config,
  repo: string,
  ref: string | undefined,
  session: string,
  destOverride?: string
): Promise<string> {
  if (ref !== undefined && !isValidRef(ref)) {
    throw new Error(`Invalid ref '${ref}'.`);
  }
  const dest = destOverride ?? stagingPathFor(cfg, session);
  const url = buildCloneUrl(repo, cfg.ghToken);

  // Fresh clone: remove any stale dir first, then clone. Both run on the VPS over one ssh mux.
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `rm -rf ${shellQuote(dest)}`], {
    check: false,
  });

  let gitCmd = ["git", ...buildCloneArgs(url, ref, dest)].map(shellQuote).join(" ");
  // The token rides in the clone URL only for the clone itself. Afterwards the remote is reset to
  // the plain URL, so `git remote -v` inside the box never prints a credential (the agent's later
  // fetch/push authenticates through the per-owner credential store written at setup).
  if (cfg.ghToken) {
    const clean = buildCloneUrl(repo);
    gitCmd += ` && git -C ${shellQuote(dest)} remote set-url origin ${shellQuote(clean)}`;
  }
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, gitCmd]);

  return dest;
}
