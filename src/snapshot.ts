/**
 * Step snapshots v0 — rewind an answered question (docs/features-2026-09.md §5).
 *
 * A failed run is pure waste; a wrong answer to an in-box question can only be re-run from zero.
 * This captures the box at its most decision-shaped moment — a pending question — so the operator
 * can answer DIFFERENTLY later: `resume({session, message, rewind: true})` restores the box to the
 * exact state it asked from (workspace + the Claude session in ~/.claude) and delivers the new
 * answer to that restored state.
 *
 * Mechanics, measured on the VPS (2026-09-01 spike):
 *   msb snapshot create --from <box> <name>   — needs a STOPPED box, ~1.3 s
 *   msb rm --force <box>                       — drop the diverged state
 *   msb run --from-snapshot <name> --name <box> … sleep infinity  — ~1.7 s, same name, so every
 *   status/resume/teardown path keeps working unchanged.
 *
 * Capture happens AT ANSWER TIME (resume of a waiting box), not on the waiting transition itself:
 * a waiting box is stopped→snapshotted→started around the answer, costing ~4 s once per answered
 * question and leaving un-answered pauses untouched for inspection. One snapshot per box — the
 * LAST answered question is the rewind point — replaced on each capture, deleted at teardown.
 * Gated behind SNAP_ASK=1 until the cost is validated in daily use.
 */
import type { Config } from "./config.js";

/** The one rewind snapshot a box carries. Same charset as box names, so CLI/filesystem-safe. */
export function askSnapName(box: string): string {
  return `snap-ask-${box}`;
}

/** Parse `msb snapshot ls` table output into names (header skipped, first column). */
export function parseSnapshotLs(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^NAME\s/.test(l))
    .map((l) => l.split(/\s+/)[0])
    .filter(Boolean);
}

/** Capture policy: only when the feature is on and the box is genuinely paused on a question. */
export function shouldCaptureBeforeAnswer(enabled: boolean, runState: string): boolean {
  return enabled && runState === "waiting";
}

/** Feature flag: SNAP_ASK=1. Read from env (not Config) so it needs no config plumbing while v0. */
export function snapAskEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SNAP_ASK === "1";
}

/* ── IO: the msb verbs, injected-runner style so deps can wire the real msb ── */

export interface SnapshotIo {
  /** Run msb with argv; non-zero exit resolves (never throws) with the code. */
  msb(args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  log?: (msg: string) => void;
}

/**
 * Capture the rewind point of a WAITING box: stop → snapshot (replacing the previous one) → start.
 * Best-effort by contract: any failure logs and returns false — an answer must never be blocked by
 * snapshot trouble.
 */
export async function captureAskSnapshot(io: SnapshotIo, box: string): Promise<boolean> {
  const log = io.log ?? (() => {});
  const name = askSnapName(box);
  try {
    const stop = await io.msb(["stop", box]);
    if (stop.code !== 0) {
      log(`[snap] stop ${box} failed: ${stop.stderr.trim().slice(-200)}`);
      return false;
    }
    await io.msb(["snapshot", "rm", name]); // replace: ignore "not found"
    const create = await io.msb(["snapshot", "create", "--from", box, name]);
    // Restart regardless — the box must come back even when the snapshot failed.
    const start = await io.msb(["start", box]);
    if (start.code !== 0) log(`[snap] restart of ${box} failed: ${start.stderr.trim().slice(-200)}`);
    if (create.code !== 0) {
      log(`[snap] create ${name} failed: ${create.stderr.trim().slice(-200)}`);
      return false;
    }
    return true;
  } catch (e) {
    log(`[snap] capture on ${box} errored: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Rewind a box to its captured pause point: rm the diverged box, boot from the snapshot under the
 * SAME name (so every session id keeps resolving), with the run flags the caller supplies (memory,
 * egress, timeouts — the same ones createBox uses). Throws with a plain message when there is no
 * snapshot; the caller surfaces that as a question, not a crash.
 */
export async function rewindToAskSnapshot(
  io: SnapshotIo,
  box: string,
  runFlags: string[]
): Promise<void> {
  const name = askSnapName(box);
  const ls = await io.msb(["snapshot", "ls"]);
  if (!parseSnapshotLs(ls.stdout).includes(name)) {
    throw new Error(
      `rewind: no snapshot exists for '${box}'. A rewind point is captured when a question is answered with SNAP_ASK=1 — this box has none.`
    );
  }
  const rm = await io.msb(["rm", "--force", box]);
  if (rm.code !== 0) throw new Error(`rewind: could not remove the current box: ${rm.stderr.trim().slice(-200)}`);
  const run = await io.msb(["run", "-d", "--name", box, ...runFlags, "--from-snapshot", name, "--", "sleep", "infinity"]);
  if (run.code !== 0) throw new Error(`rewind: boot from snapshot failed: ${run.stderr.trim().slice(-200)}`);
}

/** Drop a box's rewind snapshot (teardown path; ignore "not found"). */
export async function dropAskSnapshot(io: SnapshotIo, box: string): Promise<void> {
  await io.msb(["snapshot", "rm", askSnapName(box)]).catch(() => {});
}

/**
 * The run flags a rewound box boots with — createBox's common flags, INCLUDING the same egress
 * policy (a rewind must never widen a restricted box to open egress; the snapshot carries the
 * workspace, not the network rules).
 */
export function rewindRunFlags(cfg: Config): string[] {
  const egress = cfg.egressAllowAll
    ? ["--net", "public"]
    : ["--net-default-egress", "deny", "--net-rule", "allow@dns", ...cfg.egressDomains.flatMap((d) => ["--net-rule", `allow@${d}:tcp:443`])];
  return ["-m", cfg.memory, "--max-memory", cfg.memory, ...egress, "--idle-timeout", cfg.idleTimeout, "--max-duration", cfg.maxDuration, "--pull", "never"];
}
