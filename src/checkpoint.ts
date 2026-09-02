/**
 * Per-message revert — Cursor-style checkpoints, but consistent where Cursor's aren't.
 *
 * Reverting a turn must restore THREE things together or the agent reasons from a false world:
 * the workspace files, the agent's session memory (~/.claude), and the visible thread (the
 * .agent.log the dashboard renders). All three are just files inside the box, and between turns
 * nothing mutates them — so a checkpoint is one in-box tar, taken ONLINE, ~1 s, zero downtime.
 * No VM stop/snapshot/boot (the v0 SNAP_ASK rewind's ~4 s + ~3 s costs), no host-side storage:
 * checkpoints live under /root/.agent-ckpt/ in the box's own disk and die with the box.
 *
 * Naming: turn N = N operator messages delivered (task = 1). Checkpoint t<N> = state after turn N
 * finished = the restore point for "revert to message N+1". Ring of 5, pruned oldest-first.
 *
 * Everything here is pure command-building + policy, unit-testable; the exec is injected.
 */

// OUTSIDE /workspace, deliberately: anything under /workspace shows up in the changes dock, the
// file tree and @-mention search (a new tar per turn read as noise there). /root is neither listed
// nor artifact-served, still dies with the box, and the workspace wipe can never eat the store.
export const CKPT_DIR = "/root/.agent-ckpt";
export const CKPT_KEEP = 5;

/** What a checkpoint must carry. .agent.* sentinels ride with /workspace automatically. */
const WORKSPACE = "/workspace";
const AGENT_HOME = "/root/.claude";

/** Shell-safe single-quote (same rule as msb.ts shellQuote). */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Capture checkpoint t<n>: tar workspace + agent memory into the store (outside both), then prune
 * the ring. `--warning=no-file-changed` + trailing `|| [ $? -eq 1 ]`: tar exits 1 for "file changed
 * as we read it", which between turns can only be the log tail — content-harmless, must not fail
 * capture. tmp+mv so a torn capture never looks like a valid restore point.
 */
export function captureCmd(n: number): string {
  const file = `${CKPT_DIR}/t${n}.tar`;
  return (
    `mkdir -p ${q(CKPT_DIR)} && ` +
    `tar -cf ${q(file + ".tmp")} --warning=no-file-changed ` +
    `-C / ${q(WORKSPACE.slice(1))} ${q(AGENT_HOME.slice(1))} 2>/dev/null || [ $? -eq 1 ] && ` +
    `mv ${q(file + ".tmp")} ${q(file)} && ` +
    pruneCmd() +
    ` && echo CKPT_OK t${n}`
  );
}

/** Keep the newest CKPT_KEEP checkpoints by turn number; remove the rest. */
export function pruneCmd(): string {
  return (
    `ls ${q(CKPT_DIR)} 2>/dev/null | grep -E '^t[0-9]+\\.tar$' | sort -t t -k2 -n | ` +
    `head -n -${CKPT_KEEP} | while read f; do rm -f ${q(CKPT_DIR)}/"$f"; done`
  );
}

/** List available checkpoint turn numbers from `ls` output of the checkpoint dir. */
export function parseCkptLs(stdout: string): number[] {
  return stdout
    .split("\n")
    .map((l) => l.trim().match(/^t(\d+)\.tar$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

export function listCmd(): string {
  return `ls ${q(CKPT_DIR)} 2>/dev/null || true`;
}

/**
 * Restore checkpoint t<n> in place: wipe workspace + agent home, untar, then append an honest seam
 * to the restored log so history shows the rewrite. The store lives outside /workspace, so the
 * wipe cannot touch it and later checkpoints stay available for a re-revert forward until the next
 * capture prunes them.
 */
export function revertCmd(n: number, discarded: number): string {
  const seam = `● reverted to an earlier point — ${discarded} later turn${discarded === 1 ? "" : "s"} discarded`;
  return (
    `[ -f ${q(`${CKPT_DIR}/t${n}.tar`)} ] || { echo CKPT_MISSING t${n}; exit 9; }; ` +
    `rm -rf ${WORKSPACE}/* ${WORKSPACE}/.[!.]* ${AGENT_HOME} 2>/dev/null; ` +
    `tar -xf ${q(`${CKPT_DIR}/t${n}.tar`)} -C / && ` +
    `printf '\\n%s\\n' ${q(seam)} >> /workspace/.agent.log && ` +
    `echo CKPT_RESTORED t${n}`
  );
}

/** Revert is only safe between turns — a running agent would fight the wipe. */
export function canRevert(runState: string): boolean {
  return runState === "done" || runState === "waiting" || runState === "idle";
}

/**
 * Which turn a revert to operator-message k restores: the state after turn k-1 finished.
 * k=1 (the task itself) has no earlier checkpoint — v1 says use "Run again" for that.
 */
export function checkpointForMessage(k: number): number | null {
  return k >= 2 ? k - 1 : null;
}

/* ── per-box serialization: capture, revert and resume must not interleave ── */

const locks = new Map<string, Promise<unknown>>();

/** Run `fn` after any in-flight checkpoint work on `box`; errors don't poison the chain. */
export function withBoxLock<T>(box: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(box) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    box,
    next.catch(() => {})
  );
  return next;
}
