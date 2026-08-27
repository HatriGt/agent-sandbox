/**
 * Claim markers — the controller's memory of which pool boxes carry a run, kept on the VPS host.
 *
 * Why: a warm box is claimed by touching `/.claimed` INSIDE it. Once it idle-stops, nothing can exec
 * into it to read that file, so the pool maintainer saw a Stopped `pool-*` box, called it dead, and
 * force-removed it — destroying a sleeping run the operator had been promised would wake on reply.
 * The marker lives OUTSIDE the box (`~/.agent-sandbox/claims/<box>`), so a stopped box's status as a
 * run is still knowable, and its mtime is the sleep clock: a claimed box asleep longer than
 * `MSB_SLEEP_TTL` is finally reaped (docs/lifecycle.md).
 */
import type { Config } from "./config.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";

const DIR = '"$HOME/.agent-sandbox/claims"';

async function ssh(cfg: Config, cmd: string): Promise<string> {
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, cmd], { check: false });
  return r.stdout ?? "";
}

/** Record that `box` carries a run (idempotent; refreshes nothing — the claim time is the first touch). */
export async function markClaimed(cfg: Config, box: string): Promise<void> {
  await ssh(cfg, `mkdir -p ${DIR} && chmod 700 ${DIR} && [ -e ${DIR}/${shellQuote(box)} ] || : > ${DIR}/${shellQuote(box)}`);
}

export async function unmarkClaimed(cfg: Config, box: string): Promise<void> {
  await ssh(cfg, `rm -f ${DIR}/${shellQuote(box)}`);
}

/** Every claimed box with the age of its claim in seconds. */
export async function listClaims(cfg: Config, now = Math.floor(Date.now() / 1000)): Promise<Map<string, number>> {
  const out = await ssh(cfg, `[ -d ${DIR} ] && cd ${DIR} && for f in *; do [ -f "$f" ] && printf '%s %s\\n' "$f" "$(stat -c %Y "$f")"; done || true`);
  return parseClaims(out, now);
}

export function parseClaims(stdout: string, now: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const [name, mtime] = line.trim().split(/\s+/);
    if (!name || name === "*" || !mtime) continue;
    const t = Number(mtime);
    if (Number.isFinite(t)) m.set(name, Math.max(0, now - t));
  }
  return m;
}

/**
 * The reaping decision for a NON-running pool box: keep it if it is a claimed run that has been
 * asleep for less than the sleep TTL; otherwise it is dead capacity (or an abandoned run) and goes.
 */
export function shouldKeepStopped(claimAgeSec: number | undefined, sleepTtlSec: number): boolean {
  return claimAgeSec !== undefined && claimAgeSec < sleepTtlSec;
}
