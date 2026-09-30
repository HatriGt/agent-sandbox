import crypto from "node:crypto";
import type { Db } from "./db.js";

/**
 * The durable links between runs and harnesses (definitions themselves are in src/harness.ts):
 *  - run_harness: which harness a box started on, its skill selection (so a resume after a restart
 *    installs the same skills), and the compare it is one side of;
 *  - harness_compares: one task run on two harnesses. Both sides are ordinary delegations through
 *    the normal delegate path; the compare row only links them. Owner-scoped on every read.
 */

export type CompareSide = "a" | "b";

export interface CompareRow {
  id: string;
  owner: string;
  task: string;
  harnessA: string;
  harnessB: string;
  createdAt: number;
  sides: Array<{ side: CompareSide; box: string; harnessId: string | null; harnessName: string | null }>;
}

export function createCompare(db: Db, owner: string, c: { task: string; harnessA: string; harnessB: string }, now = Date.now()): string {
  const id = "cmp_" + crypto.randomBytes(8).toString("base64url");
  db.prepare(`INSERT INTO harness_compares (id, owner, task, harness_a, harness_b, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, owner, c.task.slice(0, 20_000), c.harnessA, c.harnessB, now
  );
  return id;
}

function sidesOf(db: Db, id: string): CompareRow["sides"] {
  return (db.prepare(`SELECT side, box, harness_id, harness_name FROM run_harness WHERE compare_id = ? ORDER BY side`).all(id) as Array<Record<string, string | null>>).map((r) => ({
    side: r.side as CompareSide,
    box: String(r.box),
    harnessId: r.harness_id,
    harnessName: r.harness_name,
  }));
}

export function getCompare(db: Db, owner: string, id: string): CompareRow | undefined {
  const r = db.prepare(`SELECT * FROM harness_compares WHERE id = ? AND owner = ?`).get(id, owner) as Record<string, unknown> | undefined;
  if (!r) return undefined;
  return { id: String(r.id), owner, task: String(r.task), harnessA: String(r.harness_a), harnessB: String(r.harness_b), createdAt: Number(r.created_at), sides: sidesOf(db, String(r.id)) };
}

export function listCompares(db: Db, owner: string, limit = 20): CompareRow[] {
  const rows = db.prepare(`SELECT id FROM harness_compares WHERE owner = ? ORDER BY created_at DESC LIMIT ?`).all(owner, Math.min(limit, 100)) as Array<{ id: string }>;
  return rows.map((r) => getCompare(db, owner, r.id)!).filter(Boolean);
}

/**
 * Which harness a side must run, or why this delegation may not join the compare: the compare must
 * be the caller's, the side must be free, and the harness must be the one the compare was made for
 * (so a compare view can never show a run on a harness it doesn't name).
 */
export function checkCompareSide(db: Db, owner: string, compareId: string, side: unknown, harnessId: string | undefined): { ok: true; side: CompareSide } | { ok: false; error: string } {
  const c = getCompare(db, owner, compareId);
  if (!c) return { ok: false, error: "No such compare." };
  if (side !== "a" && side !== "b") return { ok: false, error: "compareSide must be a or b." };
  const want = side === "a" ? c.harnessA : c.harnessB;
  if (harnessId !== want) return { ok: false, error: `Side ${side} of this compare runs harness ${want}.` };
  if (c.sides.some((s) => s.side === side)) return { ok: false, error: `Side ${side} of this compare already started.` };
  return { ok: true, side };
}

export function recordRunHarness(
  db: Db,
  r: { box: string; owner: string; harnessId?: string; harnessName?: string; skills?: string[]; compareId?: string; side?: CompareSide },
  now = Date.now()
): void {
  db.prepare(
    `INSERT INTO run_harness (box, owner, harness_id, harness_name, skills_json, compare_id, side, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(box) DO UPDATE SET owner = excluded.owner, harness_id = excluded.harness_id, harness_name = excluded.harness_name,
       skills_json = excluded.skills_json, compare_id = excluded.compare_id, side = excluded.side, at = excluded.at`
  ).run(r.box, r.owner, r.harnessId ?? null, r.harnessName ?? null, r.skills ? JSON.stringify(r.skills) : null, r.compareId ?? null, r.side ?? null, now);
}

export function runHarnessOf(db: Db, box: string): { harnessId: string | null; harnessName: string | null; skills?: string[]; compareId: string | null } | undefined {
  const r = db.prepare(`SELECT * FROM run_harness WHERE box = ?`).get(box) as Record<string, string | null> | undefined;
  if (!r) return undefined;
  let skills: string[] | undefined;
  try {
    skills = r.skills_json ? (JSON.parse(r.skills_json) as string[]) : undefined;
  } catch {
    skills = undefined;
  }
  return { harnessId: r.harness_id, harnessName: r.harness_name, ...(skills ? { skills } : {}), compareId: r.compare_id };
}

/** The durable backend for skill-store's per-box selection. */
export function skillSelectionBackend(db: Db) {
  return {
    get: (box: string) => runHarnessOf(db, box)?.skills,
    set: (box: string, names: string[]) => {
      const n = db.prepare(`UPDATE run_harness SET skills_json = ? WHERE box = ?`).run(JSON.stringify(names), box).changes;
      if (!n) db.prepare(`INSERT INTO run_harness (box, owner, skills_json, at) VALUES (?, '', ?, ?)`).run(box, JSON.stringify(names), Date.now());
    },
  };
}

/** The latest archived digest for one of the owner's boxes (a finished, possibly torn-down side). */
export function archivedDigestOf(db: Db, owner: string, box: string): Record<string, unknown> | undefined {
  const r = db.prepare(`SELECT digest_json FROM run_archive WHERE box = ? AND owner = ? ORDER BY id DESC LIMIT 1`).get(box, owner) as { digest_json: string | null } | undefined;
  if (!r?.digest_json) return undefined;
  try {
    return JSON.parse(r.digest_json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
