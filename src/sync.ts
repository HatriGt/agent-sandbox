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

/** Remote staging path for a given session. */
export function stagingPathFor(cfg: Config, session: string): string {
  return path.posix.join(cfg.vpsStagingDir, session);
}

/** Remove a staging dir on the VPS (best-effort; staging is transient after copy-in). */
export async function cleanupStaging(cfg: Config, staging: string): Promise<void> {
  await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `rm -rf ${shellQuote(staging)}`], {
    check: false,
  });
}

/**
 * rsync `${repo}/` -> `${VPS_SSH}:${staging}/`.
 * Returns the remote staging path (what --copy-dir will point at).
 */
export async function syncTreeToVps(
  cfg: Config,
  repo: string,
  session: string
): Promise<string> {
  const remote = stagingPathFor(cfg, session);

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
