import crypto from "node:crypto";
import type { Db } from "./db.js";
import { nowIso } from "./db.js";

/**
 * Who is calling. Resolved once per request, before any handler:
 *   operator — the deployment's own bearer token (root-equivalent; automation and break-glass)
 *   user     — a signed-in person, via the HttpOnly session cookie or an `asb_` API key
 */
export type Principal =
  | { kind: "operator" }
  | { kind: "user"; userId: string; login: string; role: "user" | "admin"; via: "session" | "apikey"; sessionId?: string; apiKeyId?: string };

export interface UserRow {
  id: string;
  github_id: string | null;
  login: string;
  email: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  max_boxes: number | null;
  created_at: string;
  last_seen_at: string | null;
}

export const SESSION_COOKIE = "asb_session";
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const SESSION_TOUCH_MS = 3600_000;
export const LOGIN_STATE_TTL_MS = 10 * 60_000;
export const API_KEY_PREFIX = "asb_";
/** Custom header a same-origin XHR must carry on cookie-authenticated mutations (CSRF). */
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "agent-sandbox";

const rand = (bytes: number) => crypto.randomBytes(bytes).toString("base64url");
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/* ───────────── users ───────────── */

export function upsertGithubUser(
  db: Db,
  u: { githubId: string; login: string; email?: string | null; avatarUrl?: string | null },
  opts: { adminLogins?: string[] } = {}
): UserRow {
  const existing = db.prepare(`SELECT * FROM users WHERE github_id = ?`).get(u.githubId) as UserRow | undefined;
  const now = nowIso();
  if (existing) {
    db.prepare(`UPDATE users SET login = ?, email = COALESCE(?, email), avatar_url = COALESCE(?, avatar_url), last_seen_at = ? WHERE id = ?`).run(u.login, u.email ?? null, u.avatarUrl ?? null, now, existing.id);
    return { ...existing, login: u.login, last_seen_at: now };
  }
  const id = `u_${rand(12)}`;
  const role = (opts.adminLogins ?? []).map((l) => l.toLowerCase()).includes(u.login.toLowerCase()) ? "admin" : "user";
  db.prepare(`INSERT INTO users (id, github_id, login, email, avatar_url, role, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, u.githubId, u.login, u.email ?? null, u.avatarUrl ?? null, role, now, now);
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow;
}

export function getUser(db: Db, id: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

/* ───────────── sessions (opaque, server-side, revocable) ───────────── */

export function createSession(db: Db, userId: string, meta: { ip?: string; userAgent?: string } = {}, now = Date.now()): { id: string; expiresAt: string } {
  const id = rand(32);
  const expiresAt = nowIso(now + SESSION_TTL_MS);
  db.prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, userId, nowIso(now), expiresAt, nowIso(now), meta.ip ?? null, (meta.userAgent ?? "").slice(0, 200) || null);
  return { id, expiresAt };
}

export function principalFromSession(db: Db, sessionId: string | undefined, now = Date.now()): Principal | null {
  if (!sessionId || sessionId.length < 20) return null;
  const row = db.prepare(`SELECT s.id, s.expires_at, s.last_seen_at, u.id AS user_id, u.login, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sessionId) as
    | { id: string; expires_at: string; last_seen_at: string | null; user_id: string; login: string; role: "user" | "admin" }
    | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    return null;
  }
  // Sliding activity stamp, at most hourly, so a busy dashboard does not write on every poll.
  if (!row.last_seen_at || now - Date.parse(row.last_seen_at) > SESSION_TOUCH_MS) {
    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(nowIso(now), sessionId);
    db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).run(nowIso(now), row.user_id);
  }
  return { kind: "user", userId: row.user_id, login: row.login, role: row.role, via: "session", sessionId };
}

export function deleteSession(db: Db, sessionId: string): void {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

/* ───────────── API keys (shown once, stored hashed) ───────────── */

export function createApiKey(db: Db, userId: string, name: string, now = Date.now()): { id: string; token: string; prefix: string } {
  const secret = rand(32);
  const token = `${API_KEY_PREFIX}${secret}`;
  const prefix = token.slice(0, API_KEY_PREFIX.length + 6);
  const id = `k_${rand(9)}`;
  db.prepare(`INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id, userId, name.slice(0, 60) || "key", sha256(token), prefix, nowIso(now));
  return { id, token, prefix };
}

export function principalFromApiKey(db: Db, bearer: string | undefined, now = Date.now()): Principal | null {
  if (!bearer || !bearer.startsWith(API_KEY_PREFIX)) return null;
  const row = db.prepare(`SELECT k.id, k.revoked_at, k.last_used_at, u.id AS user_id, u.login, u.role FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?`).get(sha256(bearer)) as
    | { id: string; revoked_at: string | null; last_used_at: string | null; user_id: string; login: string; role: "user" | "admin" }
    | undefined;
  if (!row || row.revoked_at) return null;
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > SESSION_TOUCH_MS) db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(nowIso(now), row.id);
  return { kind: "user", userId: row.user_id, login: row.login, role: row.role, via: "apikey", apiKeyId: row.id };
}

export function listApiKeys(db: Db, userId: string): Array<{ id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }> {
  return db.prepare(`SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as never;
}

export function revokeApiKey(db: Db, userId: string, id: string, now = Date.now()): boolean {
  return db.prepare(`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(nowIso(now), id, userId).changes > 0;
}

/* ───────────── OAuth login state (single use, short-lived) ───────────── */

export function newLoginState(db: Db, redirectTo: string | undefined, now = Date.now()): string {
  const state = rand(32);
  db.prepare(`DELETE FROM login_states WHERE expires_at < ?`).run(nowIso(now));
  db.prepare(`INSERT INTO login_states (state, expires_at, redirect_to) VALUES (?, ?, ?)`).run(state, nowIso(now + LOGIN_STATE_TTL_MS), redirectTo ?? null);
  return state;
}

export function consumeLoginState(db: Db, state: string | undefined, now = Date.now()): { ok: boolean; redirectTo?: string } {
  if (!state) return { ok: false };
  const row = db.prepare(`SELECT expires_at, redirect_to FROM login_states WHERE state = ?`).get(state) as { expires_at: string; redirect_to: string | null } | undefined;
  db.prepare(`DELETE FROM login_states WHERE state = ?`).run(state);
  if (!row || Date.parse(row.expires_at) <= now) return { ok: false };
  return { ok: true, redirectTo: row.redirect_to ?? undefined };
}

/* ───────────── box ownership — the one lookup every route uses ───────────── */

export function recordBoxOwner(db: Db, name: string, ownerId: string | null, taskHead?: string, now = Date.now()): void {
  db.prepare(`INSERT INTO boxes (name, owner_id, created_at, task_head) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET owner_id = excluded.owner_id, task_head = COALESCE(excluded.task_head, boxes.task_head)`).run(name, ownerId, nowIso(now), taskHead?.slice(0, 200) ?? null);
}

export function forgetBox(db: Db, name: string): void {
  db.prepare(`DELETE FROM boxes WHERE name = ?`).run(name);
}

export function ownerOf(db: Db, name: string): string | null | undefined {
  const row = db.prepare(`SELECT owner_id FROM boxes WHERE name = ?`).get(name) as { owner_id: string | null } | undefined;
  return row ? row.owner_id : undefined; // undefined = no record at all
}

/** May this principal act on this box? Operators and admins: always. Users: only their own. */
export function mayAccess(db: Db, p: Principal, name: string): boolean {
  if (p.kind === "operator" || p.role === "admin") return true;
  return ownerOf(db, name) === p.userId;
}

/** Names of the boxes a user owns (for fleet filtering). */
export function ownedBoxNames(db: Db, userId: string): Set<string> {
  return new Set((db.prepare(`SELECT name FROM boxes WHERE owner_id = ?`).all(userId) as { name: string }[]).map((r) => r.name));
}

/* ───────────── cookies (no dependency) ───────────── */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function sessionCookie(id: string, opts: { secure: boolean; maxAgeSec?: number }): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(id)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.secure) parts.push("Secure");
  parts.push(`Max-Age=${opts.maxAgeSec ?? Math.floor(SESSION_TTL_MS / 1000)}`);
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return sessionCookie("", { secure, maxAgeSec: 0 });
}

/**
 * CSRF for cookie-authenticated mutations: a same-origin fetch can add a custom header; a cross-site
 * form or a no-CORS fetch cannot. Browsers that send Sec-Fetch-Site must say same-origin/none.
 */
export function csrfOk(headers: Record<string, string | string[] | undefined>, publicOrigin?: string): boolean {
  const xr = headers[CSRF_HEADER];
  if ((Array.isArray(xr) ? xr[0] : xr) !== CSRF_VALUE) return false;
  const sfs = headers["sec-fetch-site"];
  const site = Array.isArray(sfs) ? sfs[0] : sfs;
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = headers["origin"];
  const o = Array.isArray(origin) ? origin[0] : origin;
  if (o && publicOrigin && o !== publicOrigin) return false;
  return true;
}
