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
  /** The run's full workspace diff (unified, workspace-relative paths), already redacted+capped. */
  diffText?: string;
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
 *   - neither carries ended_at, AND (state, exit_code) match, AND the existing row was archived
 *     within DEDUPE_WINDOW_MS (covers a stamp-less finish observed by both the sweep and teardown).
 *     Deliberately NOT compared here: the headline. It is derived from the file list, and the file
 *     list is exactly what the two observations disagree about — the sweep catches the box still up
 *     and lists changes, the teardown fallback finds it stopped and lists none. Comparing headlines
 *     made every stamp-less run archive twice ("done · 1 file" vs "done").
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
    .prepare(`SELECT id, state, exit_code, ended_at, archived_at FROM run_archive WHERE box = ? ORDER BY id DESC LIMIT 1`)
    .get(rec.box) as { id: number; state: string | null; exit_code: number | null; ended_at: number | null; archived_at: number } | undefined;
  if (latest) {
    const sameStamp = latest.ended_at !== null && d.endedAt !== undefined && latest.ended_at === d.endedAt;
    const bothStampless =
      latest.ended_at === null &&
      d.endedAt === undefined &&
      latest.state === d.state &&
      (latest.exit_code ?? null) === (d.exitCode ?? null) &&
      now - latest.archived_at < DEDUPE_WINDOW_MS;
    if (sameStamp || bothStampless) return null;
  }
  const r = db
    .prepare(
      `INSERT INTO run_archive (box, owner, task, state, exit_code, started_at, ended_at, archived_at, headline, digest_json, diff_text,
         started_by, trigger_id, agent, verified, input_tokens, output_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      rec.box, rec.owner, d.task, d.state, d.exitCode ?? null, d.startedAt ?? null, d.endedAt ?? null, now, d.headline, JSON.stringify(d), rec.diffText || null,
      ...ledgerColumns(d)
    );
  return Number(r.lastInsertRowid);
}

/** The ledger facts of a digest, as stored columns. Unknowns stay NULL — never a guessed zero. */
function ledgerColumns(d: RunDigest): Array<string | number | null> {
  const sb = d.provenance?.startedBy;
  // Cost only when the run itself carried one (a priced model — workstream B/D); never derived here.
  const cost = (d as { cost?: { usd?: unknown } }).cost?.usd;
  return [
    sb?.kind ?? null,
    sb?.kind === "trigger" ? sb.triggerId : null,
    d.provenance?.agent ?? null,
    d.verified ? (d.verified.pass ? 1 : 0) : null,
    d.usage?.inputTokens ?? null,
    d.usage?.outputTokens ?? null,
    typeof cost === "number" && Number.isFinite(cost) ? cost : null,
  ];
}

export interface LedgerFilter {
  since?: number;
  until?: number;
  /** "manual" | "mcp" | "after" | "trigger" | "unknown" (rows archived before provenance existed). */
  startedBy?: string;
  triggerId?: string;
  agent?: string;
  state?: string;
  /** "yes" | "no" | "unchecked" */
  verified?: string;
}

export interface LedgerTotals {
  runs: number;
  done: number;
  failed: number;
  /** Runs that carried a verify clause, and how many of those passed. verified% = passed/checked. */
  checked: number;
  passed: number;
  /** Token sums over the runs that reported usage; `withUsage` says how many that was. */
  inputTokens: number;
  outputTokens: number;
  withUsage: number;
  /** Cost sum over the runs that carried a price; null when none did (render tokens only). */
  costUsd: number | null;
  withCost: number;
}

function ledgerWhere(owner: string, f: LedgerFilter): { sql: string; args: Array<string | number> } {
  const w: string[] = ["owner = ?"];
  const args: Array<string | number> = [owner];
  const t = "COALESCE(ended_at, archived_at)";
  if (f.since !== undefined) (w.push(`${t} >= ?`), args.push(f.since));
  if (f.until !== undefined) (w.push(`${t} < ?`), args.push(f.until));
  if (f.startedBy === "unknown") w.push("started_by IS NULL");
  else if (f.startedBy) (w.push("started_by = ?"), args.push(f.startedBy));
  if (f.triggerId) (w.push("trigger_id = ?"), args.push(f.triggerId));
  if (f.agent) (w.push("agent = ?"), args.push(f.agent));
  if (f.state) (w.push("state = ?"), args.push(f.state));
  if (f.verified === "yes") w.push("verified = 1");
  else if (f.verified === "no") w.push("verified = 0");
  else if (f.verified === "unchecked") w.push("verified IS NULL");
  return { sql: w.join(" AND "), args };
}

/**
 * History ledger totals — the ONE place aggregates are allowed (PRODUCT.md principle 4: this is a
 * record). Counts only what rows actually carry: tokens over runs that reported usage, cost over runs
 * that carried a price, verified% over runs that were checked. Nothing is extrapolated.
 */
export function ledgerTotals(db: Db, owner: string, f: LedgerFilter = {}): LedgerTotals {
  const { sql, args } = ledgerWhere(owner, f);
  const r = db
    .prepare(
      `SELECT COUNT(*) AS runs,
         SUM(state = 'done') AS done, SUM(state = 'failed') AS failed,
         SUM(verified IS NOT NULL) AS checked, SUM(verified = 1) AS passed,
         SUM(COALESCE(input_tokens, 0)) AS inTok, SUM(COALESCE(output_tokens, 0)) AS outTok,
         SUM(input_tokens IS NOT NULL OR output_tokens IS NOT NULL) AS withUsage,
         SUM(cost_usd) AS cost, SUM(cost_usd IS NOT NULL) AS withCost
       FROM run_archive WHERE ${sql}`
    )
    .get(...args) as Record<string, number | null>;
  const n = (v: number | null | undefined) => Number(v ?? 0);
  return {
    runs: n(r.runs),
    done: n(r.done),
    failed: n(r.failed),
    checked: n(r.checked),
    passed: n(r.passed),
    inputTokens: n(r.inTok),
    outputTokens: n(r.outTok),
    withUsage: n(r.withUsage),
    costUsd: n(r.withCost) > 0 ? n(r.cost) : null,
    withCost: n(r.withCost),
  };
}

export interface LedgerRow extends ArchivedRunRow {
  startedBy: string | null;
  triggerId: string | null;
  agent: string | null;
  verified: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

/** Filtered, reverse-chronological ledger rows (cap 50, `before` pages by id). */
export function listLedger(db: Db, owner: string, f: LedgerFilter & { limit?: number; before?: number } = {}): LedgerRow[] {
  const { sql, args } = ledgerWhere(owner, f);
  const limit = Math.min(Math.max(1, f.limit ?? 50), 50);
  const rows = db
    .prepare(
      `SELECT id, box, owner, task, state, exit_code, started_at, ended_at, archived_at, headline,
         started_by, trigger_id, agent, verified, input_tokens, output_tokens, cost_usd
       FROM run_archive WHERE ${sql} ${f.before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`
    )
    .all(...args, ...(f.before ? [f.before] : []), limit) as Array<Record<string, unknown>>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => ({
    ...toRow(r),
    startedBy: (r.started_by as string | null) ?? null,
    triggerId: (r.trigger_id as string | null) ?? null,
    agent: (r.agent as string | null) ?? null,
    verified: r.verified === null || r.verified === undefined ? null : Number(r.verified) === 1,
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    costUsd: num(r.cost_usd),
  }));
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

/**
 * Activity feed for the History heatmap: just when each of the owner's runs finished (epoch ms) and
 * whether it failed, newest first, since `since`. Owner-scoped like every other read here; bucketing
 * into days happens in the browser so "a day" is the viewer's local day, not the server's.
 */
export function listActivity(db: Db, owner: string, since: number): Array<{ t: number; failed: boolean }> {
  const rows = db
    .prepare(
      `SELECT COALESCE(ended_at, archived_at) AS t, state FROM run_archive
       WHERE owner = ? AND COALESCE(ended_at, archived_at) >= ? ORDER BY id DESC LIMIT 1000`
    )
    .all(owner, since) as Array<{ t: number; state: string }>;
  return rows.map((r) => ({ t: Number(r.t), failed: r.state === "failed" }));
}

/** One record, owner-scoped, with the digest parsed back out of digest_json (and the diff, if kept). */
export function getRun(db: Db, owner: string, id: number): (ArchivedRunRow & { digest: RunDigest | null; diffText?: string }) | undefined {
  const r = db.prepare(`SELECT * FROM run_archive WHERE id = ? AND owner = ?`).get(id, owner) as Record<string, unknown> | undefined;
  if (!r) return undefined;
  let digest: RunDigest | null = null;
  try {
    digest = r.digest_json ? (JSON.parse(String(r.digest_json)) as RunDigest) : null;
  } catch {
    digest = null; // a corrupt row still lists; the detail degrades honestly
  }
  return { ...toRow(r), digest, ...(r.diff_text ? { diffText: String(r.diff_text) } : {}) };
}

/** Just the parsed digest of one record (no diff) — by id, or the latest record for a box. */
export function getDigest(db: Db, owner: string, key: { id: number } | { box: string }): { id: number; box: string; digest: RunDigest | null } | undefined {
  const r = (
    "id" in key
      ? db.prepare(`SELECT id, box, digest_json FROM run_archive WHERE id = ? AND owner = ?`).get(key.id, owner)
      : db.prepare(`SELECT id, box, digest_json FROM run_archive WHERE box = ? AND owner = ? ORDER BY id DESC LIMIT 1`).get(key.box, owner)
  ) as { id: number; box: string; digest_json: string | null } | undefined;
  if (!r) return undefined;
  let digest: RunDigest | null = null;
  try {
    digest = r.digest_json ? (JSON.parse(r.digest_json) as RunDigest) : null;
  } catch {
    digest = null;
  }
  return { id: Number(r.id), box: String(r.box), digest };
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
