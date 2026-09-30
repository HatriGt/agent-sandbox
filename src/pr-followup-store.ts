import crypto from "node:crypto";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import type { FollowupKind, FollowupView, ReviewComment } from "./pr-followups.js";
import { newSecret } from "./triggers.js";

/**
 * Persistence for PR follow-ups (rules: src/pr-followups.ts). Owner-scoped on every read the API
 * serves. `agent_prs` is written at the archive moment from the outcome card's opened-PR list — so
 * only PRs a run of this product opened can ever be followed up.
 */

export interface AgentPr {
  repo: string;
  number: number;
  owner: string;
  rootBox: string;
  branch?: string;
  harnessId?: string;
  agent?: string;
  model?: string;
  triggerId?: string;
  archiveId?: number;
  createdAt: number;
}

const lc = (s: string) => s.toLowerCase();

const toPr = (r: Record<string, any>): AgentPr => ({
  repo: r.repo,
  number: Number(r.number),
  owner: r.owner,
  rootBox: r.root_box,
  ...(r.branch ? { branch: r.branch } : {}),
  ...(r.harness_id ? { harnessId: r.harness_id } : {}),
  ...(r.agent ? { agent: r.agent } : {}),
  ...(r.model ? { model: r.model } : {}),
  ...(r.trigger_id ? { triggerId: r.trigger_id } : {}),
  ...(r.archive_id ? { archiveId: Number(r.archive_id) } : {}),
  createdAt: Number(r.created_at),
});

/** Record the PRs a run opened. First writer wins: a follow-up that re-reports the PR never re-roots it. */
export function recordAgentPrs(
  db: Db,
  r: { owner: string; box: string; prs: Array<{ repo: string; number: number }>; branch?: string; harnessId?: string; agent?: string; model?: string; triggerId?: string; archiveId?: number },
  now = Date.now()
): number {
  const put = db.prepare(
    `INSERT INTO agent_prs (repo, number, owner, root_box, branch, harness_id, agent, model, trigger_id, archive_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(repo, number) DO NOTHING`
  );
  let n = 0;
  for (const p of r.prs)
    n += put.run(lc(p.repo), p.number, r.owner, r.box, r.branch ?? null, r.harnessId ?? null, r.agent ?? null, r.model ?? null, r.triggerId ?? null, r.archiveId ?? null, now).changes;
  return n;
}

export function getAgentPr(db: Db, repo: string, number: number): AgentPr | undefined {
  const r = db.prepare(`SELECT * FROM agent_prs WHERE repo = ? AND number = ?`).get(lc(repo), number) as Record<string, any> | undefined;
  return r ? toPr(r) : undefined;
}

export function agentPrByBranch(db: Db, repo: string, branch: string): AgentPr | undefined {
  if (!branch) return undefined;
  const r = db.prepare(`SELECT * FROM agent_prs WHERE repo = ? AND branch = ? ORDER BY created_at DESC LIMIT 1`).get(lc(repo), branch) as Record<string, any> | undefined;
  return r ? toPr(r) : undefined;
}

export function setPrBranch(db: Db, repo: string, number: number, branch: string): void {
  db.prepare(`UPDATE agent_prs SET branch = ? WHERE repo = ? AND number = ?`).run(branch, lc(repo), number);
}

export function listAgentPrs(db: Db, owner: string, limit = 50): AgentPr[] {
  return (db.prepare(`SELECT * FROM agent_prs WHERE owner = ? ORDER BY created_at DESC LIMIT ?`).all(owner, limit) as Array<Record<string, any>>).map(toPr);
}

/* ───────────────────────────── follow-up rows ───────────────────────────── */

/** A follow-up that has not finished counts as running for this long; then the box is presumed lost. */
const RUNNING_TTL_MS = 6 * 3600_000;

export interface FollowupRow {
  id: number;
  repo: string;
  number: number;
  owner: string;
  kind: FollowupKind;
  dedupeKey: string;
  attempt: number;
  subject: string;
  box?: string;
  state: "starting" | "running" | "done" | "failed";
  comments: ReviewComment[];
  archiveId?: number;
  at: number;
  finishedAt?: number;
}

const toRow = (r: Record<string, any>): FollowupRow => {
  let comments: ReviewComment[] = [];
  try {
    comments = r.comments_json ? JSON.parse(r.comments_json) : [];
  } catch {
    comments = [];
  }
  return {
    id: Number(r.id),
    repo: r.repo,
    number: Number(r.number),
    owner: r.owner,
    kind: r.kind,
    dedupeKey: r.dedupe_key,
    attempt: Number(r.attempt),
    subject: r.subject,
    ...(r.box ? { box: r.box } : {}),
    state: r.state,
    comments,
    ...(r.archive_id ? { archiveId: Number(r.archive_id) } : {}),
    at: Number(r.at),
    ...(r.finished_at ? { finishedAt: Number(r.finished_at) } : {}),
  };
};

export function guardFacts(db: Db, repo: string, number: number, kind: FollowupKind, key: string, now = Date.now()): { attempts: number; running: boolean; seen: boolean } {
  const attempts = (db.prepare(`SELECT COUNT(*) AS n FROM pr_followups WHERE repo = ? AND number = ? AND kind = ?`).get(lc(repo), number, kind) as { n: number }).n;
  const running = !!db
    .prepare(`SELECT 1 FROM pr_followups WHERE repo = ? AND number = ? AND state IN ('starting', 'running') AND at > ? LIMIT 1`)
    .get(lc(repo), number, now - RUNNING_TTL_MS);
  const seen = !!db.prepare(`SELECT 1 FROM pr_followups WHERE repo = ? AND number = ? AND dedupe_key = ?`).get(lc(repo), number, key);
  return { attempts, running, seen };
}

/** Claim the dedupe key atomically. Null = someone else (a parallel delivery) claimed it first. */
export function claimFollowup(
  db: Db,
  f: { repo: string; number: number; owner: string; kind: FollowupKind; dedupeKey: string; attempt: number; subject: string; comments?: ReviewComment[] },
  now = Date.now()
): number | null {
  const r = db
    .prepare(
      `INSERT INTO pr_followups (repo, number, owner, kind, dedupe_key, attempt, subject, state, comments_json, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?) ON CONFLICT(repo, number, dedupe_key) DO NOTHING`
    )
    .run(lc(f.repo), f.number, f.owner, f.kind, f.dedupeKey, f.attempt, f.subject, f.comments?.length ? JSON.stringify(f.comments) : null, now);
  return r.changes ? Number(r.lastInsertRowid) : null;
}

export function updateFollowup(db: Db, id: number, u: { subject?: string; comments?: ReviewComment[] }): void {
  if (u.subject) db.prepare(`UPDATE pr_followups SET subject = ? WHERE id = ?`).run(u.subject, id);
  if (u.comments) db.prepare(`UPDATE pr_followups SET comments_json = ? WHERE id = ?`).run(JSON.stringify(u.comments), id);
}

export function attachBox(db: Db, id: number, box: string): void {
  db.prepare(`UPDATE pr_followups SET box = ?, state = 'running' WHERE id = ?`).run(box, id);
}

/** A start that never produced a box does not count as an attempt, and frees its dedupe key. */
export function dropFollowup(db: Db, id: number): void {
  db.prepare(`DELETE FROM pr_followups WHERE id = ?`).run(id);
}

export function followupByBox(db: Db, box: string): FollowupRow | undefined {
  const r = db.prepare(`SELECT * FROM pr_followups WHERE box = ? ORDER BY id DESC LIMIT 1`).get(box) as Record<string, any> | undefined;
  return r ? toRow(r) : undefined;
}

export function finishFollowup(db: Db, box: string, state: "done" | "failed", archiveId: number | undefined, now = Date.now()): FollowupRow | undefined {
  const row = followupByBox(db, box);
  if (!row || row.finishedAt) return undefined;
  db.prepare(`UPDATE pr_followups SET state = ?, archive_id = ?, finished_at = ? WHERE id = ?`).run(state, archiveId ?? null, now, row.id);
  return { ...row, state, ...(archiveId ? { archiveId } : {}), finishedAt: now };
}

const toView = (r: FollowupRow): FollowupView => ({
  box: r.box ?? "",
  kind: r.kind,
  subject: r.subject,
  attempt: r.attempt,
  state: r.state === "done" ? "done" : r.state === "failed" ? "failed" : "running",
  archiveId: r.archiveId ?? null,
  at: r.at,
  pr: { repo: r.repo, number: r.number },
});

/**
 * The follow-ups the outcome card shows for `box`: every follow-up on the PRs it opened, or — when
 * `box` is itself a follow-up — every follow-up on its PR. Owner-scoped.
 */
export function followupsForBox(db: Db, owner: string, box: string): FollowupView[] {
  const prs = db
    .prepare(
      `SELECT repo, number FROM agent_prs WHERE root_box = ? AND owner = ?
       UNION SELECT repo, number FROM pr_followups WHERE box = ? AND owner = ?`
    )
    .all(box, owner, box, owner) as Array<{ repo: string; number: number }>;
  if (!prs.length) return [];
  const q = db.prepare(`SELECT * FROM pr_followups WHERE repo = ? AND number = ? AND owner = ? AND box IS NOT NULL ORDER BY id ASC`);
  return prs.flatMap((p) => (q.all(p.repo, p.number, owner) as Array<Record<string, any>>).map(toRow).map(toView));
}

export function followupsForPr(db: Db, owner: string, repo: string, number: number): FollowupView[] {
  return (db.prepare(`SELECT * FROM pr_followups WHERE repo = ? AND number = ? AND owner = ? AND box IS NOT NULL ORDER BY id ASC`).all(lc(repo), number, owner) as Array<Record<string, any>>)
    .map(toRow)
    .map(toView);
}

/* ───────────────────────────── per-owner webhook ───────────────────────────── */

export interface HookRow {
  id: string;
  owner: string;
  createdAt: number;
}

export function hookOf(db: Db, owner: string): HookRow | undefined {
  const r = db.prepare(`SELECT id, owner, created_at FROM pr_followup_hooks WHERE owner = ?`).get(owner) as Record<string, any> | undefined;
  return r ? { id: r.id, owner: r.owner, createdAt: Number(r.created_at) } : undefined;
}

export function hookById(db: Db, id: string): HookRow | undefined {
  const r = db.prepare(`SELECT id, owner, created_at FROM pr_followup_hooks WHERE id = ?`).get(id) as Record<string, any> | undefined;
  return r ? { id: r.id, owner: r.owner, createdAt: Number(r.created_at) } : undefined;
}

/** Create (or rotate) the owner's follow-up webhook. The secret is returned once, here. */
export function rotateHook(db: Db, box: SecretBox, owner: string, now = Date.now()): { id: string; secret: string } {
  const secret = newSecret();
  const existing = hookOf(db, owner);
  if (existing) {
    db.prepare(`UPDATE pr_followup_hooks SET secret_enc = ? WHERE id = ?`).run(box.seal(secret), existing.id);
    return { id: existing.id, secret };
  }
  const id = `prf_${crypto.randomBytes(9).toString("base64url")}`;
  db.prepare(`INSERT INTO pr_followup_hooks (id, owner, secret_enc, created_at) VALUES (?, ?, ?, ?)`).run(id, owner, box.seal(secret), now);
  return { id, secret };
}

/** The follow-up hook's delivery log (same table as automations', keyed by the hook id). Newest first. */
export function hookDeliveries(db: Db, owner: string, limit = 50): Array<{ id: number; at: number; outcome: string; reason?: string; detail?: string; box?: string }> {
  const h = hookOf(db, owner);
  if (!h) return [];
  return (db.prepare(`SELECT * FROM trigger_delivery_log WHERE trigger_id = ? ORDER BY id DESC LIMIT ?`).all(h.id, limit) as Array<Record<string, any>>).map((r) => ({
    id: Number(r.id),
    at: Number(r.at),
    outcome: r.outcome,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.detail ? { detail: r.detail } : {}),
    ...(r.box ? { box: r.box } : {}),
  }));
}

export function revealHookSecret(db: Db, box: SecretBox, id: string): string | undefined {
  const r = db.prepare(`SELECT secret_enc FROM pr_followup_hooks WHERE id = ?`).get(id) as { secret_enc: string } | undefined;
  if (!r) return undefined;
  try {
    return box.open(r.secret_enc);
  } catch {
    return undefined;
  }
}
