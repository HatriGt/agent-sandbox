import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.js";
import { hashPassword, verifyPassword, validateSignup, createPasswordUser, authenticatePassword, setPassword } from "../src/identity.js";

test("passwords: scrypt with per-user salt; verify is exact; wrong/missing fail", () => {
  const h = hashPassword("correct horse battery");
  assert.match(h, /^scrypt\$/);
  assert.notEqual(h, hashPassword("correct horse battery"), "fresh salt");
  assert.equal(verifyPassword("correct horse battery", h), true);
  assert.equal(verifyPassword("correct horse batterx", h), false);
  assert.equal(verifyPassword("x", null), false);
  assert.equal(verifyPassword("x", "garbage"), false);
});

test("signup validation", () => {
  assert.equal(validateSignup({ login: "priya", name: "Priya", email: "p@x.io", password: "long enough pw" }).ok, true);
  assert.equal(validateSignup({ login: "p", name: "Priya", password: "long enough pw" }).ok, false, "login too short");
  assert.equal(validateSignup({ login: "priya", name: "", password: "long enough pw" }).ok, false, "name required");
  assert.equal(validateSignup({ login: "priya", name: "P", email: "nope", password: "long enough pw" }).ok, false, "bad email");
  assert.equal(validateSignup({ login: "priya", name: "P", password: "short" }).ok, false, "short password");
  assert.equal(validateSignup({ login: "priya", name: "P", password: "aaaaaaaaaaaa" }).ok, false, "repeated char");
});

test("plans: trial clock, expiry, admins never gated, upgrade clears the clock", async () => {
  const { openMemoryDb } = await import("../src/db.js");
  const { createPasswordUser: mk, startTrial, planOf, setPlan, getUser } = await import("../src/identity.js");
  const db = openMemoryDb();
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  const u = mk(db, { login: "trial", name: "T", email: null, password: "trial-user-passw0rd" });
  startTrial(db, u.id, 7, t0);
  let row = getUser(db, u.id)!;
  assert.equal(planOf(row, t0).daysLeft, 7);
  assert.equal(planOf(row, t0 + 6.5 * 86_400_000).daysLeft, 0);
  assert.equal(planOf(row, t0 + 6.5 * 86_400_000).expired, false);
  assert.equal(planOf(row, t0 + 7 * 86_400_000 + 1).expired, true);
  assert.equal(planOf({ ...row, role: "admin" }, t0 + 30 * 86_400_000).expired, false, "admins are never gated");
  setPlan(db, u.id, "pro");
  row = getUser(db, u.id)!;
  assert.equal(planOf(row, t0 + 365 * 86_400_000).expired, false);
  assert.equal(planOf(row, t0).plan, "pro");
  const s = mk(db, { login: "selfhost", name: "S", email: null, password: "selfhost-passw0rd" });
  startTrial(db, s.id, 0, t0);
  assert.equal(planOf(getUser(db, s.id)!, t0 + 999 * 86_400_000).expired, false, "no trial clock on self-hosted controllers");
});

test("password users: first account is admin, duplicates rejected, login by name or email, password change", () => {
  const db = openMemoryDb();
  const a = createPasswordUser(db, { login: "alice", name: "Alice", email: "a@x.io", password: "alice-secret-pw" }, { firstIsAdmin: true, adminLogins: [] });
  assert.equal(a.role, "admin");
  const b = createPasswordUser(db, { login: "bob", name: "Bob", email: null, password: "bob-secret-pw!" }, { firstIsAdmin: true });
  assert.equal(b.role, "user");
  assert.throws(() => createPasswordUser(db, { login: "Alice", name: "x", email: null, password: "whatever-long" }), /taken/);
  assert.throws(() => createPasswordUser(db, { login: "other", name: "x", email: "A@X.IO", password: "whatever-long" }), /taken/);
  assert.equal(authenticatePassword(db, "alice", "alice-secret-pw")?.id, a.id);
  assert.equal(authenticatePassword(db, "A@x.io", "alice-secret-pw")?.id, a.id);
  assert.equal(authenticatePassword(db, "alice", "wrong-password-x"), null);
  assert.equal(authenticatePassword(db, "nobody", "wrong-password-x"), null);
  setPassword(db, a.id, "new-alice-pw-123");
  assert.equal(authenticatePassword(db, "alice", "alice-secret-pw"), null);
  assert.equal(authenticatePassword(db, "alice", "new-alice-pw-123")?.id, a.id);
});
