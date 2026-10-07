import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import { INCIDENT_HARNESS_ID, normalizeAlert, testPayload, verifyPreset } from "../src/alert-presets.ts";
import { normalizeTrigger, renderTemplate, templateContext } from "../src/triggers.ts";
import { DELIVERY_LOG_MAX, listDeliveries, logDelivery, createTrigger } from "../src/trigger-store.ts";
import { makeDispatcher } from "../src/trigger-dispatch.ts";
import { hookBodyParser, registerTriggerRoutes } from "../src/trigger-routes.ts";
import { BUILTIN_HARNESSES, BUILTIN_ID_PREFIX } from "../src/harness.ts";

const box = makeSecretBox(crypto.randomBytes(32));
const hmac = (s: string, b: Buffer) => crypto.createHmac("sha256", s).update(b).digest("hex");

test("signatures: Sentry HMAC, PagerDuty v1= (rotation list), Datadog custom header", () => {
  const raw = Buffer.from('{"a":1}');
  assert.ok(verifyPreset("sentry", "s3", raw, { "sentry-hook-signature": hmac("s3", raw) }).ok);
  assert.ok(!verifyPreset("sentry", "s3", raw, { "sentry-hook-signature": hmac("nope", raw) }).ok);
  assert.ok(!verifyPreset("sentry", "s3", raw, {}).ok);
  assert.ok(!verifyPreset("sentry", undefined, raw, { "sentry-hook-signature": hmac("s3", raw) }).ok, "no secret set = reject");
  assert.ok(verifyPreset("pagerduty", "pd", raw, { "x-pagerduty-signature": `v1=${hmac("old", raw)},v1=${hmac("pd", raw)}` }).ok);
  assert.ok(!verifyPreset("pagerduty", "pd", raw, { "x-pagerduty-signature": hmac("pd", raw) }).ok, "needs the v1= scheme");
  assert.ok(verifyPreset("datadog", "tok", raw, { "x-asb-token": "tok" }).ok);
  assert.ok(!verifyPreset("datadog", "tok", raw, { "x-asb-token": "tok2" }).ok);
});

test("normalize: vendor payloads → alert fields; resolved events don't fire", () => {
  const s = normalizeAlert("sentry", { action: "created", data: { issue: { id: "42", title: "TypeError", level: "error", web_url: "u", project: { slug: "web" } } } });
  assert.ok(s.ok && s.fire);
  if (s.ok) assert.deepEqual([s.alert.title, s.alert.fingerprint, s.alert.service], ["TypeError", "42", "web"]);
  const sr = normalizeAlert("sentry", { action: "resolved", data: { issue: { id: "42", title: "TypeError" } } });
  assert.ok(sr.ok && !sr.fire);
  const pd = normalizeAlert("pagerduty", { event: { event_type: "incident.triggered", data: { id: "P1", title: "Down", urgency: "high", service: { summary: "api" } } } });
  assert.ok(pd.ok && pd.fire);
  const pdr = normalizeAlert("pagerduty", { event: { event_type: "incident.resolved", data: { id: "P1" } } });
  assert.ok(pdr.ok && !pdr.fire);
  const dd = normalizeAlert("datadog", { title: "[Triggered] cpu", aggreg_key: "k1", transition: "Triggered" });
  assert.ok(dd.ok && dd.fire);
  if (dd.ok) assert.equal(dd.alert.fingerprint, "k1");
  assert.ok(!normalizeAlert("pagerduty", { hello: 1 }).ok);
  assert.ok(!normalizeAlert("datadog", [1]).ok);
  const t = testPayload("sentry", "n1");
  const tn = normalizeAlert("sentry", t.payload, t.headers);
  assert.ok(tn.ok && tn.fire && tn.alert.test && tn.alert.title.startsWith("[TEST]"));
  const r = renderTemplate("{{alert.title}} on {{alert.service}}", templateContext({ asb_alert: { title: "X", service: "api" } }));
  assert.equal(r.text, "X on api");
});

test("normalize trigger: preset defaults to the Incident responder harness and a cooldown", () => {
  const n = normalizeTrigger({ name: "S", kind: "webhook", taskTemplate: "t", spec: { preset: "sentry" }, signingSecret: "abc" });
  assert.ok(n.ok);
  if (!n.ok) return;
  assert.equal(n.trigger.harnessId, INCIDENT_HARNESS_ID);
  assert.ok(BUILTIN_HARNESSES.some((b) => `${BUILTIN_ID_PREFIX}${b.key}` === INCIDENT_HARNESS_ID), "the built-in exists");
  assert.equal(n.trigger.spec.cooldownMin, 30);
  assert.equal(n.signingSecret, "abc");
  assert.ok(!normalizeTrigger({ name: "S", kind: "webhook", taskTemplate: "t", spec: { preset: "nagios" } }).ok);
  assert.ok(!normalizeTrigger({ name: "S", kind: "webhook", taskTemplate: "t", signingSecret: "x" }).ok, "signing secret needs a preset");
});

test("delivery log is bounded", () => {
  const db = openMemoryDb();
  const n = normalizeTrigger({ name: "W", kind: "webhook", taskTemplate: "t" });
  if (!n.ok) throw new Error();
  const { row } = createTrigger(db, box, "u1", n.trigger);
  for (let i = 0; i < DELIVERY_LOG_MAX + 10; i++) logDelivery(db, row.id, { at: i, outcome: "skipped", reason: "dedupe" });
  const l = listDeliveries(db, "u1", row.id);
  assert.equal(l.length, DELIVERY_LOG_MAX);
  assert.equal(l[0].at, DELIVERY_LOG_MAX + 9, "newest first");
  assert.equal(listDeliveries(db, "u2", row.id).length, 0, "owner-scoped");
});

async function harness() {
  const db = openMemoryDb();
  const starts: any[] = [];
  let i = 0;
  const dispatcher = makeDispatcher({ db, log: () => {}, startRun: async (input) => (starts.push(input), { ok: true, box: `box-${++i}` }) });
  const app = express();
  app.use("/hooks", hookBodyParser);
  app.use(express.json());
  registerTriggerRoutes(app, {
    db,
    box,
    dispatcher,
    dashAuthed: () => true,
    principalOf: () => ({ kind: "user", userId: "u1" }) as any,
    failWith: (res, e) => void res.status(500).json({ error: String(e) }),
    redact: (s) => s,
    audit: () => {},
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { db, starts, base, close: () => server.close() };
}

test("receiver: Sentry preset — bad signature rejected, storm = one run (cooldown), all logged; test event marked", async () => {
  const h = await harness();
  try {
    const created = await fetch(`${h.base}/triggers.json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sentry", kind: "webhook", taskTemplate: "Fix {{alert.title}}", spec: { preset: "sentry", cooldownMin: 30 }, signingSecret: "cs" }),
    }).then((r) => r.json() as Promise<any>);
    const id = created.trigger.id;
    assert.equal(created.trigger.hasSigningSecret, true);
    assert.equal(created.trigger.harnessId, INCIDENT_HARNESS_ID);
    const url = created.hookUrl.replace(/^[^/]*\/\/[^/]*|^/, h.base);
    const send = (body: object, sig?: string) => {
      const raw = Buffer.from(JSON.stringify(body));
      return fetch(url, { method: "POST", headers: { "content-type": "application/json", "sentry-hook-resource": "issue", "sentry-hook-signature": sig ?? hmac("cs", raw) }, body: raw });
    };
    const issue = (n: number) => ({ action: "created", n, data: { issue: { id: "777", title: "Boom" } } });
    assert.equal((await send(issue(1), "00")).status, 401);
    assert.equal((await send(issue(2))).status, 202);
    assert.equal((await send(issue(3))).status, 202);
    assert.equal((await send(issue(4))).status, 202);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(h.starts.length, 1, "a storm of the same alert is one run");
    assert.ok(h.starts[0].task.startsWith("Fix Boom"));
    const test1 = await fetch(`${h.base}/triggers/${id}/test.json`, { method: "POST" }).then((r) => r.json() as Promise<any>);
    assert.equal(test1.result.outcome, "started");
    assert.match(h.starts[1].task, /\[TEST\]/);
    assert.equal(h.starts[1].startedBy.event, "test:sentry");
    const log = (await fetch(`${h.base}/triggers/${id}/deliveries.json`).then((r) => r.json())) as any;
    const summary = log.deliveries.map((d: any) => `${d.outcome}:${d.reason ?? ""}${d.test ? ":test" : ""}`);
    assert.deepEqual(summary, ["fired::test", "skipped:cooldown", "skipped:cooldown", "fired:", "rejected:signature"]);
    const list = (await fetch(`${h.base}/triggers.json`).then((r) => r.json())) as any;
    assert.equal(list.triggers[0].lastDelivery.outcome, "fired");
    assert.ok(log.deliveries[3].box, "fired rows carry the run");
  } finally {
    h.close();
  }
});
