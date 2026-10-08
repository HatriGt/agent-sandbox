import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import { deleteSecret, listSecrets, missingSecrets, resolveSecrets, saveSecret } from "../src/secrets-store.ts";

const box = makeSecretBox(crypto.randomBytes(32));

test("secrets: values are sealed at rest and resolved only for the owner and the names asked for", () => {
  const db = openMemoryDb();
  saveSecret(db, box, "A", "DEPLOY_TOKEN", "tok-1", 10);
  saveSecret(db, box, "A", "ANALYTICS_KEY", "ak-1", 11);
  saveSecret(db, box, "B", "DEPLOY_TOKEN", "tok-B", 12);
  const raw = db.prepare(`SELECT value_enc FROM secrets WHERE owner = 'A' AND name = 'DEPLOY_TOKEN'`).get() as { value_enc: string };
  assert.ok(!raw.value_enc.includes("tok-1"), "plaintext never hits the row");
  assert.deepEqual(resolveSecrets(db, box, "A", ["DEPLOY_TOKEN", "NOPE", "DEPLOY_TOKEN"]), { DEPLOY_TOKEN: "tok-1" });
  assert.deepEqual(resolveSecrets(db, box, "B", ["DEPLOY_TOKEN", "ANALYTICS_KEY"]), { DEPLOY_TOKEN: "tok-B" });
  assert.deepEqual(missingSecrets(resolveSecrets(db, box, "A", ["DEPLOY_TOKEN", "NOPE"]), ["DEPLOY_TOKEN", "NOPE"]), ["NOPE"]);
  assert.deepEqual(listSecrets(db, "A").map((s) => s.name), ["ANALYTICS_KEY", "DEPLOY_TOKEN"]);
});

test("secrets: replace keeps createdAt and bumps updatedAt; delete is owner-scoped", () => {
  const db = openMemoryDb();
  saveSecret(db, box, "A", "DEPLOY_TOKEN", "v1", 10);
  const m = saveSecret(db, box, "A", "DEPLOY_TOKEN", "v2", 20);
  assert.equal(m.createdAt, 10);
  assert.equal(m.updatedAt, 20);
  assert.deepEqual(resolveSecrets(db, box, "A", ["DEPLOY_TOKEN"]), { DEPLOY_TOKEN: "v2" });
  assert.equal(deleteSecret(db, "B", "DEPLOY_TOKEN"), false);
  assert.equal(deleteSecret(db, "A", "DEPLOY_TOKEN"), true);
  assert.deepEqual(listSecrets(db, "A"), []);
});

test("secrets: reserved and malformed names are refused at save and skipped at resolve", () => {
  const db = openMemoryDb();
  assert.throws(() => saveSecret(db, box, "A", "ANTHROPIC_BASE_URL", "x"), /set by the sandbox/);
  assert.throws(() => saveSecret(db, box, "A", "lower", "x"), /environment variable name/);
  assert.throws(() => saveSecret(db, box, "A", "1BAD", "x"), /environment variable name/);
  assert.throws(() => saveSecret(db, box, "A", "EMPTY", ""), /needs a value/);
  assert.throws(() => saveSecret(db, box, "A", "MULTI", "a\nb"), /single line/);
  // A reserved name smuggled into the table directly (older row, hand edit) never reaches a box.
  db.prepare(`INSERT INTO secrets (owner, name, value_enc, created_at, updated_at) VALUES ('A', 'AGENT_TASK', ?, 1, 1)`).run(box.seal("evil"));
  assert.deepEqual(resolveSecrets(db, box, "A", ["AGENT_TASK"]), {});
});
