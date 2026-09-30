/**
 * Alert-source presets for webhook automations (docs/plan-demo-parity.md, bet 3): Sentry, Datadog
 * and PagerDuty. PURE — no I/O — so every rule is unit-tested (test/alert-presets.test.ts).
 *
 *   - authenticity, per vendor:
 *       Sentry     `Sentry-Hook-Signature`: hex HMAC-SHA256 of the raw body with the integration's
 *                  client secret (docs.sentry.io → integration platform → webhooks).
 *       PagerDuty  `X-PagerDuty-Signature`: `v1=<hex HMAC-SHA256 of the raw body>`, comma-separated
 *                  when a secret is being rotated; any match passes (Webhooks v3 signature docs).
 *       Datadog    webhooks are not signed. The Webhooks integration lets you add custom headers, so
 *                  the owner sets `X-ASB-Token: <signing secret>` and we compare it in constant time
 *                  (on top of the secret already in the URL).
 *   - normalisation: payload → `alert` template fields (title, severity, service, url, status, …)
 *   - fingerprint: the vendor's own grouping id, so a storm of the same alert is ONE run (cooldown)
 *   - resolved / non-opening events are skipped, not fired
 *   - synthetic test events, clearly marked
 */
import crypto from "node:crypto";
import { safeEqual } from "./triggers.js";

export type AlertPreset = "sentry" | "datadog" | "pagerduty";
export const ALERT_PRESETS: readonly AlertPreset[] = ["sentry", "datadog", "pagerduty"];
export const PRESET_LABEL: Record<AlertPreset, string> = { sentry: "Sentry", datadog: "Datadog", pagerduty: "PagerDuty" };

/** Built-in harness every alert preset defaults to (src/harness.ts BUILTIN_HARNESSES). */
export const INCIDENT_HARNESS_ID = "hrn_builtin-incident-responder";
export const DEFAULT_COOLDOWN_MIN = 30;
export const MAX_COOLDOWN_MIN = 24 * 60;
export const DATADOG_TOKEN_HEADER = "x-asb-token";

export const DEFAULT_ALERT_TEMPLATE = [
  "{{alert.source}} alert: {{alert.title}}",
  "",
  "Severity: {{alert.severity}}",
  "Service: {{alert.service}}",
  "Link: {{alert.url}}",
  "",
  "{{alert.message}}",
].join("\n");

type H = Record<string, string | string[] | undefined>;
const hdr = (h: H, k: string): string | undefined => {
  const v = h[k.toLowerCase()];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
};
const hmac = (secret: string, raw: Buffer) => crypto.createHmac("sha256", secret).update(raw).digest("hex");

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Check the vendor's signature. `signingSecret` is the one the vendor gave the owner (or, for
 *  Datadog, the one the owner put in the custom header). */
export function verifyPreset(preset: AlertPreset, signingSecret: string | undefined, raw: Buffer, headers: H): Verdict {
  if (!signingSecret) return { ok: false, reason: "no signing secret set on this automation" };
  switch (preset) {
    case "sentry": {
      const got = (hdr(headers, "sentry-hook-signature") ?? "").trim().toLowerCase();
      if (!got) return { ok: false, reason: "missing Sentry-Hook-Signature" };
      return safeEqual(hmac(signingSecret, raw), got) ? { ok: true } : { ok: false, reason: "bad signature" };
    }
    case "pagerduty": {
      const got = hdr(headers, "x-pagerduty-signature") ?? "";
      if (!got) return { ok: false, reason: "missing X-PagerDuty-Signature" };
      const want = "v1=" + hmac(signingSecret, raw);
      // Evaluate every candidate (no early exit) so timing doesn't reveal which one matched.
      let ok = false;
      for (const s of got.split(",")) ok = safeEqual(want, s.trim().toLowerCase()) || ok;
      return ok ? { ok: true } : { ok: false, reason: "bad signature" };
    }
    case "datadog": {
      const got = (hdr(headers, DATADOG_TOKEN_HEADER) ?? "").trim();
      if (!got) return { ok: false, reason: "missing X-ASB-Token header" };
      return safeEqual(signingSecret, got) ? { ok: true } : { ok: false, reason: "bad token" };
    }
  }
}

export interface AlertFields {
  source: string;
  title: string;
  severity: string;
  service: string;
  url: string;
  status: string;
  message: string;
  /** Vendor grouping id: the cooldown key. */
  fingerprint: string;
  test?: boolean;
}

export type Normalized = { ok: true; alert: AlertFields; fire: true } | { ok: true; alert: AlertFields; fire: false; reason: string } | { ok: false; reason: string };

const str = (...vs: unknown[]): string => {
  for (const v of vs) if (v !== undefined && v !== null && v !== "" && typeof v !== "object") return String(v);
  return "";
};

/** Payload → alert fields. `fire: false` for resolved / informational events. */
export function normalizeAlert(preset: AlertPreset, payload: unknown, headers: H = {}): Normalized {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "payload is not a JSON object" };
  const p = payload as Record<string, any>;
  const test = p.asb_test === true;
  let a: AlertFields;
  if (preset === "sentry") {
    const d = (p.data ?? {}) as Record<string, any>;
    const issue = d.issue ?? {};
    const ev = d.event ?? {};
    const metric = d.metric_alert ?? {};
    const resource = hdr(headers, "sentry-hook-resource") ?? "";
    a = {
      source: "Sentry",
      title: str(issue.title, ev.title, d.description_title, metric.title, p.message, p.culprit),
      severity: str(issue.level, ev.level, p.level, p.action === "critical" || p.action === "warning" ? p.action : undefined),
      service: str(issue.project?.slug, ev.project, p.project_slug, p.project, metric.projects?.[0]),
      url: str(issue.web_url, issue.permalink, ev.web_url, d.web_url, p.url),
      status: str(p.action, issue.status),
      message: str(ev.culprit, issue.culprit, d.description_text, p.culprit, d.triggered_rule),
      fingerprint: str(issue.id, ev.issue_id, metric.id, p.id, p.group_id),
    };
    if (!a.title && !a.fingerprint) return { ok: false, reason: "not a Sentry alert payload (no issue, event or metric alert)" };
    if (resource === "installation") return { ok: true, alert: a, fire: false, reason: "Sentry installation event" };
    if (p.action === "resolved" || p.action === "ignored" || p.action === "assigned" || p.action === "archived") return { ok: true, alert: a, fire: false, reason: `Sentry issue ${p.action}` };
  } else if (preset === "pagerduty") {
    const e = (p.event ?? {}) as Record<string, any>;
    const d = (e.data ?? {}) as Record<string, any>;
    if (!e.event_type) return { ok: false, reason: "not a PagerDuty v3 payload (no event.event_type)" };
    a = {
      source: "PagerDuty",
      title: str(d.title, d.summary),
      severity: str(d.urgency, d.priority?.summary),
      service: str(d.service?.summary),
      url: str(d.html_url),
      status: str(e.event_type),
      message: str(d.body?.details, d.description),
      fingerprint: str(d.id, d.incident_key, e.id),
    };
    const opens = ["incident.triggered", "incident.reopened", "pagey.ping"];
    if (!opens.includes(String(e.event_type))) return { ok: true, alert: a, fire: false, reason: `${e.event_type} does not open an incident` };
    if (e.event_type === "pagey.ping") return { ok: true, alert: a, fire: false, reason: "PagerDuty ping" };
  } else {
    // Datadog: the fields come from the webhook's payload template (see DATADOG_PAYLOAD).
    a = {
      source: "Datadog",
      title: str(p.title, p.event_title),
      severity: str(p.priority, p.alert_type),
      service: str(p.hostname, p.scope, p.tags),
      url: str(p.link),
      status: str(p.transition, p.alert_transition),
      message: str(p.body, p.event_msg),
      fingerprint: str(p.aggreg_key, p.alert_id, p.title),
    };
    if (!a.title && !a.fingerprint) return { ok: false, reason: "not a Datadog alert payload (no title or alert id)" };
    if (/^recovered$|^ok$/i.test(a.status)) return { ok: true, alert: a, fire: false, reason: `Datadog monitor ${a.status}` };
  }
  if (!a.fingerprint) a.fingerprint = crypto.createHash("sha256").update(a.title).digest("hex").slice(0, 16);
  if (test) {
    a.test = true;
    a.title = `[TEST] ${a.title}`;
  }
  return { ok: true, alert: a, fire: true };
}

/** The Datadog webhook payload the owner pastes (Datadog → Integrations → Webhooks → Payload). */
export const DATADOG_PAYLOAD = JSON.stringify(
  { id: "$ID", alert_id: "$ALERT_ID", aggreg_key: "$AGGREG_KEY", title: "$EVENT_TITLE", body: "$EVENT_MSG", transition: "$ALERT_TRANSITION", priority: "$PRIORITY", link: "$LINK", hostname: "$HOSTNAME", tags: "$TAGS" },
  null,
  2
);

/** A synthetic delivery, shaped like the vendor's own, marked `asb_test` so it can never pass for a
 *  real alert. `nonce` makes the fingerprint unique so repeated tests don't hit the cooldown. */
export function testPayload(preset: AlertPreset, nonce: string): { payload: Record<string, unknown>; headers: Record<string, string> } {
  if (preset === "sentry") {
    return {
      headers: { "sentry-hook-resource": "issue" },
      payload: {
        asb_test: true,
        action: "created",
        data: { issue: { id: `test-${nonce}`, title: "TypeError: Cannot read properties of undefined (reading 'id')", level: "error", culprit: "src/checkout.ts in handleSubmit", web_url: "https://sentry.io/issues/test", project: { slug: "web" } } },
      },
    };
  }
  if (preset === "pagerduty") {
    return {
      headers: {},
      payload: {
        asb_test: true,
        event: {
          id: `test-${nonce}`,
          event_type: "incident.triggered",
          resource_type: "incident",
          occurred_at: new Date(0).toISOString(),
          data: { id: `test-${nonce}`, title: "High error rate on checkout-api", urgency: "high", html_url: "https://example.pagerduty.com/incidents/test", service: { summary: "checkout-api" }, status: "triggered" },
        },
      },
    };
  }
  return {
    headers: {},
    payload: { asb_test: true, id: nonce, alert_id: `test-${nonce}`, aggreg_key: `test-${nonce}`, title: "[Triggered] p99 latency above 2s on checkout-api", body: "p99 latency is 2.4s over the last 5 minutes.", transition: "Triggered", priority: "P2", link: "https://app.datadoghq.com/monitors/test", hostname: "checkout-api-1", tags: "service:checkout-api,env:prod" },
  };
}

/** Clamp a cooldown in minutes (0 = no cooldown). */
export function normalizeCooldown(v: unknown): number {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n) || n < 0) return DEFAULT_COOLDOWN_MIN;
  return Math.min(Math.round(n), MAX_COOLDOWN_MIN);
}
