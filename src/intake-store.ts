import crypto from "node:crypto";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import { newSecret } from "./triggers.js";
import type { DeliveryEntry } from "./trigger-store.js";

/**
 * Owner-scoped persistence for intake channels (the pure rules live in src/intake.ts). One channel
 * per owner, created on first read. Secrets are sealed at rest; the email URL token is shown to its
 * owner (it IS the address) and can be rotated. Deliveries are rows in trigger_delivery_log keyed
 * by the channel id, so they share the automation log's shape and retention.
 */

export interface IntakeChannel {
  id: string;
  owner: string;
  allowEmails: string[];
  slackUsers: string[];
  defaultRepo?: string;
  hasMailgunKey: boolean;
  hasSlackSecret: boolean;
  hasSlackBotToken: boolean;
  hasSentryToken: boolean;
  createdAt: number;
  updatedAt: number;
}

const parseList = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? "[]"));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

function toChannel(r: Record<string, any>): IntakeChannel {
  return {
    id: r.id,
    owner: r.owner,
    allowEmails: parseList(r.allow_emails_json),
    slackUsers: parseList(r.slack_users_json),
    ...(r.default_repo ? { defaultRepo: r.default_repo } : {}),
    hasMailgunKey: !!r.mailgun_key_enc,
    hasSlackSecret: !!r.slack_signing_secret_enc,
    hasSlackBotToken: !!r.slack_bot_token_enc,
    hasSentryToken: !!r.sentry_token_enc,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function getOrCreateChannel(db: Db, box: SecretBox, owner: string, now = Date.now()): IntakeChannel {
  const r = db.prepare(`SELECT * FROM intake_channels WHERE owner = ?`).get(owner) as Record<string, unknown> | undefined;
  if (r) return toChannel(r);
  const id = "inb_" + crypto.randomBytes(9).toString("base64url");
  db.prepare(`INSERT OR IGNORE INTO intake_channels (id, owner, email_token_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, owner, box.seal(newSecret()), now, now);
  return toChannel(db.prepare(`SELECT * FROM intake_channels WHERE owner = ?`).get(owner) as Record<string, unknown>);
}

/** Unscoped lookup — ONLY for the public receivers, which authenticate by token / signature. */
export function getChannelById(db: Db, id: string): IntakeChannel | undefined {
  const r = db.prepare(`SELECT * FROM intake_channels WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? toChannel(r) : undefined;
}

type SecretCol = "email_token_enc" | "mailgun_key_enc" | "slack_signing_secret_enc" | "slack_bot_token_enc" | "sentry_token_enc";

export function revealChannelSecret(db: Db, box: SecretBox, id: string, col: SecretCol): string | undefined {
  const r = db.prepare(`SELECT ${col} AS v FROM intake_channels WHERE id = ?`).get(id) as { v: string | null } | undefined;
  if (!r?.v) return undefined;
  try {
    return box.open(r.v);
  } catch {
    return undefined;
  }
}

export function rotateEmailToken(db: Db, box: SecretBox, owner: string, now = Date.now()): void {
  db.prepare(`UPDATE intake_channels SET email_token_enc = ?, updated_at = ? WHERE owner = ?`).run(box.seal(newSecret()), now, owner);
}

export interface ChannelUpdate {
  allowEmails?: string[];
  slackUsers?: string[];
  defaultRepo?: string | null;
  /** Write-only secrets: a string sets, "" clears, undefined keeps. */
  mailgunKey?: string;
  slackSigningSecret?: string;
  slackBotToken?: string;
  sentryToken?: string;
}

export function updateChannel(db: Db, box: SecretBox, owner: string, u: ChannelUpdate, now = Date.now()): IntakeChannel {
  getOrCreateChannel(db, box, owner, now);
  const set: string[] = [];
  const args: unknown[] = [];
  if (u.allowEmails) (set.push("allow_emails_json = ?"), args.push(JSON.stringify(u.allowEmails)));
  if (u.slackUsers) (set.push("slack_users_json = ?"), args.push(JSON.stringify(u.slackUsers)));
  if (u.defaultRepo !== undefined) (set.push("default_repo = ?"), args.push(u.defaultRepo || null));
  const secret = (col: SecretCol, v: string | undefined) => {
    if (v === undefined) return;
    set.push(`${col} = ?`);
    args.push(v ? box.seal(v) : null);
  };
  secret("mailgun_key_enc", u.mailgunKey);
  secret("slack_signing_secret_enc", u.slackSigningSecret);
  secret("slack_bot_token_enc", u.slackBotToken);
  secret("sentry_token_enc", u.sentryToken);
  if (set.length) db.prepare(`UPDATE intake_channels SET ${set.join(", ")}, updated_at = ? WHERE owner = ?`).run(...args, now, owner);
  return getOrCreateChannel(db, box, owner, now);
}

/** Newest first, owner-scoped through the channel row. */
export function listIntakeDeliveries(db: Db, owner: string, limit = 30): DeliveryEntry[] {
  return (
    db
      .prepare(`SELECT l.* FROM trigger_delivery_log l JOIN intake_channels c ON c.id = l.trigger_id WHERE c.owner = ? ORDER BY l.id DESC LIMIT ?`)
      .all(owner, limit) as Array<Record<string, any>>
  ).map((r) => ({
    id: r.id,
    at: Number(r.at),
    outcome: r.outcome,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.detail ? { detail: r.detail } : {}),
    ...(r.box ? { box: r.box } : {}),
  }));
}

/* ───────────────────────────── pending "which repo?" questions ───────────────────────────── */

export type IntakeSource = "email" | "slack";

export interface PendingIntake {
  id: string;
  owner: string;
  channelId: string;
  source: IntakeSource;
  task: string;
  attachments: Array<{ path: string; base64: string }>;
  choices: string[];
  meta: { from?: string; responseUrl?: string };
  createdAt: number;
  resolvedAt?: number;
  box?: string;
}

/** Unanswered questions expire: an intake nobody answered in a week is stale. */
export const PENDING_TTL_MS = 7 * 24 * 3600_000;

function toPending(r: Record<string, any>): PendingIntake {
  const j = <T>(s: unknown, d: T): T => {
    try {
      return s ? (JSON.parse(String(s)) as T) : d;
    } catch {
      return d;
    }
  };
  return {
    id: r.id,
    owner: r.owner,
    channelId: r.channel_id,
    source: r.source,
    task: r.task,
    attachments: j(r.attachments_json, []),
    choices: j(r.choices_json, []),
    meta: j(r.meta_json, {}),
    createdAt: Number(r.created_at),
    ...(r.resolved_at ? { resolvedAt: Number(r.resolved_at) } : {}),
    ...(r.box ? { box: r.box } : {}),
  };
}

export function createPending(db: Db, p: Omit<PendingIntake, "id" | "createdAt">, now = Date.now()): PendingIntake {
  const id = "inq_" + crypto.randomBytes(9).toString("base64url");
  db.prepare(
    `INSERT INTO intake_pending (id, owner, channel_id, source, task, attachments_json, choices_json, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, p.owner, p.channelId, p.source, p.task, JSON.stringify(p.attachments ?? []), JSON.stringify(p.choices), JSON.stringify(p.meta ?? {}), now);
  db.prepare(`DELETE FROM intake_pending WHERE created_at < ?`).run(now - PENDING_TTL_MS);
  return toPending(db.prepare(`SELECT * FROM intake_pending WHERE id = ?`).get(id) as Record<string, unknown>);
}

export function getPending(db: Db, owner: string, id: string): PendingIntake | undefined {
  const r = db.prepare(`SELECT * FROM intake_pending WHERE id = ? AND owner = ?`).get(id, owner) as Record<string, unknown> | undefined;
  return r ? toPending(r) : undefined;
}

/** Open questions, newest first — without the attachment bytes. */
export function listPending(db: Db, owner: string, now = Date.now()): Array<Omit<PendingIntake, "attachments"> & { attachmentCount: number }> {
  return (
    db
      .prepare(`SELECT * FROM intake_pending WHERE owner = ? AND resolved_at IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 20`)
      .all(owner, now - PENDING_TTL_MS) as Array<Record<string, unknown>>
  ).map((r) => {
    const { attachments, ...rest } = toPending(r);
    return { ...rest, attachmentCount: attachments.length };
  });
}

/** Claim a pending question exactly once (a double-tap or a Slack retry cannot start two runs). */
export function claimPending(db: Db, owner: string, id: string, now = Date.now()): PendingIntake | undefined {
  const n = db.prepare(`UPDATE intake_pending SET resolved_at = ? WHERE id = ? AND owner = ? AND resolved_at IS NULL AND created_at >= ?`).run(now, id, owner, now - PENDING_TTL_MS).changes;
  return n ? getPending(db, owner, id) : undefined;
}

export function releasePending(db: Db, id: string): void {
  db.prepare(`UPDATE intake_pending SET resolved_at = NULL WHERE id = ? AND box IS NULL`).run(id);
}

export function setPendingBox(db: Db, id: string, box: string): void {
  // The bytes have done their job once the run has them.
  db.prepare(`UPDATE intake_pending SET box = ?, attachments_json = NULL WHERE id = ?`).run(box, id);
}

export function dismissPending(db: Db, owner: string, id: string, now = Date.now()): boolean {
  return db.prepare(`UPDATE intake_pending SET resolved_at = ?, attachments_json = NULL WHERE id = ? AND owner = ? AND resolved_at IS NULL`).run(now, id, owner).changes > 0;
}
