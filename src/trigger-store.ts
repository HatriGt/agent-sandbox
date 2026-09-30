import crypto from "node:crypto";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import { describeWhen, newSecret, nextFire, parseCron, type TriggerBudget, type TriggerInput, type TriggerKind, type TriggerSpec } from "./triggers.js";

/**
 * Owner-scoped persistence for triggers (the pure rules live in src/triggers.ts). Every read and
 * write takes the owner, so one tenant can never list, edit or fire another's automation. The
 * webhook secret is sealed at rest and only ever returned in plaintext by `revealSecret` (the route
 * shows it once, at creation or rotation).
 */

export interface TriggerResult {
  at: number;
  outcome: "started" | "skipped" | "failed";
  box?: string;
  reason?: string;
  /** Filled in when the started run finishes (the receipt chip on the row). */
  finished?: { state: string; headline: string; archiveId?: number };
}

export interface TriggerRow extends TriggerInput {
  id: string;
  owner: string;
  lastFired: number | null;
  nextFire: number | null;
  lastResult: TriggerResult | null;
  hasPayload: boolean;
  createdAt: number;
  updatedAt: number;
}

const MAX_PAYLOAD_CHARS = 64_000;

function toRow(r: Record<string, any>): TriggerRow {
  const parse = <T>(s: unknown, d: T): T => {
    try {
      return s ? (JSON.parse(String(s)) as T) : d;
    } catch {
      return d;
    }
  };
  return {
    id: r.id,
    owner: r.owner,
    name: r.name,
    kind: r.kind as TriggerKind,
    spec: parse<TriggerSpec>(r.spec_json, {}),
    ...(r.repo ? { repo: r.repo } : {}),
    taskTemplate: r.task_template,
    enabled: !!r.enabled,
    concurrency: Number(r.concurrency) || 1,
    budget: parse<TriggerBudget>(r.budget_json, { maxMinutes: 60 }),
    prComment: !!r.pr_comment,
    ...(r.agent ? { agent: r.agent } : {}),
    ...(r.model ? { model: r.model } : {}),
    ...(r.harness_id ? { harnessId: r.harness_id } : {}),
    lastFired: r.last_fired ?? null,
    nextFire: r.next_fire ?? null,
    lastResult: parse<TriggerResult | null>(r.last_result_json, null),
    hasPayload: !!r.last_payload_json,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** The next fire for a schedule, or null (not a schedule / disabled / never matches). */
export function computeNextFire(t: Pick<TriggerInput, "kind" | "spec" | "enabled">, now: number): number | null {
  if (t.kind !== "schedule" || !t.enabled || !t.spec.cron) return null;
  try {
    return nextFire(parseCron(t.spec.cron), now, t.spec.timezone ?? "UTC");
  } catch {
    return null;
  }
}

export function createTrigger(db: Db, box: SecretBox, owner: string, t: TriggerInput, now = Date.now()): { row: TriggerRow; secret: string } {
  const id = "trg_" + crypto.randomBytes(9).toString("base64url");
  const secret = newSecret();
  db.prepare(
    `INSERT INTO triggers (id, owner, name, kind, spec_json, repo, task_template, enabled, concurrency, budget_json, pr_comment, agent, model, harness_id, secret_enc, next_fire, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, owner, t.name, t.kind, JSON.stringify(t.spec), t.repo ?? null, t.taskTemplate, t.enabled ? 1 : 0, t.concurrency,
    JSON.stringify(t.budget), t.prComment ? 1 : 0, t.agent ?? null, t.model ?? null, t.harnessId ?? null, box.seal(secret), computeNextFire(t, now), now, now
  );
  return { row: getTrigger(db, owner, id)!, secret };
}

export function updateTrigger(db: Db, owner: string, id: string, t: TriggerInput, now = Date.now()): TriggerRow | undefined {
  const r = db
    .prepare(
      `UPDATE triggers SET name = ?, kind = ?, spec_json = ?, repo = ?, task_template = ?, enabled = ?, concurrency = ?, budget_json = ?,
       pr_comment = ?, agent = ?, model = ?, harness_id = ?, next_fire = ?, updated_at = ? WHERE id = ? AND owner = ?`
    )
    .run(
      t.name, t.kind, JSON.stringify(t.spec), t.repo ?? null, t.taskTemplate, t.enabled ? 1 : 0, t.concurrency, JSON.stringify(t.budget),
      t.prComment ? 1 : 0, t.agent ?? null, t.model ?? null, t.harnessId ?? null, computeNextFire(t, now), now, id, owner
    );
  return r.changes ? getTrigger(db, owner, id) : undefined;
}

export function setEnabled(db: Db, owner: string, id: string, enabled: boolean, now = Date.now()): TriggerRow | undefined {
  const cur = getTrigger(db, owner, id);
  if (!cur) return undefined;
  db.prepare(`UPDATE triggers SET enabled = ?, next_fire = ?, updated_at = ? WHERE id = ? AND owner = ?`).run(
    enabled ? 1 : 0, computeNextFire({ ...cur, enabled }, now), now, id, owner
  );
  return getTrigger(db, owner, id);
}

export function deleteTrigger(db: Db, owner: string, id: string): boolean {
  const n = db.prepare(`DELETE FROM triggers WHERE id = ? AND owner = ?`).run(id, owner).changes;
  if (n) db.prepare(`DELETE FROM trigger_deliveries WHERE trigger_id = ?`).run(id);
  return n > 0;
}

export function getTrigger(db: Db, owner: string, id: string): TriggerRow | undefined {
  const r = db.prepare(`SELECT * FROM triggers WHERE id = ? AND owner = ?`).get(id, owner) as Record<string, unknown> | undefined;
  return r ? toRow(r) : undefined;
}

/** Unscoped lookup — ONLY for the webhook receiver, which authenticates by the trigger's secret. */
export function getTriggerById(db: Db, id: string): TriggerRow | undefined {
  const r = db.prepare(`SELECT * FROM triggers WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? toRow(r) : undefined;
}

export function listTriggers(db: Db, owner: string): TriggerRow[] {
  return (db.prepare(`SELECT * FROM triggers WHERE owner = ? ORDER BY created_at DESC`).all(owner) as Array<Record<string, unknown>>).map(toRow);
}

/** Enabled schedules whose next fire has come (dispatcher tick). */
export function dueSchedules(db: Db, now: number): TriggerRow[] {
  return (db.prepare(`SELECT * FROM triggers WHERE kind = 'schedule' AND enabled = 1 AND next_fire IS NOT NULL AND next_fire <= ?`).all(now) as Array<Record<string, unknown>>).map(toRow);
}

/** Enabled chains that follow `parentId` (same owner only — a chain can't hang off a stranger). */
export function chainsAfter(db: Db, owner: string, parentId: string): TriggerRow[] {
  return listTriggers(db, owner).filter((t) => t.kind === "chain" && t.enabled && t.spec.afterTrigger === parentId);
}

export function revealSecret(db: Db, box: SecretBox, id: string): string | undefined {
  const r = db.prepare(`SELECT secret_enc FROM triggers WHERE id = ?`).get(id) as { secret_enc: string | null } | undefined;
  if (!r?.secret_enc) return undefined;
  try {
    return box.open(r.secret_enc);
  } catch {
    return undefined;
  }
}

export function rotateSecret(db: Db, box: SecretBox, owner: string, id: string, now = Date.now()): string | undefined {
  const secret = newSecret();
  const n = db.prepare(`UPDATE triggers SET secret_enc = ?, updated_at = ? WHERE id = ? AND owner = ?`).run(box.seal(secret), now, id, owner).changes;
  return n ? secret : undefined;
}

export function markFired(db: Db, id: string, result: TriggerResult, now = Date.now()): void {
  const t = db.prepare(`SELECT kind, spec_json, enabled FROM triggers WHERE id = ?`).get(id) as { kind: TriggerKind; spec_json: string; enabled: number } | undefined;
  if (!t) return;
  const next = computeNextFire({ kind: t.kind, spec: JSON.parse(t.spec_json), enabled: !!t.enabled }, now);
  db.prepare(`UPDATE triggers SET last_fired = ?, next_fire = ?, last_result_json = ? WHERE id = ?`).run(now, next, JSON.stringify(result), id);
}

/** Record a skip without touching last_fired (a skip is not a fire), but DO advance a schedule. */
export function markSkipped(db: Db, id: string, result: TriggerResult, now = Date.now()): void {
  const t = db.prepare(`SELECT kind, spec_json, enabled FROM triggers WHERE id = ?`).get(id) as { kind: TriggerKind; spec_json: string; enabled: number } | undefined;
  if (!t) return;
  const next = computeNextFire({ kind: t.kind, spec: JSON.parse(t.spec_json), enabled: !!t.enabled }, now);
  db.prepare(`UPDATE triggers SET next_fire = ?, last_result_json = ? WHERE id = ?`).run(next, JSON.stringify(result), id);
}

export function markFinished(db: Db, id: string, box: string, finished: NonNullable<TriggerResult["finished"]>): void {
  const r = db.prepare(`SELECT last_result_json FROM triggers WHERE id = ?`).get(id) as { last_result_json: string | null } | undefined;
  if (!r?.last_result_json) return;
  try {
    const last = JSON.parse(r.last_result_json) as TriggerResult;
    if (last.box !== box) return; // a newer fire already replaced it
    db.prepare(`UPDATE triggers SET last_result_json = ? WHERE id = ?`).run(JSON.stringify({ ...last, finished }), id);
  } catch {
    /* corrupt result: leave it */
  }
}

/** Keep the (already redacted) last payload for the editor's live preview. */
export function savePayload(db: Db, id: string, payload: unknown): void {
  let s = JSON.stringify(payload ?? null);
  if (s.length > MAX_PAYLOAD_CHARS) s = JSON.stringify({ note: "payload too large to keep for preview", bytes: s.length });
  db.prepare(`UPDATE triggers SET last_payload_json = ? WHERE id = ?`).run(s, id);
}

export function lastPayload(db: Db, owner: string, id: string): unknown {
  const r = db.prepare(`SELECT last_payload_json FROM triggers WHERE id = ? AND owner = ?`).get(id, owner) as { last_payload_json: string | null } | undefined;
  if (!r?.last_payload_json) return undefined;
  try {
    return JSON.parse(r.last_payload_json);
  } catch {
    return undefined;
  }
}

/**
 * Claim delivery keys atomically. Returns false when ANY key was seen for this trigger within the
 * window — a replayed GitHub delivery (same id or same body) or a burst of identical posts.
 */
export function claimDelivery(
  db: Db,
  triggerId: string,
  keys: string[],
  now = Date.now(),
  windowMs = 7 * 24 * 3600_000,
  /** Window for `body:` keys. Generic webhooks use a short one: identical pings a day apart are
   *  legitimate, identical posts a second apart are a storm or a replay. */
  bodyWindowMs = windowMs
): boolean {
  const tx = db.transaction(() => {
    const seen = db.prepare(`SELECT at FROM trigger_deliveries WHERE trigger_id = ? AND key = ?`);
    for (const k of keys) {
      const r = seen.get(triggerId, k) as { at: number } | undefined;
      if (r && now - r.at < (k.startsWith("body:") ? bodyWindowMs : windowMs)) return false;
    }
    const put = db.prepare(`INSERT INTO trigger_deliveries (trigger_id, key, at) VALUES (?, ?, ?) ON CONFLICT(trigger_id, key) DO UPDATE SET at = excluded.at`);
    for (const k of keys) put.run(triggerId, k, now);
    return true;
  });
  return tx();
}

export function pruneDeliveries(db: Db, now = Date.now(), maxAgeMs = 7 * 24 * 3600_000): number {
  return db.prepare(`DELETE FROM trigger_deliveries WHERE at < ?`).run(now - maxAgeMs).changes;
}

/** The API view: adds "when" in words; never includes the secret. */
export function viewTrigger(t: TriggerRow, names: Record<string, string>): TriggerRow & { when: string } {
  return { ...t, when: describeWhen(t, names) };
}

/** Move a schedule's next_fire past `now` (called before a slow start so a crash can't refire it). */
export function advanceNextFire(db: Db, id: string, now = Date.now()): void {
  const t = db.prepare(`SELECT kind, spec_json, enabled FROM triggers WHERE id = ?`).get(id) as { kind: TriggerKind; spec_json: string; enabled: number } | undefined;
  if (!t) return;
  db.prepare(`UPDATE triggers SET next_fire = ? WHERE id = ?`).run(computeNextFire({ kind: t.kind, spec: JSON.parse(t.spec_json), enabled: !!t.enabled }, now), id);
}
