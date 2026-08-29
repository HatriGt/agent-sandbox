import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.js";
import { createLocalUser, listUsers, deleteUser, upsertGithubUser, createApiKey, principalFromApiKey, recordBoxOwner, ownerOf } from "../src/identity.js";

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
