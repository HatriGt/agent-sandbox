/**
 * Tests for the login-keyed, access-based GitHub token store.
 *
 * The store keeps one entry per ACCOUNT (GitHub login), recording the token plus the access we
 * probed (orgs + verified repos). Matching a repo to a token is by ACCESS, not owner-name guessing.
 * Pure helpers are unit-tested here; the live GitHub probes live in gh-probe.ts (IO, not tested here).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ownerOf,
  parseStore,
  serializeStore,
  upsertAccount,
  candidateAccounts,
  decideAccess,
  pickDefaultAccount,
  type TokenStore,
  type Account,
} from "../src/gh-token-store.ts";

test("ownerOf: extracts owner from owner/name, URLs, and .git; undefined for local path", () => {
  assert.equal(ownerOf("atom-insurance/elseco-deal-service"), "atom-insurance");
  assert.equal(ownerOf("https://github.com/acme/widgets.git"), "acme");
  assert.equal(ownerOf("acme/widgets/"), "acme");
  assert.equal(ownerOf("/Users/me/code/project"), undefined);
});

test("parseStore: empty/invalid input yields an empty store", () => {
  assert.deepEqual(parseStore(""), { accounts: {} });
  assert.deepEqual(parseStore("not json"), { accounts: {} });
  assert.deepEqual(parseStore("null"), { accounts: {} });
});

test("pickDefaultAccount: empty store -> undefined; else widest access (orgs, then repos) wins", () => {
  assert.equal(pickDefaultAccount({ accounts: {} }), undefined);

  const store: TokenStore = {
    accounts: {
      narrow: { login: "narrow", token: "t1", type: "classic", orgs: [], verifiedRepos: ["a/x"] },
      wide: { login: "wide", token: "t2", type: "classic", orgs: ["acme", "globex"], verifiedRepos: [] },
      mid: { login: "mid", token: "t3", type: "classic", orgs: ["acme"], verifiedRepos: ["a/x", "a/y"] },
    },
  };
  assert.equal(pickDefaultAccount(store)?.login, "wide");

  // tie on orgs -> more verifiedRepos wins
  const tie: TokenStore = {
    accounts: {
      few: { login: "few", token: "t1", type: "classic", orgs: ["acme"], verifiedRepos: ["a/x"] },
      many: { login: "many", token: "t2", type: "classic", orgs: ["acme"], verifiedRepos: ["a/x", "a/y"] },
    },
  };
  assert.equal(pickDefaultAccount(tie)?.login, "many");
});

test("parse/serialize round-trips", () => {
  const store: TokenStore = {
    accounts: {
      alice: { login: "alice", token: "t1", type: "classic", orgs: ["acme"], verifiedRepos: ["acme/x"] },
    },
  };
  assert.deepEqual(parseStore(serializeStore(store)), store);
});

test("upsertAccount: adds/overwrites by login immutably, merging verified repos", () => {
  const store: TokenStore = {
    accounts: { alice: { login: "alice", token: "old", type: "classic", orgs: [], verifiedRepos: ["acme/x"] } },
  };
  const acc: Account = {
    login: "alice",
    token: "new",
    type: "fine-grained",
    orgs: ["acme"],
    verifiedRepos: ["acme/y"],
  };
  const next = upsertAccount(store, acc);
  assert.equal(next.accounts.alice.token, "new");
  assert.equal(next.accounts.alice.type, "fine-grained");
  assert.deepEqual(next.accounts.alice.orgs, ["acme"]);
  // verified repos are unioned, not replaced
  assert.deepEqual(next.accounts.alice.verifiedRepos.sort(), ["acme/x", "acme/y"]);
  // original untouched
  assert.equal(store.accounts.alice.token, "old");
});

test("candidateAccounts: returns logins whose CACHED access covers the repo (owner or exact repo)", () => {
  const store: TokenStore = {
    accounts: {
      alice: { login: "alice", token: "ta", type: "classic", orgs: ["acme"], verifiedRepos: [] },
      bob: { login: "bob", token: "tb", type: "classic", orgs: [], verifiedRepos: ["acme/widgets"] },
      carol: { login: "carol", token: "tc", type: "classic", orgs: ["other"], verifiedRepos: [] },
    },
  };
  // alice via org, bob via exact repo; carol unrelated
  const cands = candidateAccounts(store, "acme/widgets").map((a) => a.login).sort();
  assert.deepEqual(cands, ["alice", "bob"]);
});

test("candidateAccounts: personal repo owned by the login itself matches", () => {
  const store: TokenStore = {
    accounts: { alice: { login: "alice", token: "ta", type: "classic", orgs: [], verifiedRepos: [] } },
  };
  assert.deepEqual(candidateAccounts(store, "alice/dotfiles").map((a) => a.login), ["alice"]);
});

test("decideAccess: 0 candidates -> need-token question", () => {
  const d = decideAccess([], "acme/widgets");
  assert.equal(d.kind, "need_token");
  assert.match(d.message!, /acme\/widgets/);
});

test("decideAccess: exactly 1 -> use that token", () => {
  const only: Account = { login: "alice", token: "ta", type: "classic", orgs: ["acme"], verifiedRepos: [] };
  const d = decideAccess([only], "acme/widgets");
  assert.equal(d.kind, "use");
  assert.equal(d.account!.login, "alice");
});

test("decideAccess: many -> ask user to pick by login", () => {
  const a: Account = { login: "alice", token: "ta", type: "classic", orgs: ["acme"], verifiedRepos: [] };
  const b: Account = { login: "bob", token: "tb", type: "classic", orgs: [], verifiedRepos: ["acme/widgets"] };
  const d = decideAccess([a, b], "acme/widgets");
  assert.equal(d.kind, "choose");
  assert.match(d.message!, /alice/);
  assert.match(d.message!, /bob/);
});
