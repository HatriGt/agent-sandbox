/**
 * Per-user notification settings (webhook + event toggles), stored like skills/mcp servers:
 * one encrypted user_blobs row per owner. Pure parse/normalize here; blob IO is the same
 * loadBlob/saveBlob everything else uses.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseNotifySettings, normalizeNotifySettings, eventEnabled, DEFAULT_NOTIFY } from "../src/notify-store.ts";

test("defaults: no webhook, all three events on", () => {
  assert.equal(DEFAULT_NOTIFY.url, "");
  assert.deepEqual(DEFAULT_NOTIFY.events, { waiting: true, done: true, failed: true });
});

test("parse tolerates garbage and missing fields", () => {
  assert.deepEqual(parseNotifySettings(""), DEFAULT_NOTIFY);
  assert.deepEqual(parseNotifySettings("not json"), DEFAULT_NOTIFY);
  assert.deepEqual(parseNotifySettings("{}"), DEFAULT_NOTIFY);
  const s = parseNotifySettings(JSON.stringify({ url: "https://h/x", events: { done: false } }));
  assert.equal(s.url, "https://h/x");
  assert.deepEqual(s.events, { waiting: true, done: false, failed: true });
});

test("normalize rejects an invalid webhook URL with a human message", () => {
  assert.throws(() => normalizeNotifySettings({ url: "javascript:x", events: {} }), /http/i);
  assert.throws(() => normalizeNotifySettings({ url: "https://u:p@h/x", events: {} }), /credential/i);
  // Empty url = notifications off; always fine.
  assert.equal(normalizeNotifySettings({ url: "", events: {} }).url, "");
  const ok = normalizeNotifySettings({ url: " https://h/x ", events: { waiting: false } });
  assert.equal(ok.url, "https://h/x");
  assert.equal(ok.events.waiting, false);
});

test("eventEnabled: no url means nothing fires; toggles respected", () => {
  assert.equal(eventEnabled({ url: "", events: { waiting: true, done: true, failed: true } }, "waiting"), false);
  const s = { url: "https://h/x", events: { waiting: true, done: false, failed: true } };
  assert.equal(eventEnabled(s, "waiting"), true);
  assert.equal(eventEnabled(s, "done"), false);
  assert.equal(eventEnabled(s, "failed"), true);
});
