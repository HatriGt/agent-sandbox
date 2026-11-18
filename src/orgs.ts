/**
 * Organisations: one person owns it, invites their team by email, and whatever the org configures
 * — MCP servers, skills, memory — reaches every member's runs without the member doing anything.
 *
 * The org is a second owner key for the same three encrypted stores (user_blobs, kind mcp/skills/
 * memory): its id (`org_…`) is the owner, so every parser, mask, lock and route the personal stores
 * have works unchanged under `withOwner(orgId, …)`. At install time a member's run merges their own
 * store with each org's (`merge*` below): the member's own entry wins on a name clash, an org's
 * disabled entries stay out, and nothing of the org's is ever written back into the member's row.
 *
 * Membership is by email. An invite is a row with no user yet; it links the moment a user carrying
 * that email signs up, signs in, sets the email on their account, or simply opens a page that asks
 * `orgsOf` — so "add their emails" is the whole onboarding. The owner is not a member row: the org's
 * `owner_id` is, which is why an owner without an email on file still owns the org.
 *
 * Pure shaping and the merges are here next to the database functions; both are unit-tested.
 */
import crypto from "node:crypto";
import type { Db } from "./db.js";
import { nowIso } from "./db.js";
import { deleteBlobs } from "./user-store.js";
import type { McpStore, McpServer } from "./mcp-store.js";
import type { SkillStore, SkillDef } from "./skill-store.js";
import type { MemoryStore, MemoryNote } from "./memory-store.js";

export type OrgRole = "owner" | "admin" | "member";

export interface OrgRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface OrgView {
  id: string;
  name: string;
  /** The caller's role in it. */
  role: OrgRole;
  ownerId: string;
  ownerLogin: string | null;
  createdAt: string;
  /** People who have signed in (owner included). */
  members: number;
  /** Invites still waiting for a sign-in. */
  pending: number;
}

export interface OrgMemberView {
  email: string;
  userId: string | null;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: OrgRole;
  status: "joined" | "invited";
  invitedAt: string | null;
  joinedAt: string | null;
}

export const ORG_LIMITS = {
  /** Orgs one person may own. */
  maxOwned: 5,
  /** Rows (joined + invited) per org. */
  maxMembers: 200,
  /** Emails one invite call may carry. */
  maxInviteBatch: 100,
  nameMin: 2,
  nameMax: 60,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** `@login`: a GitHub handle (1-39 chars, letters, digits and single hyphens as GitHub allows). */
const HANDLE_RE = /^@[a-z0-9](?:-?[a-z0-9]){0,38}$/;
/** An invite row keyed by handle stores `@login`; the person's row links by login, not email. */
export const isHandle = (key: string): boolean => key.startsWith("@");
const rand = (bytes: number) => crypto.randomBytes(bytes).toString("base64url");

/** Is this owner key an organisation's (so its stores are shared, never personal)? */
export const isOrgOwner = (owner: string): boolean => owner.startsWith("org_");

export const canManage = (role: OrgRole | null | undefined): boolean => role === "owner" || role === "admin";

/* ───────────────────────────── pure shaping ───────────────────────────── */

/** A pasted list — commas, semicolons, spaces, newlines, "Name <a@b.c>" — into unique lowercase addresses. */
/**
 * Email addresses and GitHub handles (`@login`) out of a pasted list in any shape, unique and
 * lowercase, in `emails` (the key every route and the dashboard already use); anything else in
 * `invalid`. A handle is for the person who signed in with GitHub and never set an email.
 */
export function parseEmails(raw: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  // "Ann Example <ann@example.com>" is the address alone before the split.
  for (const part of raw.replace(/[^<>,;\n]*<([^<>\s]+)>/g, "$1").split(/[\s,;]+/)) {
    if (!part) continue;
    const e = part.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e) && !HANDLE_RE.test(e)) {
      invalid.push(part);
      continue;
    }
    if (seen.has(e)) continue;
    seen.add(e);
    emails.push(e);
  }
  return { emails, invalid };
}

export function normalizeOrgName(raw: unknown): string {
  const name = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < ORG_LIMITS.nameMin || name.length > ORG_LIMITS.nameMax) throw new Error(`Organisation name: ${ORG_LIMITS.nameMin}–${ORG_LIMITS.nameMax} characters.`);
  return name;
}

/**
 * MCP servers a member's run gets: their own, then each org's enabled servers under a name no own
 * server uses (first org wins a clash between orgs). An org server stays an org server: its
 * `enabled` is the org's call, so a member cannot switch one off — they can only shadow it by
 * defining their own under the same name.
 */
export function mergeMcpStores(own: McpStore, shared: McpStore[]): McpStore {
  const servers = { ...own.servers };
  for (const s of shared) {
    for (const [name, def] of Object.entries(s.servers)) {
      if (!def.enabled || servers[name]) continue;
      servers[name] = def;
    }
  }
  return { servers };
}

/** Skills the same way: own first, org skills fill the gaps, disabled org skills stay out. */
export function mergeSkillStores(own: SkillStore, shared: SkillStore[]): SkillStore {
  const skills = { ...own.skills };
  for (const s of shared) {
    for (const [name, def] of Object.entries(s.skills)) {
      if (!def.enabled || skills[name]) continue;
      skills[name] = def;
    }
  }
  return { skills };
}

/**
 * Memory: the member's notes plus every org's (an org whose memory switch is off contributes
 * nothing). The merged store shares the member's note OBJECTS, so recall counters bumped on a
 * selection land on the member's own notes and the member's own store is what gets saved —
 * episodes and receipts stay the member's, and no org note is ever copied into their row.
 */
export function mergeMemoryStores(own: MemoryStore, shared: MemoryStore[]): MemoryStore {
  const live = shared.filter((s) => s.enabled);
  if (!live.length) return own;
  const seen = new Set<string>([...own.global, ...Object.values(own.repos).flat()].map((n) => n.id));
  const take = (list: MemoryNote[]): MemoryNote[] =>
    list.filter((n) => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
  const global = [...own.global];
  const repos: Record<string, MemoryNote[]> = {};
  for (const [slug, list] of Object.entries(own.repos)) repos[slug] = [...list];
  for (const s of live) {
    global.push(...take(s.global));
    for (const [slug, list] of Object.entries(s.repos)) {
      const got = take(list);
      if (!got.length) continue;
      (repos[slug] ??= []).push(...got);
    }
  }
  return { ...own, global, repos };
}

/* ───────────────────────────── copies that follow their source ───────────────────────────── */

/**
 * Provenance of an organisation's copy of a person's own server, skill or note ("From yours").
 * While the stamp is there the person's later saves of that entry reach the org's copy: the
 * dashboard routes call followSkill / followServer / followNote after an own-store save, once per
 * organisation the person can still manage. The org's copy keeps its own `enabled` (whether the
 * org shares it is the org's call) and its `addedAt`; everything else is the source's. Removing
 * the source leaves the org's copy in place, unstamped — the org keeps what it was given.
 *
 * A copy made before stamps existed is claimed the first time its source is saved: an org entry
 * under the same name that still equals the source's previous version can only be a copy of it.
 */
export interface CopiedFrom {
  /** The person whose own entry this is a copy of. */
  user: string;
  login: string;
  /** The source entry's name at the last sync (notes keep their id instead). */
  name?: string;
  /** When the copy last followed its source. */
  at: number;
}

/** JSON with object keys sorted at every level, so two entries compare by content, not key order. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}
const skillBody = (s: SkillDef): string => canon({ description: s.description, content: s.content, files: s.files ?? [] });
const serverBody = (s: McpServer): string => canon({ type: s.type, command: s.command, args: s.args ?? [], url: s.url, env: s.env ?? {}, headers: s.headers ?? {} });

/** The org entry that is this person's copy of `name`: stamped as such, else an unstamped faithful copy of `before`. */
function linkedEntry<T extends { from?: CopiedFrom }>(entries: Record<string, T>, user: string, name: string, before: T | undefined, body: (e: T) => string): { key: string; entry: T } | null {
  for (const [key, entry] of Object.entries(entries)) if (entry.from?.user === user && entry.from.name === name) return { key, entry };
  const same = entries[name];
  if (same && !same.from && before && body(same) === body(before)) return { key: name, entry: same };
  return null;
}

/**
 * The person saved (`after`), renamed (`name` is the old one) or removed (`after` undefined) their
 * own skill: the org's copy follows. Returns whether the org store changed.
 */
export function followSkill(org: SkillStore, who: { user: string; login: string }, name: string, before: SkillDef | undefined, after: SkillDef | undefined, now = Date.now()): boolean {
  const hit = linkedEntry(org.skills, who.user, name, before, skillBody);
  if (!hit) return false;
  if (!after) {
    const had = !!hit.entry.from;
    delete hit.entry.from;
    return had;
  }
  // A rename onto a name the org already uses for something else: the org's entry stays.
  if (after.name !== hit.key && org.skills[after.name]) return false;
  delete org.skills[hit.key];
  org.skills[after.name] = { ...structuredClone(after), enabled: hit.entry.enabled, addedAt: hit.entry.addedAt, from: { user: who.user, login: who.login, name: after.name, at: now } };
  return true;
}

/** Same for an MCP server — the org's copy gets the real env and headers, as the copy did. */
export function followServer(org: McpStore, who: { user: string; login: string }, name: string, before: McpServer | undefined, after: McpServer | undefined, now = Date.now()): boolean {
  const hit = linkedEntry(org.servers, who.user, name, before, serverBody);
  if (!hit) return false;
  if (!after) {
    const had = !!hit.entry.from;
    delete hit.entry.from;
    return had;
  }
  if (after.name !== hit.key && org.servers[after.name]) return false;
  delete org.servers[hit.key];
  org.servers[after.name] = { ...structuredClone(after), enabled: hit.entry.enabled, addedAt: hit.entry.addedAt, from: { user: who.user, login: who.login, name: after.name, at: now } };
  return true;
}

/**
 * A memory note keeps its id across the copy, so the id is the link. The org's copy follows the
 * text, rationale, pin, knowledge-base fields and the repo it is filed under; its recall counters
 * stay. A note forgotten by its owner stays in the org, unstamped.
 */
export function followNote(org: MemoryStore, who: { user: string; login: string }, id: string, after: MemoryNote | undefined, now = Date.now()): boolean {
  for (const list of [org.global, ...Object.values(org.repos)]) {
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) continue;
    const cur = list[i];
    if (cur.from && cur.from.user !== who.user) return false;
    if (!after) {
      const had = !!cur.from;
      delete cur.from;
      return had;
    }
    list.splice(i, 1);
    const { uses: _u, lastUsed: _l, stale: _s, from: _f, ...rest } = after;
    const next: MemoryNote = { ...structuredClone(rest), source: "you", at: cur.at, from: { user: who.user, login: who.login, at: now } };
    if (cur.uses) {
      next.uses = cur.uses;
      if (cur.lastUsed) next.lastUsed = cur.lastUsed;
    }
    (after.scope === "repo" && after.repo ? (org.repos[after.repo] ??= []) : org.global).push(next);
    return true;
  }
  return false;
}

/* ───────────────────────────── database ───────────────────────────── */

export function createOrg(db: Db, ownerId: string, rawName: unknown): OrgRow {
  const name = normalizeOrgName(rawName);
  const owned = (db.prepare(`SELECT COUNT(*) AS n FROM orgs WHERE owner_id = ?`).get(ownerId) as { n: number }).n;
  if (owned >= ORG_LIMITS.maxOwned) throw new Error(`You already own ${ORG_LIMITS.maxOwned} organisations.`);
  const id = `org_${rand(12)}`;
  db.prepare(`INSERT INTO orgs (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)`).run(id, name, ownerId, nowIso());
  return db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(id) as OrgRow;
}

export function getOrg(db: Db, id: string): OrgRow | undefined {
  return db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(id) as OrgRow | undefined;
}

export function renameOrg(db: Db, id: string, rawName: unknown): boolean {
  return db.prepare(`UPDATE orgs SET name = ? WHERE id = ?`).run(normalizeOrgName(rawName), id).changes > 0;
}

/** The org, its member rows (cascade) and its three stores. */
export function deleteOrg(db: Db, id: string): boolean {
  const gone = db.prepare(`DELETE FROM orgs WHERE id = ?`).run(id).changes > 0;
  if (gone) deleteBlobs(id);
  return gone;
}

/**
 * Turn every invite addressed to this user's email into a membership. Cheap (one indexed update),
 * so it runs wherever membership is asked for — the invite "arrives" the moment the person shows up.
 */
export function linkInvites(db: Db, userId: string): number {
  const u = db.prepare(`SELECT email, login FROM users WHERE id = ?`).get(userId) as { email: string | null; login: string } | undefined;
  if (!u) return 0;
  const keys = [u.email?.toLowerCase(), `@${u.login.toLowerCase()}`].filter((k): k is string => !!k);
  // An org that already has this person (through the other key) keeps one row: the redundant
  // invite goes, so a person invited by both email and handle is a member once.
  const drop = db.prepare(`DELETE FROM org_members WHERE user_id IS NULL AND email = ? AND org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)`);
  const link = db.prepare(`UPDATE org_members SET user_id = ?, joined_at = COALESCE(joined_at, ?) WHERE user_id IS NULL AND email = ?`);
  let n = 0;
  const now = nowIso();
  for (const k of keys) {
    drop.run(k, userId);
    n += link.run(userId, now, k).changes;
  }
  return n;
}

/** The organisations this user belongs to, owned first, with the user's role in each. */
export function orgsOf(db: Db, userId: string): OrgView[] {
  linkInvites(db, userId);
  const rows = db
    .prepare(
      `SELECT o.*, 'owner' AS role FROM orgs o WHERE o.owner_id = ?
       UNION ALL
       SELECT o.*, m.role AS role FROM orgs o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = ? AND o.owner_id != ?
       ORDER BY created_at`
    )
    .all(userId, userId, userId) as Array<OrgRow & { role: OrgRole }>;
  const byId = new Map<string, OrgRow & { role: OrgRole }>();
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()]
    .sort((a, b) => (a.role === "owner" ? 0 : 1) - (b.role === "owner" ? 0 : 1) || a.created_at.localeCompare(b.created_at))
    .map((r) => viewOrg(db, r, r.role));
}

function viewOrg(db: Db, o: OrgRow, role: OrgRole): OrgView {
  const c = db.prepare(`SELECT SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS joined, SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS pending FROM org_members WHERE org_id = ?`).get(o.id) as { joined: number | null; pending: number | null };
  const owner = db.prepare(`SELECT login FROM users WHERE id = ?`).get(o.owner_id) as { login: string } | undefined;
  return { id: o.id, name: o.name, role, ownerId: o.owner_id, ownerLogin: owner?.login ?? null, createdAt: o.created_at, members: (c.joined ?? 0) + 1, pending: c.pending ?? 0 };
}

/** This user's role in the org, or null when they are not in it. */
export function orgRole(db: Db, orgId: string, userId: string): OrgRole | null {
  const o = getOrg(db, orgId);
  if (!o) return null;
  if (o.owner_id === userId) return "owner";
  linkInvites(db, userId);
  const m = db.prepare(`SELECT role FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, userId) as { role: OrgRole } | undefined;
  return m ? (m.role === "admin" ? "admin" : "member") : null;
}

/** The ids of every org this owner key belongs to — what the stores merge at install time. */
export function sharedOrgIds(db: Db, owner: string): string[] {
  if (isOrgOwner(owner) || owner === "operator") return [];
  return orgsOf(db, owner).map((o) => o.id);
}

export function listMembers(db: Db, orgId: string): OrgMemberView[] {
  const o = getOrg(db, orgId);
  if (!o) return [];
  const owner = db.prepare(`SELECT id, login, name, email, avatar_url FROM users WHERE id = ?`).get(o.owner_id) as { id: string; login: string; name: string | null; email: string | null; avatar_url: string | null } | undefined;
  const rows = db
    .prepare(
      `SELECT m.email, m.user_id, m.role, m.invited_at, m.joined_at, u.login, u.name, u.avatar_url
       FROM org_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.joined_at IS NULL, m.invited_at`
    )
    .all(orgId) as Array<{ email: string; user_id: string | null; role: string; invited_at: string; joined_at: string | null; login: string | null; name: string | null; avatar_url: string | null }>;
  const out: OrgMemberView[] = [];
  if (owner) out.push({ email: owner.email ?? "", userId: owner.id, login: owner.login, name: owner.name, avatarUrl: owner.avatar_url, role: "owner", status: "joined", invitedAt: null, joinedAt: o.created_at });
  for (const r of rows) {
    if (r.user_id && r.user_id === o.owner_id) continue; // the owner invited their own address: one row, theirs
    out.push({
      email: r.email,
      userId: r.user_id,
      login: r.login,
      name: r.name,
      avatarUrl: r.avatar_url,
      role: r.role === "admin" ? "admin" : "member",
      status: r.user_id ? "joined" : "invited",
      invitedAt: r.invited_at,
      joinedAt: r.joined_at,
    });
  }
  return out;
}

/** Someone the invite field's typeahead can offer: on the site already, or found on GitHub. */
export interface PersonHit {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  /** Signed in to Agent Sandbox at least once (an invite by handle links at once). */
  onSite: boolean;
  /** Their standing in the organisation being edited, if any. */
  status: OrgRole | "invited" | null;
}

/** Signed-in people whose login starts with `q` (lowercase, no "@"), shortest login first. */
export function searchUsersByLogin(db: Db, q: string, limit = 6): Omit<PersonHit, "status">[] {
  const like = `${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(`SELECT login, name, avatar_url FROM users WHERE lower(login) LIKE ? ESCAPE '\\' ORDER BY length(login), lower(login) LIMIT ?`)
    .all(like, limit) as Array<{ login: string; name: string | null; avatar_url: string | null }>;
  return rows.map((r) => ({ login: r.login, name: r.name, avatarUrl: r.avatar_url, onSite: true }));
}

/**
 * Invite addresses. An address that already belongs to a user links at once (they are in from this
 * moment); any other waits as an invite. Returns what was added and what was already there.
 */
export function addMembers(db: Db, orgId: string, raw: string, invitedBy: string, role: OrgRole = "member"): { added: string[]; existing: string[]; invalid: string[] } {
  const o = getOrg(db, orgId);
  if (!o) throw new Error("No such organisation.");
  const { emails, invalid } = parseEmails(raw);
  if (!emails.length && !invalid.length) throw new Error("Add at least one email address or GitHub handle.");
  if (emails.length > ORG_LIMITS.maxInviteBatch) throw new Error(`At most ${ORG_LIMITS.maxInviteBatch} addresses at a time.`);
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?`).get(orgId) as { n: number }).n;
  if (count + emails.length > ORG_LIMITS.maxMembers) throw new Error(`An organisation holds at most ${ORG_LIMITS.maxMembers} people.`);
  const ownerRow = db.prepare(`SELECT email, login FROM users WHERE id = ?`).get(o.owner_id) as { email: string | null; login: string } | undefined;
  const ownerKeys = new Set([ownerRow?.email?.toLowerCase(), ownerRow ? `@${ownerRow.login.toLowerCase()}` : undefined].filter(Boolean));
  const added: string[] = [];
  const existing: string[] = [];
  const now = nowIso();
  const insert = db.prepare(`INSERT INTO org_members (org_id, email, user_id, role, invited_by, invited_at, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const byEmail = db.prepare(`SELECT id FROM users WHERE email IS NOT NULL AND lower(email) = ?`);
  const byLogin = db.prepare(`SELECT id FROM users WHERE lower(login) = ?`);
  const hasRow = db.prepare(`SELECT 1 FROM org_members WHERE org_id = ? AND email = ?`);
  const hasUser = db.prepare(`SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?`);
  const tx = db.transaction(() => {
    for (const e of emails) {
      if (ownerKeys.has(e) || hasRow.get(orgId, e)) {
        existing.push(e);
        continue;
      }
      const u = (isHandle(e) ? byLogin.get(e.slice(1)) : byEmail.get(e)) as { id: string } | undefined;
      // The same person under their other key is already a member: say so instead of a second row.
      if (u && (u.id === o.owner_id || hasUser.get(orgId, u.id))) {
        existing.push(e);
        continue;
      }
      insert.run(orgId, e, u?.id ?? null, role === "admin" ? "admin" : "member", invitedBy, now, u ? now : null);
      added.push(e);
    }
  });
  tx();
  return { added, existing, invalid };
}

export function removeMember(db: Db, orgId: string, email: string): boolean {
  return db.prepare(`DELETE FROM org_members WHERE org_id = ? AND email = ?`).run(orgId, email.trim().toLowerCase()).changes > 0;
}

export function setMemberRole(db: Db, orgId: string, email: string, role: "admin" | "member"): boolean {
  return db.prepare(`UPDATE org_members SET role = ? WHERE org_id = ? AND email = ?`).run(role, orgId, email.trim().toLowerCase()).changes > 0;
}

/** A member walks out; the owner cannot (delete the org or hand it over instead). */
export function leaveOrg(db: Db, orgId: string, userId: string): boolean {
  return db.prepare(`DELETE FROM org_members WHERE org_id = ? AND user_id = ?`).run(orgId, userId).changes > 0;
}

/**
 * Hand the org to a joined member: they become the owner, the old owner stays as an admin so
 * nothing they set up stops reaching them.
 */
export function transferOrg(db: Db, orgId: string, toUserId: string): boolean {
  const o = getOrg(db, orgId);
  if (!o || o.owner_id === toUserId) return false;
  const m = db.prepare(`SELECT email FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, toUserId) as { email: string } | undefined;
  if (!m) return false;
  const old = db.prepare(`SELECT email FROM users WHERE id = ?`).get(o.owner_id) as { email: string | null } | undefined;
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM org_members WHERE org_id = ? AND user_id = ?`).run(orgId, toUserId);
    db.prepare(`UPDATE orgs SET owner_id = ? WHERE id = ?`).run(toUserId, orgId);
    const email = old?.email?.toLowerCase() || `${o.owner_id}@no-email.invalid`;
    db.prepare(`INSERT OR REPLACE INTO org_members (org_id, email, user_id, role, invited_by, invited_at, joined_at) VALUES (?, ?, ?, 'admin', ?, ?, ?)`).run(orgId, email, o.owner_id, toUserId, nowIso(), nowIso());
  });
  tx();
  return true;
}
