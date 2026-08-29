import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.js";
import { createLocalUser, createPasswordUser, listUsers, deleteUser, upsertGithubUser, createApiKey, principalFromApiKey, recordBoxOwner, ownerOf } from "../src/identity.js";

test("security: a password sign-up cannot claim an admin login, and cannot be hijacked by a later GitHub sign-in", () => {
  const db = openMemoryDb();
  // Attacker registers the admin's GitHub username with a password.
  const squatter = createPasswordUser(db, { login: "HatriGt", name: "x", email: null, password: "squatter-password-1" }, { adminLogins: ["HatriGt"], firstIsAdmin: false });
  assert.equal(squatter.role, "user", "ADMIN_GITHUB_LOGINS never applies to password accounts");
  // The real person signs in with GitHub.
  const real = upsertGithubUser(db, { githubId: "999", login: "HatriGt" }, { adminLogins: ["HatriGt"] });
  assert.notEqual(real.id, squatter.id, "not linked to the squatted account");
  assert.equal(real.role, "admin");
  assert.equal(real.login, "HatriGt-2", "unique login for the verified identity");
  assert.equal(principalFromApiKey(db, createApiKey(db, squatter.id, "k").token)?.kind === "user", true);
});

test("local users: created by an admin, sign in with a key, later link a GitHub identity by login", () => {
  const db = openMemoryDb();
  const u = createLocalUser(db, { login: "carol" });
  assert.throws(() => createLocalUser(db, { login: "Carol" }), /already exists/);
  assert.throws(() => createLocalUser(db, { login: "bad name!" }));
  const k = createApiKey(db, u.id, "first sign-in");
  assert.equal(principalFromApiKey(db, k.token)?.kind, "user");
  const linked = upsertGithubUser(db, { githubId: "77", login: "carol" });
  assert.equal(linked.id, u.id, "same person, one account");
  assert.equal(listUsers(db)[0].keys, 1);
  recordBoxOwner(db, "pool-c", u.id);
  assert.equal(deleteUser(db, u.id), true);
  assert.equal(principalFromApiKey(db, k.token), null, "keys die with the user");
  assert.equal(ownerOf(db, "pool-c"), null, "their boxes fall back to the operator");
});
