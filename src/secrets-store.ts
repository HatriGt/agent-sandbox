/**
 * Secrets vault: per-owner named values (DEPLOY_TOKEN, ANALYTICS_KEY…) sealed at rest with the
 * controller key (src/secretbox.ts), so an unattended run can deploy without a human typing the
 * token into the thread each time.
 *
 * Grants are by NAME, kept where the run's shape already lives: a harness's `secrets` list, or a
 * repo setup profile's `envVars` (the names a repo says it needs). At launch and on every resume the
 * controller resolves the granted names this owner has values for and injects them through the
 * same `-e` path as one-shot `resume({secrets})` — so RESERVED_SECRET_KEYS applies unchanged
 * (src/secret-env.ts refuses a reserved name, and the store refuses to even save one). Values never
 * leave the controller except into a box the owner started; every read API returns names only.
 */
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import { RESERVED_SECRET_KEYS } from "./secret-env.js";

export interface SecretMeta {
  name: string;
  createdAt: number;
  updatedAt: number;
}

export const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]{0,127}$/;
const VALUE_MAX = 16 * 1024;
export const SECRETS_MAX = 100;

/** Validate a secret name as the ENV name it will become. Throws a human message. */
export function secretName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!SECRET_NAME_RE.test(name)) throw new Error("A secret name is an environment variable name: capital letters, digits and underscores, not starting with a digit.");
  if (RESERVED_SECRET_KEYS.has(name)) throw new Error(`"${name}" is set by the sandbox itself and cannot be stored as a secret — it would redirect or reprogram the agent.`);
  return name;
}

export function listSecrets(db: Db, owner: string): SecretMeta[] {
  const rows = db.prepare(`SELECT name, created_at, updated_at FROM secrets WHERE owner = ? ORDER BY name`).all(owner) as Array<{ name: string; created_at: number; updated_at: number }>;
  return rows.map((r) => ({ name: r.name, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) }));
}

/** Insert or replace. A value is text; an empty one is refused (delete instead). */
export function saveSecret(db: Db, box: SecretBox, owner: string, rawName: unknown, rawValue: unknown, now = Date.now()): SecretMeta {
  const name = secretName(rawName);
  const value = typeof rawValue === "string" ? rawValue : "";
  if (!value) throw new Error("A secret needs a value.");
  if (value.includes("\0") || value.includes("\n")) throw new Error("A secret value must be a single line of text.");
  if (value.length > VALUE_MAX) throw new Error(`A secret value is over ${VALUE_MAX / 1024} KB.`);
  const existing = db.prepare(`SELECT created_at FROM secrets WHERE owner = ? AND name = ?`).get(owner, name) as { created_at: number } | undefined;
  if (!existing) {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM secrets WHERE owner = ?`).get(owner) as { n: number }).n;
    if (n >= SECRETS_MAX) throw new Error(`At most ${SECRETS_MAX} secrets.`);
  }
  const createdAt = existing ? Number(existing.created_at) : now;
  db.prepare(
    `INSERT INTO secrets (owner, name, value_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner, name) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`
  ).run(owner, name, box.seal(value), createdAt, now);
  return { name, createdAt, updatedAt: now };
}

export function deleteSecret(db: Db, owner: string, name: string): boolean {
  return db.prepare(`DELETE FROM secrets WHERE owner = ? AND name = ?`).run(owner, name).changes > 0;
}

/**
 * The values for `names` this owner actually holds, as a {NAME: value} map for secretEnvFlags.
 * Unknown names are skipped silently — a repo profile lists what the repo WANTS, not what the owner
 * has — so the caller reports the granted-but-missing ones via `missingSecrets`.
 */
export function resolveSecrets(db: Db, box: SecretBox, owner: string, names: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  const get = db.prepare(`SELECT value_enc FROM secrets WHERE owner = ? AND name = ?`);
  for (const name of new Set(names)) {
    if (RESERVED_SECRET_KEYS.has(name)) continue;
    const row = get.get(owner, name) as { value_enc: string } | undefined;
    if (row) out[name] = box.open(row.value_enc);
  }
  return out;
}

/** Every stored value, for the redactor (a transcript may quote any owner's secret). */
export function allSecretValues(db: Db, box: SecretBox): string[] {
  const rows = db.prepare(`SELECT value_enc FROM secrets`).all() as Array<{ value_enc: string }>;
  const out: string[] = [];
  for (const r of rows) {
    try {
      out.push(box.open(r.value_enc));
    } catch {
      /* a row sealed under a lost key cannot be redacted either way */
    }
  }
  return out;
}

/** Granted names (from harness + repo profiles) the owner holds no value for. */
export function missingSecrets(held: Record<string, string>, granted: Iterable<string>): string[] {
  return [...new Set(granted)].filter((n) => !(n in held)).sort();
}
