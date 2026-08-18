/**
 * Tests for the persistent, multi-account GitHub token store (owner -> token).
 * Pure logic is tested against an in-memory backend (injected read/write), so no VPS is touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ownerOf,
  parseStore,
  serializeStore,
  resolveToken,
  rememberOwnerToken,
  type TokenStore,
} from "../src/gh-token-store.ts";

test("ownerOf: extracts owner from owner/name, URLs, and .git", () => {
  assert.equal(ownerOf("atom-insurance/elseco-deal-service"), "atom-insurance");
  assert.equal(ownerOf("https://github.com/acme/widgets.git"), "acme");
  assert.equal(ownerOf("acme/widgets/"), "acme");
});

test("ownerOf: a local path has no GitHub owner", () => {
  assert.equal(ownerOf("/Users/me/code/project"), undefined);
});

test("parseStore: empty/invalid input yields an empty store", () => {
  assert.deepEqual(parseStore(""), { owners: {} });
  assert.deepEqual(parseStore("not json"), { owners: {} });
  assert.deepEqual(parseStore("null"), { owners: {} });
});

test("parse/serialize round-trips", () => {
  const store: TokenStore = { owners: { acme: { token: "t1", login: "alice" } } };
  assert.deepEqual(parseStore(serializeStore(store)), store);
});

test("resolveToken: returns the owner's token, else the default", () => {
  const store: TokenStore = { owners: { acme: { token: "acme-tok", login: "bob" } } };
  assert.equal(resolveToken(store, "acme/widgets", "DEFAULT"), "acme-tok");
  assert.equal(resolveToken(store, "other/thing", "DEFAULT"), "DEFAULT");
  // no default, unknown owner -> undefined
  assert.equal(resolveToken(store, "other/thing", undefined), undefined);
});

test("resolveToken: a local path (no owner) falls back to default", () => {
  const store: TokenStore = { owners: {} };
  assert.equal(resolveToken(store, "/abs/path", "DEFAULT"), "DEFAULT");
});

test("rememberOwnerToken: adds/overwrites the owner entry immutably", () => {
  const store: TokenStore = { owners: { acme: { token: "old", login: "a" } } };
  const next = rememberOwnerToken(store, "acme", "new", "a2");
  assert.equal(next.owners.acme.token, "new");
  assert.equal(next.owners.acme.login, "a2");
  // original unchanged
  assert.equal(store.owners.acme.token, "old");
});

test("rememberOwnerToken: ignores a blank owner or token", () => {
  const store: TokenStore = { owners: {} };
  assert.deepEqual(rememberOwnerToken(store, "", "t", "l"), store);
  assert.deepEqual(rememberOwnerToken(store, "acme", "", "l"), store);
});
