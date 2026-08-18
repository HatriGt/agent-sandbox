/**
 * Phase 1 / Step 4 — HTTP bearer auth (TDD).
 * Pure guard used by the /mcp middleware. Kept separate so we can test it without a live server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBearer, checkToken, checkDashboardAuth } from "../src/http-auth.ts";

test("accepts the exact bearer token", () => {
  assert.equal(checkBearer("Bearer secret123", "secret123"), true);
});

test("rejects a wrong token", () => {
  assert.equal(checkBearer("Bearer nope", "secret123"), false);
});

test("rejects missing header", () => {
  assert.equal(checkBearer(undefined, "secret123"), false);
  assert.equal(checkBearer("", "secret123"), false);
});

test("rejects malformed header (no Bearer prefix)", () => {
  assert.equal(checkBearer("secret123", "secret123"), false);
  assert.equal(checkBearer("Basic secret123", "secret123"), false);
});

test("fails CLOSED when no token is configured (never allow all)", () => {
  assert.equal(checkBearer("Bearer anything", ""), false);
  assert.equal(checkBearer("Bearer anything", undefined), false);
});

test("is constant-length safe: different-length tokens rejected", () => {
  assert.equal(checkBearer("Bearer short", "a-much-longer-secret-value"), false);
});

test("checkToken: raw secret compare, fails closed", () => {
  assert.equal(checkToken("secret123", "secret123"), true);
  assert.equal(checkToken("nope", "secret123"), false);
  assert.equal(checkToken(undefined, "secret123"), false);
  assert.equal(checkToken("anything", ""), false);
  assert.equal(checkToken("anything", undefined), false);
});

test("checkDashboardAuth: accepts bearer header OR ?token= query", () => {
  // via header
  assert.equal(checkDashboardAuth("Bearer secret123", undefined, "secret123"), true);
  // via query
  assert.equal(checkDashboardAuth(undefined, "secret123", "secret123"), true);
  // wrong query
  assert.equal(checkDashboardAuth(undefined, "nope", "secret123"), false);
  // non-string query (e.g. ?token=a&token=b -> array) rejected
  assert.equal(checkDashboardAuth(undefined, ["secret123"], "secret123"), false);
  // fails closed with no configured token
  assert.equal(checkDashboardAuth("Bearer x", "x", ""), false);
});
