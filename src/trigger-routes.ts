import express, { type Express, type Request, type Response } from "express";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import type { Principal } from "./identity.js";
import type { Dispatcher } from "./trigger-dispatch.js";
import type { FollowupEngine } from "./pr-followup-engine.js";
import { OPERATOR_OWNER } from "./user-store.js";
import { deliveryKeys, matchGithub, normalizeTrigger, renderTemplate, safeEqual, templateContext, verifyGithubSignature, type AutomateReject } from "./triggers.js";
import {
  claimDelivery, createTrigger, promoteTrigger, deleteTrigger, getTrigger, getTriggerById, lastPayload, listDeliveries, listTriggers, logDelivery, markDeliveryTest,
  revealSecret, revealSigningSecret, rotateSecret, savePayload, setEnabled, setSigningSecret, updateTrigger, viewTrigger,
  type DeliveryReason, type TriggerRow,
} from "./trigger-store.js";
import { normalizeAlert, testPayload, verifyPreset } from "./alert-presets.js";
import crypto from "node:crypto";
import { startedByOf } from "./started-by.js";
import { threadSchedule } from "./thread-schedule.js";
import { makeRateLimiter } from "./auth-throttle.js";

/**
 * HTTP surface for triggers: the owner-scoped CRUD the Automations page uses, and the unauthenticated
 * `POST /hooks/:triggerId/:secret` receiver (generic webhooks; GitHub on the same route with
 * X-Hub-Signature-256). Kept out of http.ts so the controller only wires it.
 *
 * Webhook security, in order:
 *   1. raw body parser with a 512 KB cap (registered by http.ts BEFORE the JSON parsers for /hooks/)
 *   2. per-trigger rate limit (so one noisy repo can't eat the controller)
 *   3. secret compared in constant time; unknown id and wrong secret answer the SAME 404
 *   4. GitHub: HMAC over the raw bytes with the same secret â€” a URL that leaked into a log is not
 *      enough to forge a GitHub event
 *   5. dedupe by delivery id and body hash (replays of a captured delivery fire nothing)
 *   6. admission (enabled, concurrency cap, storm cap) inside the dispatcher
 * The secret is in the path, so http.ts's audit line masks /hooks/ paths (hookAuditPath).
 */

export const HOOK_BODY_LIMIT = "512kb";
/** The raw-body parser for /hooks/: HMAC needs the exact bytes, not re-serialised JSON. */
export const hookBodyParser = express.raw({ type: () => true, limit: HOOK_BODY_LIMIT });

/** `/hooks/<id>/<secret>` â†’ `/hooks/<id>/***` for every log and audit row. */
export function hookAuditPath(path: string): string {
  const m = path.match(/^\/hooks\/([^/]+)\/[^/]*/);
  return m ? `/hooks/${m[1]}/***` : path;
}

export interface TriggerRouteCtx {
  db: Db;
  box: SecretBox;
  dispatcher: Dispatcher;
  dashAuthed(req: Request, res: Response): boolean;
  principalOf(res: Response): Principal;
  failWith(res: Response, e: unknown): void;
  /** Redact known secrets out of a string (payloads are stored for the preview). */
  redact(s: string): string;
  publicUrl?: string;
  audit(owner: string, action: string, detail: Record<string, string | undefined>): void;
  /** PR follow-ups: GitHub automations' hooks also carry CI/review events for agent PRs. */
  followups?: Pick<FollowupEngine, "claims" | "handle">;
  /** Thread titles by box, for the chat a scheduled item came from. */
  titles?: () => Promise<Record<string, string>>;
  /** Schedule markers a box wrote that could not be scheduled (bad time), so its chat can say so. */
  rejects?: (box: string) => AutomateReject[];
}

const isAdmin = (p: Principal): p is Extract<Principal, { kind: "user" }> => p.kind === "user" && p.role === "admin";

export function registerTriggerRoutes(app: Express, c: TriggerRouteCtx): void {
  // An admin sees the operator's machines (mayAccess), so they see the operator's schedules too:
  // a run started over MCP with the bearer token has no user owner, and what its agent schedules
  // would otherwise be invisible in the dashboard â€” the pill empty, the Scheduled tab blank.
  const ownerOfP = (p: Principal, id?: string) => {
    if (p.kind !== "user") return OPERATOR_OWNER;
    if (id && isAdmin(p) && getTriggerById(c.db, id)?.owner === OPERATOR_OWNER) return OPERATOR_OWNER;
    return p.userId;
  };
  const triggersOf = (p: Principal) => (isAdmin(p) ? [...listTriggers(c.db, p.userId), ...listTriggers(c.db, OPERATOR_OWNER)] : listTriggers(c.db, ownerOfP(p)));
  const hookUrl = (id: string, secret: string) => `${(c.publicUrl ?? "").replace(/\/$/, "")}/hooks/${id}/${secret}`;
  const names = (owner: string) => Object.fromEntries(listTriggers(c.db, owner).map((t) => [t.id, t.name]));

  app.get("/triggers.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const all = triggersOf(c.principalOf(res));
    const nm = Object.fromEntries(all.map((t) => [t.id, t.name]));
    const titles = all.some((t) => t.sourceBox) && c.titles ? await c.titles() : {};
    res.json({
      triggers: all.map((t) => ({
        ...viewTrigger(t, nm, c.db),
        active: c.dispatcher.activeCount(t.id),
        ...(t.sourceBox && titles[t.sourceBox] ? { sourceTitle: titles[t.sourceBox] } : {}),
      })),
    });
  });

  /** What is scheduled as part of one thread (the thread's schedule pill). Owner-scoped like the list. */
  app.get("/triggers/for-box.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const box = typeof req.query.box === "string" ? req.query.box : "";
    if (!box) return void res.status(400).json({ error: "box is required" });
    const all = triggersOf(c.principalOf(res));
    const nm = Object.fromEntries(all.map((t) => [t.id, t.name]));
    let sb;
    try {
      sb = startedByOf(c.db, box);
    } catch {
      sb = undefined;
    }
    res.json({ items: threadSchedule(box, sb, all.map((t) => viewTrigger(t, nm))), rejected: c.rejects?.(box) ?? [] });
  });

  app.post("/triggers.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    const v = normalizeTrigger(req.body);
    if (!v.ok) return void res.status(400).json({ error: v.error });
    if (v.trigger.kind === "chain" && !getTrigger(c.db, owner, v.trigger.spec.afterTrigger!)) return void res.status(400).json({ error: "the automation this chain follows does not exist" });
    if (listTriggers(c.db, owner).length >= 50) return void res.status(400).json({ error: "50 automations is the limit" });
    try {
      const created = createTrigger(c.db, c.box, owner, v.trigger);
      const secret = created.secret;
      if (v.signingSecret) setSigningSecret(c.db, c.box, owner, created.row.id, v.signingSecret);
      const row = getTrigger(c.db, owner, created.row.id)!;
      c.audit(owner, "trigger.create", { trigger: row.id, kind: row.kind });
      // The secret is shown ONCE, here. Lists never carry it.
      const needsUrl = row.kind === "webhook" || row.kind === "github";
      res.json({ trigger: viewTrigger(row, names(owner)), ...(needsUrl ? { secret, hookUrl: hookUrl(row.id, secret) } : {}) });
    } catch (e) {
      c.failWith(res, e);
    }
  });

  // Live template preview: render a draft template against the trigger's last real payload (or a
  // sample the editor supplies). Pure â€” nothing is started. Registered before
  // /triggers/:id.json, which would otherwise match "preview.json".
  app.post("/triggers/preview.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const b = (req.body ?? {}) as { taskTemplate?: unknown; id?: unknown; name?: unknown };
    if (typeof b.taskTemplate !== "string") return void res.status(400).json({ error: "taskTemplate is required" });
    const owner = ownerOfP(c.principalOf(res), typeof b.id === "string" ? b.id : undefined);
    const payload = typeof b.id === "string" ? lastPayload(c.db, owner, b.id) : undefined;
    const r = renderTemplate(b.taskTemplate, templateContext(payload, { trigger: { name: typeof b.name === "string" ? b.name : "" }, now: new Date().toISOString() }));
    res.json({ ...r, hasPayload: payload !== undefined });
  });

  app.post("/triggers/:id.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res), req.params.id);
    const v = normalizeTrigger(req.body);
    if (!v.ok) return void res.status(400).json({ error: v.error });
    if (v.trigger.kind === "chain" && (v.trigger.spec.afterTrigger === req.params.id || !getTrigger(c.db, owner, v.trigger.spec.afterTrigger!)))
      return void res.status(400).json({ error: "a chain must follow another existing automation" });
    let row = updateTrigger(c.db, owner, req.params.id, v.trigger);
    if (!row) return void res.status(404).json({ error: "no such automation" });
    // Write-only: an update without a signing secret keeps the stored one.
    if (v.signingSecret) {
      setSigningSecret(c.db, c.box, owner, row.id, v.signingSecret);
      row = getTrigger(c.db, owner, row.id)!;
    }
    c.audit(owner, "trigger.update", { trigger: row.id });
    res.json({ trigger: viewTrigger(row, names(owner)) });
  });

  app.delete("/triggers/:id.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res), req.params.id);
    if (!deleteTrigger(c.db, owner, req.params.id)) return void res.status(404).json({ error: "no such automation" });
    c.audit(owner, "trigger.delete", { trigger: req.params.id });
    res.json({ ok: true });
  });

  app.post("/triggers/:id/enabled.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res), req.params.id);
    const row = setEnabled(c.db, owner, req.params.id, (req.body as { enabled?: unknown })?.enabled === true);
    if (!row) return void res.status(404).json({ error: "no such automation" });
    c.audit(owner, row.enabled ? "trigger.enable" : "trigger.disable", { trigger: row.id });
    res.json({ trigger: viewTrigger(row, names(owner)) });
  });

  /** "Make it an automation": a repeating chat schedule moves from Scheduled to Automations. */
  app.post("/triggers/:id/promote.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res), req.params.id);
    const row = promoteTrigger(c.db, owner, req.params.id);
    if (!row) return void res.status(400).json({ error: "only a repeating schedule can become an automation" });
    c.audit(owner, "trigger.promote", { trigger: row.id });
    res.json({ trigger: viewTrigger(row, names(owner)) });
  });

  app.post("/triggers/:id/rotate.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res), req.params.id);
    const secret = rotateSecret(c.db, c.box, owner, req.params.id);
    if (!secret) return void res.status(404).json({ error: "no such automation" });
    c.audit(owner, "trigger.rotate", { trigger: req.params.id });
    res.json({ secret, hookUrl: hookUrl(req.params.id, secret) });
  });

  // "Run now" â€” the test path. Renders against the last real payload when there is one.
  app.post("/triggers/:id/run.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res), req.params.id);
    const t = getTrigger(c.db, owner, req.params.id);
    if (!t) return void res.status(404).json({ error: "no such automation" });
    if (t.kind === "chain") return void res.status(400).json({ error: "a chain runs after its parent â€” run the parent instead" });
    try {
      const payload = lastPayload(c.db, owner, t.id);
      const match = t.kind === "github" && payload ? matchGithub(t.spec, t.repo ?? "", githubEventOf(t.spec.event), payload) : t.kind === "watch" ? watchSubject(payload) : undefined;
      const result = await c.dispatcher.fire(t, { payload, manual: true, ...(match?.match ? { match } : {}) });
      res.json({ result });
    } catch (e) {
      c.failWith(res, e);
    }
  });

  app.get("/triggers/:id/payload.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res), req.params.id);
    if (!getTrigger(c.db, owner, req.params.id)) return void res.status(404).json({ error: "no such automation" });
    res.json({ payload: lastPayload(c.db, owner, req.params.id) ?? null });
  });

  // â”€â”€â”€ deliveries (bet 4): the short log of what arrived and what happened to it â”€â”€â”€
  app.get("/triggers/:id/deliveries.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res), req.params.id);
    if (!getTrigger(c.db, owner, req.params.id)) return void res.status(404).json({ error: "no such automation" });
    res.json({ deliveries: listDeliveries(c.db, owner, req.params.id) });
  });

  // "Send test event" (bet 3): a synthetic vendor-shaped delivery through the SAME pipeline as a real
  // one, minus the vendor signature (the caller is the authenticated owner). Marked test everywhere:
  // `asb_test` in the payload, "[TEST]" in the alert title, `test` in the log and the run's event.
  app.post("/triggers/:id/test.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res), req.params.id);
    const t = getTrigger(c.db, owner, req.params.id);
    if (!t) return void res.status(404).json({ error: "no such automation" });
    if (t.kind !== "webhook" || !t.spec.preset) return void res.status(400).json({ error: "test events are for alert-source automations (Sentry, Datadog, PagerDuty)" });
    try {
      const { payload, headers } = testPayload(t.spec.preset, crypto.randomBytes(6).toString("hex"));
      const out = await receive(t, Buffer.from(JSON.stringify(payload)), headers, { test: true, wait: true });
      res.status(out.status).json(out.body);
    } catch (e) {
      c.failWith(res, e);
    }
  });

  // â”€â”€â”€ the receiver â”€â”€â”€
  const perTrigger = makeRateLimiter({ limit: 60, windowMs: 60_000 });

  type Out = { status: number; body: Record<string, unknown> };
  /**
   * One delivery, after the URL secret checked out. Every exit writes a delivery-log row (directly,
   * or through the dispatcher's markFired/markSkipped), so an automation that did not fire always
   * says why. `wait` (test events) awaits the fire so the caller gets the run id; real deliveries
   * answer first (GitHub's 10 s timeout) and fire after.
   */
  async function receive(
    t: TriggerRow,
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
    opt: { test?: boolean; wait?: boolean; secret?: string } = {}
  ): Promise<Out> {
    const at = Date.now();
    const test = !!opt.test;
    const note = (outcome: "skipped" | "rejected", reason: DeliveryReason, detail: string) =>
      logDelivery(c.db, t.id, { at, outcome, reason, detail, ...(test ? { test } : {}) });
    const ghEvent = typeof headers["x-github-event"] === "string" ? (headers["x-github-event"] as string) : "";
    if (t.kind === "github") {
      if (!verifyGithubSignature(opt.secret ?? "", raw, headers["x-hub-signature-256"] as string | undefined)) {
        note("rejected", "signature", "bad X-Hub-Signature-256");
        return { status: 401, body: { error: "bad signature (set the webhook secret to this automation's secret)" } };
      }
      if (ghEvent === "ping") return { status: 200, body: { ok: true, pong: true } };
    }
    if (t.spec.preset && !test) {
      const v = verifyPreset(t.spec.preset, revealSigningSecret(c.db, c.box, t.id), raw, headers);
      if (!v.ok) {
        note("rejected", "signature", v.reason);
        return { status: 401, body: { error: v.reason } };
      }
    }
    let payload: unknown;
    const text = raw.toString("utf8");
    try {
      payload = text.trim() ? JSON.parse(text) : {};
    } catch {
      if (t.kind === "github" || t.spec.preset) {
        note("rejected", "payload", "body is not JSON");
        return { status: 400, body: { error: "deliveries must be JSON (content type application/json)" } };
      }
      payload = { text: text.slice(0, 20_000) };
    }
    let alert: ReturnType<typeof normalizeAlert> | undefined;
    if (t.spec.preset) {
      // A real delivery can never pose as a test one.
      if (!test && payload && typeof payload === "object") delete (payload as Record<string, unknown>).asb_test;
      alert = normalizeAlert(t.spec.preset, payload, headers);
      if (!alert.ok) {
        note("rejected", "payload", alert.reason);
        return { status: 400, body: { error: alert.reason } };
      }
      // Stamp the normalised fields where the template ({{alert.title}}) and the preview can see them.
      payload = { ...(payload as Record<string, unknown>), asb_alert: alert.alert };
    }
    const keys = deliveryKeys(headers, raw);
    if (!claimDelivery(c.db, t.id, keys, at, 7 * 24 * 3600_000, t.kind === "github" ? 7 * 24 * 3600_000 : 60_000)) {
      note("skipped", "dedupe", "same delivery seen already");
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    // PR follow-ups: CI results and review feedback on a PR one of this owner's runs opened are
    // handled by the follow-up engine (src/pr-followup-engine.ts), not by this automation's filter.
    if (t.kind === "github" && !test && c.followups) {
      const cl = c.followups.claims(t.owner, ghEvent, payload);
      if (cl.ok) {
        void c.followups.handle({ id: t.id, owner: t.owner }, ghEvent, payload).catch((e) => {
          logDelivery(c.db, t.id, { at, outcome: "failed", reason: "error", detail: `follow-up: ${(e as Error).message.slice(0, 200)}` });
        });
        return { status: 202, body: { ok: true, followup: true } };
      }
    }
    // Stored for the editor's preview â€” redacted like every other stored text.
    try {
      savePayload(c.db, t.id, JSON.parse(c.redact(JSON.stringify(payload))));
    } catch {
      /* preview storage is best-effort */
    }
    if (!t.enabled && !test) {
      note("skipped", "disabled", "automation is paused");
      return { status: 202, body: { ok: true, skipped: "disabled" } };
    }
    let match: ReturnType<typeof matchGithub> | undefined;
    if (t.kind === "github") {
      match = matchGithub(t.spec, t.repo ?? "", ghEvent, payload);
      if (!match.match) {
        note("skipped", "ignored", match.reason);
        return { status: 202, body: { ok: true, ignored: match.reason } };
      }
    }
    if (alert?.ok) {
      if (!alert.fire) {
        note("skipped", "ignored", alert.reason);
        return { status: 202, body: { ok: true, ignored: alert.reason } };
      }
      // Cooldown per alert fingerprint: a storm of the same alert is one run.
      const cd = (t.spec.cooldownMin ?? 0) * 60_000;
      const fp = alert.alert.fingerprint.slice(0, 200);
      if (cd > 0 && !claimDelivery(c.db, t.id, [`alert:${fp}`], at, cd)) {
        note("skipped", "cooldown", `alert ${fp.slice(0, 60)} already fired within ${t.spec.cooldownMin} min`);
        return { status: 202, body: { ok: true, skipped: "cooldown" } };
      }
    }
    const event = test ? `test:${t.spec.preset ?? t.kind}` : ghEvent || t.spec.preset || "webhook";
    const fire = c.dispatcher.fire(t, { payload, event, ...(test ? { manual: true } : {}), ...(match?.match ? { match } : {}) }).then((r) => {
      if (test) markDeliveryTest(c.db, t.id, r.at);
      return r;
    });
    if (opt.wait) {
      const result = await fire;
      return { status: 200, body: { ok: true, test, result } };
    }
    // Answer now; the start can take longer than GitHub's 10 s delivery timeout. The outcome lands in
    // the delivery log, the trigger's last result and the audit log.
    void fire.catch((e) => {
      logDelivery(c.db, t.id, { at, outcome: "failed", reason: "error", detail: (e as Error).message.slice(0, 200) });
      console.error(`[triggers] ${t.id} fire failed: ${(e as Error).message.slice(0, 200)}`);
    });
    return { status: 202, body: { ok: true, accepted: true } };
  }
  app.post("/hooks/:id/:secret", async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").slice(0, 64);
    if (perTrigger.over(id)) {
      res.setHeader("Retry-After", "60");
      return void res.status(429).json({ error: "slow down" });
    }
    const t = getTriggerById(c.db, id);
    const real = t && (t.kind === "webhook" || t.kind === "github") ? revealSecret(c.db, c.box, t.id) : undefined;
    // Always compare, even for an unknown id, so timing does not tell "no such trigger" from "wrong secret".
    const okSecret = safeEqual(real ?? "\u0000no-trigger\u0000", String(req.params.secret ?? ""));
    if (t && real && !okSecret) logDelivery(c.db, t.id, { at: Date.now(), outcome: "rejected", reason: "signature", detail: "wrong secret in the URL" });
    if (!t || !real || !okSecret) return void res.status(404).json({ error: "not found" });
    const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
    try {
      const out = await receive(t, raw, req.headers as Record<string, string | string[] | undefined>, { secret: real });
      res.status(out.status).json(out.body);
    } catch (e) {
      c.failWith(res, e);
    }
  });
}

function githubEventOf(e: string | undefined): string {
  return e === "issue_labeled" ? "issues" : e === "issue_comment" ? "issue_comment" : e === "pr_opened" ? "pull_request" : "";
}

/** Run now on a repo-activity automation: the issue/PR of its last change, so the receipt lands there. */
function watchSubject(payload: unknown): { match: true; subject?: { kind: "issue" | "pr"; number: number } } {
  const p = (payload && typeof payload === "object" ? payload : {}) as { pull_request?: { number?: number }; issue?: { number?: number; pull_request?: unknown } };
  if (p.pull_request?.number) return { match: true, subject: { kind: "pr", number: p.pull_request.number } };
  if (p.issue?.number) return { match: true, subject: { kind: p.issue.pull_request ? "pr" : "issue", number: p.issue.number } };
  return { match: true };
}
