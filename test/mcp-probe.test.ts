/**
 * The MCP health probe: how the operator learns WHY a configured server never shows up in the
 * agent's tool list (the in-box claude silently drops servers that fail to connect). The live case
 * that motivated this: hana-qa's static bearer JWT had expired — config present in the box, 401 on
 * initialize, no tools, no error anywhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeProbe, isProbeableUrl, jwtExpiry, type McpServer } from "../src/mcp-store.ts";

const jwt = (exp: number) =>
  `x.${Buffer.from(JSON.stringify({ sub: "s", exp })).toString("base64url")}.y`;

const srv = (headers?: Record<string, string>): McpServer => ({
  name: "hana-qa",
  type: "http",
  url: "https://mcp.example.com/mcp",
  headers,
  enabled: true,
  addedAt: 1,
});

test("jwtExpiry decodes a Bearer JWT and flags a past exp", () => {
  const past = Math.floor(Date.now() / 1000) - 3600;
  const r = jwtExpiry(`Bearer ${jwt(past)}`);
  assert.ok(r);
  assert.equal(r!.expired, true);
  const future = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(jwtExpiry(`Bearer ${jwt(future)}`)!.expired, false);
  assert.equal(jwtExpiry("Bearer not-a-jwt"), null);
  assert.equal(jwtExpiry("Basic dXNlcjpwYXNz"), null);
});

test("a 401 with an expired stored JWT names the expiry explicitly", () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  const r = describeProbe(srv({ Authorization: `Bearer ${jwt(past)}` }), { status: 401, body: '{"error":"exp check failed"}' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /EXPIRED/);
  assert.match(r.detail, /paste a fresh one/);
});

test("a 401 with a non-JWT token points at the Authorization header", () => {
  const r = describeProbe(srv({ Authorization: "Bearer opaque" }), { status: 401 });
  assert.equal(r.ok, false);
  assert.match(r.detail, /Authorization header/);
});

test("2xx is connected; other 4xx/5xx report the status and body", () => {
  assert.equal(describeProbe(srv(), { status: 200, body: "{}" }).ok, true);
  const r = describeProbe(srv(), { status: 502, body: "bad gateway" });
  assert.equal(r.ok, false);
  assert.match(r.detail, /HTTP 502/);
});

test("a network error is reported as unreachable", () => {
  const r = describeProbe(srv(), { error: "getaddrinfo ENOTFOUND" });
  assert.equal(r.ok, false);
  assert.match(r.detail, /Could not reach/);
});

test("SSRF guard: only public https urls are probeable from the controller", () => {
  assert.equal(isProbeableUrl("https://mcp.example.com/mcp"), true);
  assert.equal(isProbeableUrl("http://mcp.example.com/mcp"), false);
  assert.equal(isProbeableUrl("https://localhost/x"), false);
  assert.equal(isProbeableUrl("https://127.0.0.1:8787/mcp"), false);
  assert.equal(isProbeableUrl("https://10.0.0.5/x"), false);
  assert.equal(isProbeableUrl("https://172.17.0.1/x"), false);
  assert.equal(isProbeableUrl("https://192.168.1.1/x"), false);
  assert.equal(isProbeableUrl("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(isProbeableUrl("https://host.docker.internal:8787/mcp"), false);
  assert.equal(isProbeableUrl("https://foo.internal/mcp"), false);
  assert.equal(isProbeableUrl("https://agent-sandbox/x"), false); // bare compose service name
  assert.equal(isProbeableUrl("not a url"), false);
});
