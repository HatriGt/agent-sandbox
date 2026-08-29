/**
 * Response security headers (defence-in-depth around the localStorage bearer token).
 *
 * The console keeps a root-equivalent token in `localStorage` (interim, until real accounts), so an
 * injected script is the highest-value attack on this app. These assertions pin the properties that
 * make that hard: no way to execute injected script, and nowhere off-origin to send a stolen token.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { securityHeaders, cspKindForPath, cspFor } from "../src/security-headers.ts";

test("the SPA shell gets the app CSP; assets under /dashboard count as the shell", () => {
  assert.equal(cspKindForPath("/"), "app");
  assert.equal(cspKindForPath("/dashboard"), "app");
  assert.equal(cspKindForPath("/dashboard/assets/index-abc.js"), "app");
});

test("data routes and artifact bytes are not the app shell", () => {
  assert.equal(cspKindForPath("/fleet.json"), "data");
  assert.equal(cspKindForPath("/watch.sse"), "data");
  assert.equal(cspKindForPath("/mcp"), "data");
  assert.equal(cspKindForPath("/artifact"), "artifact");
  // A path that merely starts with the same letters is NOT the dashboard.
  assert.equal(cspKindForPath("/dashboardx"), "data");
});

test("app CSP cannot execute injected script (the token-theft path)", () => {
  const csp = cspFor("app");
  assert.match(csp, /script-src 'self'/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "inline script must never be allowed");
  assert.ok(!csp.includes("unsafe-eval"), "eval must never be allowed");
});

test("app CSP gives a stolen token nowhere to go, and no frame to be clickjacked in", () => {
  const csp = cspFor("app");
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
});

test("app CSP still permits inline STYLE (shiki bakes colours into style= attributes)", () => {
  assert.match(cspFor("app"), /style-src 'self' 'unsafe-inline'/);
});

test("artifact bytes are sandboxed and have no origin", () => {
  const csp = cspFor("artifact");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /sandbox/);
});

test("data responses are inert", () => {
  assert.match(cspFor("data"), /default-src 'none'/);
  assert.ok(!cspFor("data").includes("sandbox"));
});

test("every response carries the transport + sniffing + referrer set", () => {
  const h = securityHeaders("/fleet.json");
  assert.match(h["Strict-Transport-Security"], /max-age=31536000/);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.equal(h["Referrer-Policy"], "no-referrer");
  assert.equal(h["Cross-Origin-Opener-Policy"], "same-origin");
  assert.ok(h["Permissions-Policy"].includes("camera=()"));
});

test("HSTS is not sent with preload (that would be a hard-to-reverse commitment)", () => {
  assert.ok(!securityHeaders("/")["Strict-Transport-Security"].includes("preload"));
});

test("csp: the public auth pages are app shell, not data", async () => {
  const { cspKindForPath } = await import("../src/security-headers.js");
  assert.equal(cspKindForPath("/signin"), "app");
  assert.equal(cspKindForPath("/signup/"), "app");
  assert.equal(cspKindForPath("/auth/config.json"), "data");
});
