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

test("ask panel: posts to /ask.json and keeps its state out of the DOM", () => {
  const html = dashboardHtml();
  assert.match(html, /\/ask\.json/);
  assert.match(html, /method: "POST"/);
  // The fleet table is rebuilt on every poll, so the transcript, the in-flight flag, and the draft
  // must live in JS state — otherwise a 3s tick wipes a conversation or eats what you're typing.
  for (const state of ["askLog", "askBusy", "askDraft", "askFocus"]) {
    assert.match(html, new RegExp("var " + state + " ="), `missing ask state: ${state}`);
  }
  assert.match(html, /newThread/);
});

test("ask panel: labelled as read-only and non-interrupting", () => {
  // The panel sits directly under the agent's own terminal output. If it isn't obvious that this is
  // an observer rather than the agent, someone will type a steering instruction into it and be
  // silently ignored.
  assert.match(dashboardHtml(), /read-only, does not interrupt the agent/);
});
