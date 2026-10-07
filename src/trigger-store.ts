import crypto from "node:crypto";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import { scheduleStatus, type ScheduleStatus } from "./thread-schedule.js";
import { describeWhen, newSecret, nextFire, parseCron, type TriggerInput, type TriggerKind, type TriggerSpec } from "./triggers.js";

/**
 * Owner-scoped persistence for triggers (the pure rules live in src/triggers.ts). Every read and
 * write takes the owner, so one tenant can never list, edit or fire another's automation. The
 * webhook secret is sealed at rest and only ever returned in plaintext by `revealSecret` (the route
 * shows it once, at creation or rotation).
 */

export type TriggerScope = "automation" | "scheduled";

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
  /** Alert presets: whether the vendor signing secret is set (never the secret itself). */
  hasSigningSecret: boolean;
  /** Authored by an agent (<!-- automate -->), paused until the owner enables or dismisses it. */
  proposed: boolean;
  /** The thread an agent proposed it from. */
  sourceBox?: string;
  /** scheduled: follow-up work an agent put on the calendar from a chat; automation: a standing rule. */
  scope: TriggerScope;
  createdAt: number;
  updatedAt: number;
}

const MAX_PAYLOAD_CHARS = 64_000;

/** First sighting of a proposal in a thread → true; every later sweep (or after a dismissal) → false. */
export function firstSighting(db: Db, box: string, key: string, now = Date.now()): boolean {
  return db.prepare(`INSERT OR IGNORE INTO trigger_proposals_seen (box, key, at) VALUES (?, ?, ?)`).run(box, key, now).changes > 0;
}

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
    // triggers.concurrency is orphaned: every fire gets its own box; the column is neither read nor written.
    // triggers.budget_json is orphaned: budgets were removed; the column is neither read nor written.
    prComment: !!r.pr_comment,
    quiet: !!r.quiet,
    ...(r.agent ? { agent: r.agent } : {}),
    ...(r.model ? { model: r.model } : {}),
    ...(r.harness_id ? { harnessId: r.harness_id } : {}),
    ...(r.workflow_id ? { workflowId: r.workflow_id } : {}),
    lastFired: r.last_fired ?? null,
    nextFire: r.next_fire ?? null,
    lastResult: parse<TriggerResult | null>(r.last_result_json, null),
    hasPayload: !!r.last_payload_json,
    hasSigningSecret: !!r.signing_secret_enc,
    proposed: !!r.proposed,
    ...(r.source_box ? { sourceBox: String(r.source_box) } : {}),
    scope: r.scope === "scheduled" ? "scheduled" : "automation",
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** A one-time run that could not start (storm cap) tries again this much later. */
const ONCE_RETRY_MS = 60_000;

/**
 * The next fire for a schedule, or null (not a schedule / disabled / never matches). A one-time
 * run is due at its instant until it has fired; one approved after its time runs at once.
 */
export function computeNextFire(t: Pick<TriggerInput, "kind" | "spec" | "enabled">, now: number, fired = false): number | null {
  if (t.kind !== "schedule" || !t.enabled) return null;
  if (t.spec.at) return fired ? null : Math.max(t.spec.at, now);
  if (!t.spec.cron) return null;
  try {
    return nextFire(parseCron(t.spec.cron), now, t.spec.timezone ?? "UTC");
  } catch {
    return null;
  }
}

export function createTrigger(
  db: Db,
  box: SecretBox,
  owner: string,
  t: TriggerInput,
  now = Date.now(),
  opts: { proposed?: boolean; sourceBox?: string; scope?: TriggerScope } = {}
): { row: TriggerRow; secret: string } {
  const id = "trg_" + crypto.randomBytes(9).toString("base64url");
  const secret = newSecret();
  // A proposal is always created paused: the agent suggests, the owner enables.
  const enabled = opts.proposed ? false : t.enabled;
  db.prepare(
    `INSERT INTO triggers (id, owner, name, kind, spec_json, repo, task_template, enabled, pr_comment, quiet, proposed, agent, model, harness_id, workflow_id, source_box, scope, secret_enc, next_fire, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, owner, t.name, t.kind, JSON.stringify(t.spec), t.repo ?? null, t.taskTemplate, enabled ? 1 : 0,
    t.prComment ? 1 : 0, t.quiet ? 1 : 0, opts.proposed ? 1 : 0, t.agent ?? null, t.model ?? null, t.harnessId ?? null, t.workflowId ?? null, opts.sourceBox ?? null, opts.scope ?? "automation", box.seal(secret),
    computeNextFire({ ...t, enabled }, now), now, now
  );
  return { row: getTrigger(db, owner, id)!, secret };
}

export function updateTrigger(db: Db, owner: string, id: string, t: TriggerInput, now = Date.now()): TriggerRow | undefined {
  const cur = getTrigger(db, owner, id);
  const r = db
    .prepare(
      `UPDATE triggers SET name = ?, kind = ?, spec_json = ?, repo = ?, task_template = ?, enabled = ?,
       pr_comment = ?, quiet = ?, agent = ?, model = ?, harness_id = ?, workflow_id = ?, next_fire = ?, updated_at = ? WHERE id = ? AND owner = ?`
    )
    .run(
      t.name, t.kind, JSON.stringify(t.spec), t.repo ?? null, t.taskTemplate, t.enabled ? 1 : 0,
      t.prComment ? 1 : 0, t.quiet ? 1 : 0, t.agent ?? null, t.model ?? null, t.harnessId ?? null, t.workflowId ?? null, computeNextFire(t, now, cur?.lastFired != null), now, id, owner
    );
  return r.changes ? getTrigger(db, owner, id) : undefined;
}

export function setEnabled(db: Db, owner: string, id: string, enabled: boolean, now = Date.now()): TriggerRow | undefined {
  const cur = getTrigger(db, owner, id);
  if (!cur) return undefined;
  // Enabling a proposal IS approving it: it stops being "proposed by the agent" and runs like any other.
  db.prepare(`UPDATE triggers SET enabled = ?, proposed = CASE WHEN ? THEN 0 ELSE proposed END, next_fire = ?, updated_at = ? WHERE id = ? AND owner = ?`).run(
    enabled ? 1 : 0, enabled ? 1 : 0, computeNextFire({ ...cur, enabled }, now, cur.lastFired !== null), now, id, owner
  );
  return getTrigger(db, owner, id);
}

/** "Make it an automation": a repeating chat schedule becomes a standing rule. A one-time run can't. */
export function promoteTrigger(db: Db, owner: string, id: string, now = Date.now()): TriggerRow | undefined {
  const cur = getTrigger(db, owner, id);
  if (!cur || cur.spec.at) return undefined;
  db.prepare(`UPDATE triggers SET scope = 'automation', updated_at = ? WHERE id = ? AND owner = ?`).run(now, id, owner);
  return getTrigger(db, owner, id);
}

export function deleteTrigger(db: Db, owner: string, id: string): boolean {
  const n = db.prepare(`DELETE FROM triggers WHERE id = ? AND owner = ?`).run(id, owner).changes;
  if (n) {
    db.prepare(`DELETE FROM trigger_deliveries WHERE trigger_id = ?`).run(id);
    db.prepare(`DELETE FROM trigger_delivery_log WHERE trigger_id = ?`).run(id);
  }
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

/** Enabled repo-activity automations (the repo watcher's poll set). */
export function watchTriggers(db: Db): TriggerRow[] {
  return (db.prepare(`SELECT * FROM triggers WHERE kind = 'watch' AND enabled = 1`).all() as Array<Record<string, unknown>>).map(toRow);
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
  const next = computeNextFire({ kind: t.kind, spec: JSON.parse(t.spec_json), enabled: !!t.enabled }, now, true);
  db.prepare(`UPDATE triggers SET last_fired = ?, next_fire = ?, last_result_json = ? WHERE id = ?`).run(now, next, JSON.stringify(result), id);
  logFromResult(db, id, result);
}

/** Record a skip without touching last_fired (a skip is not a fire), but DO advance a schedule. */
export function markSkipped(db: Db, id: string, result: TriggerResult, now = Date.now()): void {
  const t = db.prepare(`SELECT kind, spec_json, enabled FROM triggers WHERE id = ?`).get(id) as { kind: TriggerKind; spec_json: string; enabled: number } | undefined;
  if (!t) return;
  const spec = JSON.parse(t.spec_json) as TriggerSpec;
  const next = spec.at ? (t.enabled ? now + ONCE_RETRY_MS : null) : computeNextFire({ kind: t.kind, spec, enabled: !!t.enabled }, now);
  db.prepare(`UPDATE triggers SET next_fire = ?, last_result_json = ? WHERE id = ?`).run(next, JSON.stringify(result), id);
  logFromResult(db, id, result);
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

/** The API view: adds "when" in words (and the quiet counter for quiet automations); never includes the secret. */
export function viewTrigger(t: TriggerRow, names: Record<string, string>, db?: Db): TriggerRow & { when: string; status: ScheduleStatus; lastDelivery?: DeliveryEntry; counts?: QuietCounts } {
  const ld = db ? lastDelivery(db, t.id) : undefined;
  const counts = db && t.quiet ? quietCounts(db, t.id) : undefined;
  return { ...t, when: describeWhen(t, names), status: scheduleStatus(t), ...(ld ? { lastDelivery: ld } : {}), ...(counts ? { counts } : {}) };
}

/* ───────────────────────────── quiet runs ───────────────────────────── */

export interface QuietCounts {
  /** Fired runs that finished with the quiet marker: nothing needed the operator. */
  checked: number;
  /** Fired runs that finished with something to show. */
  reports: number;
}

/** Stamp the fired delivery for `box` with how its run finished: quiet (nothing to show) or a report. */
export function markDeliveryFinished(db: Db, triggerId: string, box: string, quiet: boolean): void {
  db.prepare(`UPDATE trigger_delivery_log SET quiet = ? WHERE id = (SELECT id FROM trigger_delivery_log WHERE trigger_id = ? AND box = ? ORDER BY id DESC LIMIT 1)`).run(
    quiet ? 1 : 0, triggerId, box
  );
}

export function quietCounts(db: Db, triggerId: string): QuietCounts {
  const r = db
    .prepare(`SELECT SUM(CASE WHEN quiet = 1 THEN 1 ELSE 0 END) AS checked, SUM(CASE WHEN quiet = 0 THEN 1 ELSE 0 END) AS reports FROM trigger_delivery_log WHERE trigger_id = ? AND outcome = 'fired'`)
    .get(triggerId) as { checked: number | null; reports: number | null };
  return { checked: Number(r.checked ?? 0), reports: Number(r.reports ?? 0) };
}

/** Every dispatcher outcome (webhook, schedule, chain, run-now) lands in the delivery log. */
function logFromResult(db: Db, id: string, result: TriggerResult): void {
  const reason = reasonOf(result);
  logDelivery(db, id, {
    at: result.at,
    outcome: result.outcome === "started" ? "fired" : result.outcome,
    ...(reason ? { reason } : {}),
    ...(result.reason ? { detail: result.reason } : {}),
    ...(result.box ? { box: result.box } : {}),
  });
}

/** Move a schedule's next_fire past `now` (called before a slow start so a crash can't refire it). */
export function advanceNextFire(db: Db, id: string, now = Date.now()): void {
  const t = db.prepare(`SELECT kind, spec_json, enabled FROM triggers WHERE id = ?`).get(id) as { kind: TriggerKind; spec_json: string; enabled: number } | undefined;
  if (!t) return;
  // A one-time run is treated as fired here: a crash mid-start must not start it twice.
  db.prepare(`UPDATE triggers SET next_fire = ? WHERE id = ?`).run(computeNextFire({ kind: t.kind, spec: JSON.parse(t.spec_json), enabled: !!t.enabled }, now, true), id);
}

/* ───────────────────────────── delivery log (bet 4) ───────────────────────────── */

export type DeliveryOutcome = "fired" | "skipped" | "rejected" | "failed";
/** Why a delivery didn't fire, in one word the UI can badge. */
export type DeliveryReason = "cooldown" | "disabled" | "limit" | "dedupe" | "ignored" | "signature" | "payload" | "error" | "sender" | "asked";

export interface DeliveryEntry {
  id: number;
  at: number;
  outcome: DeliveryOutcome;
  reason?: DeliveryReason;
  detail?: string;
  box?: string;
  test?: boolean;
  /** The fired run finished with the quiet marker — nothing needed the operator. */
  quiet?: boolean;
}

/** Deliveries kept per automation. A short log, not a live feed. */
export const DELIVERY_LOG_MAX = 50;

export function logDelivery(db: Db, triggerId: string, e: Omit<DeliveryEntry, "id">): number {
  const id = Number(
    db
      .prepare(`INSERT INTO trigger_delivery_log (trigger_id, at, outcome, reason, detail, box, test) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(triggerId, e.at, e.outcome, e.reason ?? null, e.detail ? e.detail.slice(0, 300) : null, e.box ?? null, e.test ? 1 : 0).lastInsertRowid
  );
  db.prepare(
    `DELETE FROM trigger_delivery_log WHERE trigger_id = ? AND id NOT IN (SELECT id FROM trigger_delivery_log WHERE trigger_id = ? ORDER BY id DESC LIMIT ?)`
  ).run(triggerId, triggerId, DELIVERY_LOG_MAX);
  return id;
}

const toEntry = (r: Record<string, any>): DeliveryEntry => ({
  id: r.id,
  at: Number(r.at),
  outcome: r.outcome,
  ...(r.reason ? { reason: r.reason } : {}),
  ...(r.detail ? { detail: r.detail } : {}),
  ...(r.box ? { box: r.box } : {}),
  ...(r.test ? { test: true } : {}),
  ...(r.quiet ? { quiet: true } : {}),
});

/** Newest first. Owner-scoped through the trigger row. */
export function listDeliveries(db: Db, owner: string, triggerId: string, limit = DELIVERY_LOG_MAX): DeliveryEntry[] {
  return (
    db
      .prepare(
        `SELECT l.* FROM trigger_delivery_log l JOIN triggers t ON t.id = l.trigger_id WHERE l.trigger_id = ? AND t.owner = ? ORDER BY l.id DESC LIMIT ?`
      )
      .all(triggerId, owner, Math.min(limit, DELIVERY_LOG_MAX)) as Array<Record<string, any>>
  ).map(toEntry);
}

export function lastDelivery(db: Db, triggerId: string): DeliveryEntry | undefined {
  const r = db.prepare(`SELECT * FROM trigger_delivery_log WHERE trigger_id = ? ORDER BY id DESC LIMIT 1`).get(triggerId) as Record<string, any> | undefined;
  return r ? toEntry(r) : undefined;
}

/** Mark the entry the dispatcher just wrote for this fire as a test delivery. */
export function markDeliveryTest(db: Db, triggerId: string, at: number): void {
  db.prepare(`UPDATE trigger_delivery_log SET test = 1 WHERE id = (SELECT id FROM trigger_delivery_log WHERE trigger_id = ? AND at = ? ORDER BY id DESC LIMIT 1)`).run(triggerId, at);
}

/** Map an admission / failure reason from the dispatcher onto a log badge. */
export function reasonOf(result: TriggerResult): DeliveryReason | undefined {
  if (result.outcome === "started") return undefined;
  if (result.outcome === "failed") return "error";
  const r = result.reason ?? "";
  if (r === "disabled") return "disabled";
  if (/^storm cap/.test(r)) return "limit";
  return "ignored";
}

/* ───────────────────────────── vendor signing secret (bet 3) ───────────────────────────── */

export function setSigningSecret(db: Db, box: SecretBox, owner: string, id: string, secret: string): boolean {
  return db.prepare(`UPDATE triggers SET signing_secret_enc = ? WHERE id = ? AND owner = ?`).run(box.seal(secret), id, owner).changes > 0;
}

export function revealSigningSecret(db: Db, box: SecretBox, id: string): string | undefined {
  const r = db.prepare(`SELECT signing_secret_enc FROM triggers WHERE id = ?`).get(id) as { signing_secret_enc: string | null } | undefined;
  if (!r?.signing_secret_enc) return undefined;
  try {
    return box.open(r.signing_secret_enc);
  } catch {
    return undefined;
  }
}
