/**
 * Audit trail for every state-changing request: who (client address), what (method + path + the box
 * it named), outcome (status) and how long it took. One JSON line per event on stderr, prefixed
 * `[audit]`, so `docker logs` / journald already retain it and a log shipper can pick it up.
 * Never logs bodies, tokens or secrets — only the box name and a few whitelisted scalar fields.
 */
import type { Db } from "./db.js";

export interface AuditEvent {
  at: string;
  client: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  session?: string;
  action?: string;
  repo?: string;
}

const FIELDS = ["session", "action", "repo"] as const;

export function auditFields(body: unknown, query: unknown): Pick<AuditEvent, "session" | "action" | "repo"> {
  const out: Pick<AuditEvent, "session" | "action" | "repo"> = {};
  for (const src of [body, query]) {
    if (!src || typeof src !== "object") continue;
    for (const k of FIELDS) {
      const v = (src as Record<string, unknown>)[k];
      if (out[k] === undefined && typeof v === "string" && v.length <= 200) out[k] = v;
    }
  }
  return out;
}

export function formatAudit(e: AuditEvent): string {
  return `[audit] ${JSON.stringify(e)}`;
}

export const MUTATING = new Set(["POST", "PUT", "DELETE", "PATCH"]);

// --- Stored audit trail (audit_events in SQLite): the account page's "Recent activity" ------------

/**
 * How long stored audit rows live. 90 days covers "what happened to my machine last month" while
 * keeping the table bounded — the stderr log line above remains the long-term record for operators
 * who ship logs elsewhere.
 */
export const AUDIT_MAX_AGE_DAYS = 90;

/** One stored audit row as served by GET /audit.json — raw facts, no interpretation. */
export interface AuditRow {
  /** Row id — the tiebreaker half of the paging cursor (`at` alone is not unique). */
  id: number;
  at: string;
  method: string;
  path: string;
  status: number;
  session: string | null;
  action: string | null;
  client: string | null;
}

/**
 * Reverse-chronological page of stored audit events. `userId` scopes to one user (a user principal
 * always passes their own id; operator/admin may pass none for the whole deployment).
 *
 * Paging cursor: `(before, beforeId)` — the `at` AND `id` of the last row you were handed. `at` is
 * an ISO string minted per request and is NOT unique: a burst of requests inside one millisecond
 * shares a timestamp, so an `at < ?` cursor alone would skip every sibling of the boundary row.
 * The cursor is therefore a lexicographic compare on the same `(at DESC, id DESC)` pair the ORDER BY
 * uses. `beforeId` is optional so an old caller still pages, just with the sibling-skipping caveat.
 */
export function listAuditEvents(db: Db, opts: { userId?: string; limit?: number; before?: string; beforeId?: number } = {}): AuditRow[] {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 50)));
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.userId !== undefined) {
    where.push("user_id = ?");
    args.push(opts.userId);
  }
  if (opts.before) {
    if (Number.isInteger(opts.beforeId)) {
      where.push("(at < ? OR (at = ? AND id < ?))");
      args.push(opts.before, opts.before, opts.beforeId);
    } else {
      where.push("at < ?");
      args.push(opts.before);
    }
  }
  const sql = `SELECT id, at, method, path, status, session, action, client FROM audit_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY at DESC, id DESC LIMIT ?`;
  return db.prepare(sql).all(...args, limit) as AuditRow[];
}

/** Delete stored audit rows older than AUDIT_MAX_AGE_DAYS. Returns how many were removed. */
export function pruneAuditEvents(db: Db, nowMs = Date.now()): number {
  const cutoff = new Date(nowMs - AUDIT_MAX_AGE_DAYS * 86_400_000).toISOString();
  return db.prepare(`DELETE FROM audit_events WHERE at < ?`).run(cutoff).changes;
}
