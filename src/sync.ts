/**
 * Push the local working tree (including uncommitted changes) to a staging dir on the VPS.
 *
 * The MCP runs on the VPS but your editable tree is local, so before `msb run --copy-dir`
 * can bake the repo into a box we must get the current tree onto the VPS. We rsync over SSH
 * and honor .gitignore so build artifacts / node_modules don't get shipped.
 *
 * .git IS included so the in-box agent can inspect history and later commit/push.
 */
import path from "node:path";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts, rsyncSshFlag } from "./ssh.js";
import type { Config } from "./config.js";

/** Remote staging path (session root) for a given session. Holds one subdir per repo. */
export function stagingPathFor(cfg: Config, session: string): string {
  assertBoxName(session);
  const p = path.posix.join(cfg.vpsStagingDir, session);
  if (!p.startsWith(cfg.vpsStagingDir.replace(/\/+$/, "") + "/")) throw new Error(`staging path escapes ${cfg.vpsStagingDir}`);
  return p;
}

/** Box / session names are `[A-Za-z0-9_.-]+`, never "." or "..": they become directory names and shell words. */
export const BOX_NAME_RE = /^(?!\.\.?$)[\w.-]{1,128}$/;
export function isBoxName(s: unknown): s is string {
  return typeof s === "string" && BOX_NAME_RE.test(s);
}
export function assertBoxName(s: string): void {
  if (!isBoxName(s)) throw new Error("invalid box name");
}

/** Remote staging path for a single repo within a session: <sessionRoot>/<name>. */
export function repoStagingPath(cfg: Config, session: string, name: string): string {
  return path.posix.join(cfg.vpsStagingDir, session, name);
}

/** Remove a staging dir on the VPS (best-effort; staging is transient after copy-in). */
export async function cleanupStaging(cfg: Config, staging: string): Promise<void> {
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `rm -rf ${shellQuote(staging)}`], {
    check: false,
  });
}

/**
 * rsync `${repo}/` -> `${VPS_SSH}:${dest}/`.
 * `dest` defaults to the session root (single-repo); multi-repo callers pass the per-repo subdir.
 * Returns the remote path that was written.
 */
export async function syncTreeToVps(
  cfg: Config,
  repo: string,
  session: string,
  dest?: string
): Promise<string> {
  const remote = dest ?? stagingPathFor(cfg, session);

  // Ensure the remote staging dir exists (multiplexed ssh; path quoted for the remote shell).
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `mkdir -p ${shellQuote(remote)}`]);

  // Trailing slash on source => copy contents into remote dir (not a nested subdir).
  const src = repo.endsWith("/") ? repo : `${repo}/`;

  await run("rsync", [
    "-az",
    "--delete",
    // Route rsync's transport through the same multiplexed master connection.
    "-e",
    rsyncSshFlag(cfg),
    // Honor .gitignore, but keep .git itself so history/commit works in-box.
    "--filter=:- .gitignore",
    "--filter=+ /.git/**",
    src,
    `${cfg.vpsSsh}:${remote}/`,
  ]);

  return remote;
}
