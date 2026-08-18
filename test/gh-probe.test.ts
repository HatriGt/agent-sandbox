/**
 * Tests for the PURE parsing bits of the GitHub token probe. The live HTTP calls (curl over SSH)
 * are IO and not tested here; we test how we interpret their outputs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenType, parseLogin, parseOrgs } from "../src/gh-probe.ts";

test("tokenType: classic vs fine-grained vs unknown from the token prefix", () => {
  assert.equal(tokenType("ghp_abc123"), "classic");
  assert.equal(tokenType("gho_abc123"), "classic"); // oauth, classic-style scopes
  assert.equal(tokenType("github_pat_abc123"), "fine-grained");
  assert.equal(tokenType("weird"), "unknown");
});

test("parseLogin: pulls login from a /user JSON body; undefined if absent", () => {
  assert.equal(parseLogin('{"login":"alice","id":1}'), "alice");
  assert.equal(parseLogin('{ "login" : "bob-2" }'), "bob-2");
  assert.equal(parseLogin("{}"), undefined);
  assert.equal(parseLogin("not json"), undefined);
});

test("parseOrgs: pulls all org logins from a /user/orgs JSON array", () => {
  const body = '[{"login":"acme","id":1},{"login":"other-org","id":2}]';
  assert.deepEqual(parseOrgs(body), ["acme", "other-org"]);
  assert.deepEqual(parseOrgs("[]"), []);
  assert.deepEqual(parseOrgs("nope"), []);
});
