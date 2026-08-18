/**
 * The dashboard page is a pure string; assert it wires the poll interval + the token-aware endpoints
 * it depends on. (Behavior of the embedded browser JS isn't unit-tested here — only its contract.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml, DASHBOARD_POLL_MS } from "../src/dashboard-html.ts";

test("embeds the configured poll interval", () => {
  assert.match(dashboardHtml(1234), /var POLL = 1234/);
  assert.match(dashboardHtml(), new RegExp("var POLL = " + DASHBOARD_POLL_MS));
});

test("polls the token-protected JSON endpoints", () => {
  const html = dashboardHtml();
  assert.match(html, /\/monitor\.json/);
  assert.match(html, /\/watch\.json/);
  // reads the token from its own URL (query param) so a browser navigation works
  assert.match(html, /params\.get\("token"\)/);
});

test("is a self-contained HTML document (no external deps)", () => {
  const html = dashboardHtml();
  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /<script[^>]+src=/i); // no external scripts
});
