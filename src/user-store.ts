import type { Db } from "./db.js";
import { nowIso } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import { currentPrincipal, withPrincipal } from "./tenancy.js";
import type { Principal } from "./identity.js";

/**
 * Integrations belong to a person. The GitHub-token and MCP stores keep their function signatures,
 * but when the HTTP controller registers this backend they read and write *the calling principal's*
 * row instead of one shared file. The stdio (local IDE) entry never registers it and keeps the file.
 *
 * Owner keys: a user id, or "operator" for the deployment's own identity (token mode, automation).
 */
export const OPERATOR_OWNER = "operator";

let backend: { db: Db; box: SecretBox } | null = null;
export function registerUserStoreBackend(b: { db: Db; box: SecretBox }): void {
  backend = b;
}
export function hasUserStoreBackend(): boolean {
  return backend !== null;
}

export function ownerKey(p: Principal = currentPrincipal()): string {
  return p.kind === "user" ? p.userId : OPERATOR_OWNER;
}

/** Run `fn` as the owner of a box (background jobs: inbox delivery, credential broker, resumes). */
export function withOwner<T>(ownerId: string | null | undefined, fn: () => T): T {
  if (!ownerId || ownerId === OPERATOR_OWNER) return withPrincipal({ kind: "operator" }, fn);
  return withPrincipal({ kind: "user", userId: ownerId, login: "", role: "user", via: "apikey" }, fn);
}

export function loadBlob(kind: string, owner = ownerKey()): string | null {
  if (!backend) throw new Error("user store backend not registered");
  const row = backend.db.prepare(`SELECT data_enc FROM user_blobs WHERE owner_id = ? AND kind = ?`).get(owner, kind) as { data_enc: string } | undefined;
  return row ? backend.box.open(row.data_enc) : null;
}

export function saveBlob(kind: string, raw: string, owner = ownerKey()): void {
  if (!backend) throw new Error("user store backend not registered");
  backend.db
    .prepare(`INSERT INTO user_blobs (owner_id, kind, data_enc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, kind) DO UPDATE SET data_enc = excluded.data_enc, updated_at = excluded.updated_at`)
    .run(owner, kind, backend.box.seal(raw), nowIso());
}

/** Every owner's blob of one kind — for the redactor, which must know all secrets, not just the caller's. */
export function allBlobs(kind: string): string[] {
  if (!backend) return [];
  const rows = backend.db.prepare(`SELECT data_enc FROM user_blobs WHERE kind = ?`).all(kind) as { data_enc: string }[];
  const out: string[] = [];
  for (const r of rows) {
    try {
      out.push(backend.box.open(r.data_enc));
    } catch {
      /* a row sealed with another key: skip, never crash redaction */
    }
  }
  return out;
}
