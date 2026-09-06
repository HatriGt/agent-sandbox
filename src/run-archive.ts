import type { Db } from "./db.js";
import type { RunDigest } from "./digest.js";

/**
 * Run history archive (docs/roadmap-saas.md #7). A finished run used to evaporate at teardown; this
 * module persists a digest-shaped RECORD per finish so "what did my agents do" stays answerable.
 * Rows are records, never live state (PRODUCT.md principle 4): once written they are read, listed,
 * pruned, or deleted — never updated to track a box.
 *
 * All functions are synchronous better-sqlite3 calls over the controller db; callers are expected
 * to wrap them in try/catch when archiving must not break a hot path (the fleet sweep does).
 */

export interface ArchiveRecord {
  box: string;
  owner: string;
  digest: RunDigest;
  /** Wall-clock archive moment; defaults to Date.now(). Injectable for tests. */
  now?: number;
}

export interface ArchivedRunRow {
  id: number;
  box: string;
  owner: string;
  task: string;
  state: string;
  exitCode: number | null;
  startedAt: number | null;
  endedAt: number | null;
  archivedAt: number;
  headline: string;
}

/** When neither finish carries an endedAt stamp, two identical-looking finishes within this window
 *  are treated as the same observation (a sweep edge and the teardown fallback seeing one finish). */
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Insert one archive row for a finished run. Idempotent per observed finish, and re-finish-friendly:
 *
 * Dedupe rule — only the LATEST row for this box is consulted; skip the insert iff it is provably
 * the same finish:
 *   - both carry ended_at and they are equal. The stamp is the run's own clock (the trace's last
 *     plan sentinel); a resume that finishes again always moves it, so an equal stamp IS the same
 *     finish even when the two observations disagree on details (the sweep edge sees files, the
 *     teardown fallback can't list them, so headlines may differ); or
 *   - neither carries ended_at, AND (exit_code, headline) match, AND the existing row was archived
 *     within DEDUPE_WINDOW_MS (covers a stamp-less finish observed by both the sweep and teardown).
 * Anything else — a different or newer stamp, or a stamp-less record that differs or is old — is a
 * NEW finish and gets a new row. Consulting only the latest row means a box that re-finishes with an
 * identical outcome (same headline, same exit, new stamp) still records each finish.
 *
 * Returns the row id, or null when deduped.
 */
export function archiveRun(db: Db, rec: ArchiveRecord): number | null {
  const d = rec.digest;
  const now = rec.now ?? Date.now();
  const latest = db
    .prepare(`SELECT id, exit_code, ended_at, archived_at, headline FROM run_archive WHERE box = ? ORDER BY id DESC LIMIT 1`)
    .get(rec.box) as { id: number; exit_code: number | null; ended_at: number | null; archived_at: number; headline: string | null } | undefined;
  if (latest) {
    const sameStamp = latest.ended_at !== null && d.endedAt !== undefined && latest.ended_at === d.endedAt;
    const bothStampless =
      latest.ended_at === null &&
      d.endedAt === undefined &&
      latest.headline === d.headline &&
      (latest.exit_code ?? null) === (d.exitCode ?? null) &&
      now - latest.archived_at < DEDUPE_WINDOW_MS;
    if (sameStamp || bothStampless) return null;
  }
  const r = db
    .prepare(
      `INSERT INTO run_archive (box, owner, task, state, exit_code, started_at, ended_at, archived_at, headline, digest_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(rec.box, rec.owner, d.task, d.state, d.exitCode ?? null, d.startedAt ?? null, d.endedAt ?? null, now, d.headline, JSON.stringify(d));
  return Number(r.lastInsertRowid);
}

/** Reverse-chronological list for one owner. `before` pages by row id (exclusive). Cap 50. */
export function listRuns(db: Db, owner: string, opts: { limit?: number; before?: number } = {}): ArchivedRunRow[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 50);
  const rows = db
    .prepare(
      `SELECT id, box, owner, task, state, exit_code, started_at, ended_at, archived_at, headline
       FROM run_archive WHERE owner = ? ${opts.before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`
    )
    .all(...(opts.before ? [owner, opts.before, limit] : [owner, limit])) as Array<Record<string, unknown>>;
  return rows.map(toRow);
}

/** One record, owner-scoped, with the digest parsed back out of digest_json. */
export function getRun(db: Db, owner: string, id: number): (ArchivedRunRow & { digest: RunDigest | null }) | undefined {
  const r = db.prepare(`SELECT * FROM run_archive WHERE id = ? AND owner = ?`).get(id, owner) as Record<string, unknown> | undefined;
  if (!r) return undefined;
  let digest: RunDigest | null = null;
  try {
    digest = r.digest_json ? (JSON.parse(String(r.digest_json)) as RunDigest) : null;
  } catch {
    digest = null; // a corrupt row still lists; the detail degrades honestly
  }
  return { ...toRow(r), digest };
}

/** Owner-scoped delete. Returns true when a row was removed. */
export function deleteRun(db: Db, owner: string, id: number): boolean {
  return db.prepare(`DELETE FROM run_archive WHERE id = ? AND owner = ?`).run(id, owner).changes > 0;
}

/**
 * Retention: drop rows older than maxAgeDays (default 90), then trim each owner to their newest
 * maxRows (default 500). Called at startup and every ~6h.
 */
export function pruneArchive(db: Db, opts: { maxRows?: number; maxAgeDays?: number; now?: number } = {}): number {
  const now = opts.now ?? Date.now();
  const maxRows = opts.maxRows ?? 500;
  const maxAgeDays = opts.maxAgeDays ?? 90;
  let n = db.prepare(`DELETE FROM run_archive WHERE archived_at < ?`).run(now - maxAgeDays * 24 * 60 * 60 * 1000).changes;
  n += db
    .prepare(
      `DELETE FROM run_archive WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY owner ORDER BY id DESC) AS rn FROM run_archive
         ) WHERE rn > ?
       )`
    )
    .run(maxRows).changes;
  return n;
}

function toRow(r: Record<string, unknown>): ArchivedRunRow {
  return {
    id: Number(r.id),
    box: String(r.box ?? ""),
    owner: String(r.owner ?? ""),
    task: String(r.task ?? ""),
    state: String(r.state ?? ""),
    exitCode: r.exit_code === null || r.exit_code === undefined ? null : Number(r.exit_code),
    startedAt: r.started_at === null || r.started_at === undefined ? null : Number(r.started_at),
    endedAt: r.ended_at === null || r.ended_at === undefined ? null : Number(r.ended_at),
    archivedAt: Number(r.archived_at),
    headline: String(r.headline ?? ""),
  };
}
