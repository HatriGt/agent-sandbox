import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.js";
import {
  upsertGithubUser, createSession, principalFromSession, deleteSession, createApiKey, principalFromApiKey, revokeApiKey, listApiKeys,
  newLoginState, consumeLoginState, recordBoxOwner, mayAccess, ownedBoxNames, parseCookies, sessionCookie, csrfOk, SESSION_TTL_MS, LOGIN_STATE_TTL_MS,
} from "../src/identity.js";

test("identity: github upsert is idempotent and admin logins get the admin role", () => {
  const db = openMemoryDb();
  const a = upsertGithubUser(db, { githubId: "1", login: "alice" }, { adminLogins: ["Alice"] });
  const a2 = upsertGithubUser(db, { githubId: "1", login: "alice-renamed" });
  assert.equal(a.id, a2.id);
  assert.equal(a.role, "admin");
  const b = upsertGithubUser(db, { githubId: "2", login: "bob" });
  assert.equal(b.role, "user");
});

test("identity: sessions are opaque, expire, and can be revoked", () => {
  const db = openMemoryDb();
  const u = upsertGithubUser(db, { githubId: "1", login: "alice" });
  let t = 1_700_000_000_000;
  const s = createSession(db, u.id, { ip: "1.2.3.4" }, t);
  const p = principalFromSession(db, s.id, t + 1000);
  assert.equal(p?.kind, "user");
  assert.equal(p?.kind === "user" && p.userId, u.id);
  assert.equal(principalFromSession(db, "short", t), null);
  assert.equal(principalFromSession(db, s.id, t + SESSION_TTL_MS + 1), null, "expired");
  const s2 = createSession(db, u.id, {}, t);
  deleteSession(db, s2.id);
  assert.equal(principalFromSession(db, s2.id, t), null, "revoked");
});

test("identity: API keys are shown once, stored hashed, revocable", () => {
  const db = openMemoryDb();
  const u = upsertGithubUser(db, { githubId: "1", login: "alice" });
  const k = createApiKey(db, u.id, "cursor");
  assert.match(k.token, /^asb_/);
  const row = db.prepare(`SELECT key_hash FROM api_keys WHERE id = ?`).get(k.id) as { key_hash: string };
  assert.notEqual(row.key_hash, k.token);
  assert.equal(principalFromApiKey(db, k.token)?.kind, "user");
  assert.equal(principalFromApiKey(db, "asb_wrong"), null);
  assert.equal(principalFromApiKey(db, "not-a-key"), null);
  assert.equal(revokeApiKey(db, u.id, k.id), true);
  assert.equal(principalFromApiKey(db, k.token), null, "revoked keys stop working");
  assert.equal(listApiKeys(db, u.id)[0].revoked_at !== null, true);
  const other = upsertGithubUser(db, { githubId: "2", login: "bob" });
  const k2 = createApiKey(db, u.id, "x");
  assert.equal(revokeApiKey(db, other.id, k2.id), false, "cannot revoke someone else's key");
});

test("identity: login state is single-use and short-lived", () => {
  const db = openMemoryDb();
  const t = 1_700_000_000_000;
  const s = newLoginState(db, "/dashboard/fleet", t);
  assert.deepEqual(consumeLoginState(db, s, t + 1000), { ok: true, redirectTo: "/dashboard/fleet" });
  assert.equal(consumeLoginState(db, s, t + 1000).ok, false, "second use fails");
  const s2 = newLoginState(db, undefined, t);
  assert.equal(consumeLoginState(db, s2, t + LOGIN_STATE_TTL_MS + 1).ok, false, "expired");
  assert.equal(consumeLoginState(db, undefined, t).ok, false);
});

test("ownership: users see only their boxes; operators and admins see all; unknown boxes belong to nobody", () => {
  const db = openMemoryDb();
  const alice = upsertGithubUser(db, { githubId: "1", login: "alice" });
  const bob = upsertGithubUser(db, { githubId: "2", login: "bob" });
  const root = upsertGithubUser(db, { githubId: "3", login: "root" }, { adminLogins: ["root"] });
  recordBoxOwner(db, "pool-a", alice.id, "Fix the tests");
  recordBoxOwner(db, "pool-b", bob.id);
  const P = (u: typeof alice) => ({ kind: "user" as const, userId: u.id, login: u.login, role: u.role, via: "session" as const });
  assert.equal(mayAccess(db, P(alice), "pool-a"), true);
  assert.equal(mayAccess(db, P(alice), "pool-b"), false);
  assert.equal(mayAccess(db, P(alice), "pool-legacy"), false, "no record → not yours");
  assert.equal(mayAccess(db, P(root), "pool-b"), true);
  assert.equal(mayAccess(db, { kind: "operator" }, "pool-legacy"), true);
  assert.deepEqual([...ownedBoxNames(db, alice.id)], ["pool-a"]);
  recordBoxOwner(db, "pool-a", bob.id); // re-claim moves ownership
  assert.equal(mayAccess(db, P(alice), "pool-a"), false);
});

test("cookies + csrf", () => {
  assert.deepEqual(parseCookies("a=1; asb_session=abc%20def; bad"), { a: "1", asb_session: "abc def" });
  assert.match(sessionCookie("x", { secure: true }), /HttpOnly; SameSite=Lax; Secure; Max-Age=/);
  assert.equal(csrfOk({ "x-requested-with": "agent-sandbox", "sec-fetch-site": "same-origin" }), true);
  assert.equal(csrfOk({ "x-requested-with": "agent-sandbox" }), true, "old browsers without Sec-Fetch-Site still pass on the header");
  assert.equal(csrfOk({}), false);
  assert.equal(csrfOk({ "x-requested-with": "agent-sandbox", "sec-fetch-site": "cross-site" }), false);
  assert.equal(csrfOk({ "x-requested-with": "agent-sandbox", origin: "https://evil.example" }, "https://asb.example"), false);
  assert.equal(csrfOk({ "x-requested-with": "agent-sandbox", origin: "https://asb.example" }, "https://asb.example"), true);
});
