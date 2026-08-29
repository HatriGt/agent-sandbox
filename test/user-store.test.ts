import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.js";
import { makeSecretBox } from "../src/secretbox.js";
import { registerUserStoreBackend, loadBlob, saveBlob, allBlobs, ownerKey, withOwner, OPERATOR_OWNER } from "../src/user-store.js";
import { withPrincipal } from "../src/tenancy.js";
import { loadStore, saveStore, upsertAccount, parseStore } from "../src/gh-token-store.js";
import type { Config } from "../src/config.js";

test("secretbox: round-trips and rejects tampering", () => {
  const box = makeSecretBox(crypto.randomBytes(32));
  const sealed = box.seal('{"accounts":{}}');
  assert.equal(box.open(sealed), '{"accounts":{}}');
  assert.notEqual(sealed, box.seal('{"accounts":{}}'), "fresh IV every time");
  const parts = sealed.split(".");
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
  assert.throws(() => box.open(parts.join(".")));
  assert.throws(() => makeSecretBox(crypto.randomBytes(16)));
});

test("user store: blobs are per owner and encrypted at rest", () => {
  const db = openMemoryDb();
  registerUserStoreBackend({ db, box: makeSecretBox(crypto.randomBytes(32)) });
  const alice = { kind: "user" as const, userId: "u_a", login: "alice", role: "user" as const, via: "session" as const };
  const bob = { ...alice, userId: "u_b", login: "bob" };
  withPrincipal(alice, () => saveBlob("gh-tokens", "ALICE"));
  withPrincipal(bob, () => saveBlob("gh-tokens", "BOB"));
  assert.equal(withPrincipal(alice, () => loadBlob("gh-tokens")), "ALICE");
  assert.equal(withPrincipal(bob, () => loadBlob("gh-tokens")), "BOB");
  assert.equal(loadBlob("gh-tokens"), null, "the operator has nothing yet");
  assert.equal(ownerKey(), OPERATOR_OWNER);
  assert.equal(withOwner("u_a", () => ownerKey()), "u_a");
  assert.equal(withOwner(null, () => ownerKey()), OPERATOR_OWNER);
  const raw = db.prepare(`SELECT data_enc FROM user_blobs WHERE owner_id = 'u_a'`).get() as { data_enc: string };
  assert.doesNotMatch(raw.data_enc, /ALICE/);
  assert.deepEqual(allBlobs("gh-tokens").sort(), ["ALICE", "BOB"]);
});

test("gh-token store: user A's accounts are invisible to user B and to the operator", async () => {
  const db = openMemoryDb();
  registerUserStoreBackend({ db, box: makeSecretBox(crypto.randomBytes(32)) });
  const cfg = {} as Config;
  const alice = { kind: "user" as const, userId: "u_a1", login: "alice", role: "user" as const, via: "session" as const };
  const bob = { ...alice, userId: "u_b1", login: "bob" };
  await withPrincipal(alice, async () => {
    const st = upsertAccount(await loadStore(cfg), { login: "alice-gh", token: "ghp_ALICE", type: "classic", orgs: [], addedAt: 0 } as never);
    await saveStore(cfg, st);
  });
  const a = await withPrincipal(alice, () => loadStore(cfg));
  const b = await withPrincipal(bob, () => loadStore(cfg));
  assert.deepEqual(Object.keys(a.accounts), ["alice-gh"]);
  assert.deepEqual(Object.keys(b.accounts), []);
  assert.equal(parseStore(allBlobs("gh-tokens")[0]).accounts["alice-gh"].token, "ghp_ALICE", "the redactor still sees every secret");
});
