/**
 * The host's disk: the one level above the box that nobody watched. The sandboxes, snapshots and
 * images all live under the microsandbox home on the VPS; when it fills, every box boot fails at
 * once, which is the box-disk outage again with a bigger blast radius. Two pure pieces:
 *
 *   - the `df` reading and the alert threshold (http.ts polls it and tells the operator once);
 *   - the orphan rule: a sandbox directory the runtime no longer lists is garbage — msb keeps its
 *     state in its own db, and a dir without a record is never booted again — but only once it is
 *     a day old, so a box mid-creation (dir made, record not yet written) is never swept.
 *
 * The IO (one `df`, one `ls`, one `rm -rf` on the host, all over the controller's SSH) is in msb.ts.
 */

export interface DiskReading {
  totalMib: number;
  usedMib: number;
  availMib: number;
  /** Percent used as df reports it (which accounts for root's reserved blocks). */
  usedPct: number;
}

/** Parse `df -Pk <path>` output (POSIX format: one header line, one data line). */
export function parseDfPk(stdout: string): DiskReading | undefined {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => /^\S+\s+\d+\s+\d+\s+\d+\s+\d+%/.test(l));
  if (!line) return undefined;
  const [, totalK, usedK, availK, pct] = line.split(/\s+/);
  const r = { totalMib: Math.round(Number(totalK) / 1024), usedMib: Math.round(Number(usedK) / 1024), availMib: Math.round(Number(availK) / 1024), usedPct: Number(pct.replace("%", "")) };
  return Number.isFinite(r.totalMib) && Number.isFinite(r.usedPct) && r.totalMib > 0 ? r : undefined;
}

export const HOST_DISK_ALERT_PCT = 85;

/** Above the line means "say something"; the caller owns the cooldown. */
export function hostDiskAlarmed(r: DiskReading | undefined, thresholdPct = HOST_DISK_ALERT_PCT): boolean {
  return !!r && r.usedPct >= thresholdPct;
}

export interface SandboxDirEntry {
  name: string;
  /** Directory mtime, epoch seconds. */
  mtimeSec: number;
}

export const ORPHAN_MIN_AGE_SEC = 24 * 3600;

/**
 * Which sandbox dirs to remove: not in the runtime's own listing AND older than a day. Names are
 * matched exactly; anything that is not a plain box name is left alone (never `rm -rf` a surprise).
 */
export function orphanSandboxDirs(dirs: readonly SandboxDirEntry[], listed: readonly string[], nowSec: number, minAgeSec = ORPHAN_MIN_AGE_SEC): string[] {
  const live = new Set(listed);
  return dirs
    .filter((d) => /^[A-Za-z0-9][\w.-]{0,100}$/.test(d.name) && !live.has(d.name) && nowSec - d.mtimeSec >= minAgeSec)
    .map((d) => d.name);
}

/** `find -maxdepth 1 -mindepth 1 -type d -printf '%f %T@\n'` → entries. Tolerates garbage lines. */
export function parseDirListing(stdout: string): SandboxDirEntry[] {
  const out: SandboxDirEntry[] = [];
  for (const raw of stdout.split("\n")) {
    const [name, t] = raw.trim().split(/\s+/);
    const mtime = Number(t);
    if (name && Number.isFinite(mtime)) out.push({ name, mtimeSec: Math.floor(mtime) });
  }
  return out;
}

export function hostDiskAlertText(r: DiskReading, home: string, publicUrl: string): string {
  const gib = (m: number) => (m / 1024).toFixed(1);
  const where = publicUrl ? ` ${publicUrl.replace(/\/+$/, "")}/dashboard/#/sandboxes` : "";
  return `Host disk at ${r.usedPct}% (${gib(r.availMib)} GiB free of ${gib(r.totalMib)} GiB under ${home}). New sandboxes will fail to boot when it fills — remove old snapshots or machines.${where}`;
}
