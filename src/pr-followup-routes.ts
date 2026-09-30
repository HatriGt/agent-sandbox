import type { Express, Request, Response } from "express";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import type { Principal } from "./identity.js";
import type { FollowupEngine } from "./pr-followup-engine.js";
import { OPERATOR_OWNER } from "./user-store.js";
import { deliveryKeys, safeEqual, verifyGithubSignature } from "./triggers.js";
import { claimDelivery, logDelivery } from "./trigger-store.js";
import { followupsForPr, hookById, hookDeliveries, hookOf, listAgentPrs, revealHookSecret, rotateHook } from "./pr-followup-store.js";
import { FOLLOWUP_EVENTS, normalizePrefs, type FollowupPrefs } from "./pr-followups.js";
import { makeRateLimiter } from "./auth-throttle.js";

/**
 * HTTP surface for PR follow-ups: the owner's settings ("Keep my PRs green" / "Address review
 * comments", both default ON), their follow-up webhook, and the receiver
 * `POST /hooks/prs/:id/:secret` — same security order as automation hooks (src/trigger-routes.ts):
 * rate limit → constant-time URL secret (unknown id and wrong secret answer the same 404) →
 * X-Hub-Signature-256 over the raw body → dedupe by delivery id / body hash → the engine's own
 * loop guard. The raw-body parser applies because the path starts with /hooks/.
 */

export interface FollowupRouteCtx {
  db: Db;
  box: SecretBox;
  engine: FollowupEngine;
  dashAuthed(req: Request, res: Response): boolean;
  principalOf(res: Response): Principal;
  failWith(res: Response, e: unknown): void;
  loadPrefs(owner: string): FollowupPrefs;
  savePrefs(owner: string, p: FollowupPrefs): void;
  publicUrl?: string;
  audit(owner: string, action: string, detail: Record<string, string | undefined>): void;
}

const ownerOfP = (p: Principal) => (p.kind === "user" ? p.userId : OPERATOR_OWNER);
export const FOLLOWUP_HOOK_EVENTS = ["check_run", "check_suite", "workflow_run", "pull_request_review", "pull_request_review_comment", "issue_comment"];

export function registerFollowupRoutes(app: Express, c: FollowupRouteCtx): void {
  const base = (c.publicUrl ?? "").replace(/\/$/, "");
  const hookUrl = (id: string, secret: string) => `${base}/hooks/prs/${id}/${secret}`;

  app.get("/pr-followups.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    const h = hookOf(c.db, owner);
    res.json({
      prefs: c.loadPrefs(owner),
      hook: h ? { id: h.id, createdAt: h.createdAt, events: FOLLOWUP_HOOK_EVENTS } : null,
      deliveries: hookDeliveries(c.db, owner, 20),
      prs: listAgentPrs(c.db, owner, 30).map((p) => ({
        repo: p.repo,
        number: p.number,
        box: p.rootBox,
        ...(p.branch ? { branch: p.branch } : {}),
        createdAt: p.createdAt,
        followups: followupsForPr(c.db, owner, p.repo, p.number),
      })),
    });
  });

  app.post("/pr-followups/settings.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    try {
      const prefs = normalizePrefs({ ...c.loadPrefs(owner), ...((req.body ?? {}) as object) });
      c.savePrefs(owner, prefs);
      c.audit(owner, "followups.settings", { outcome: `green=${prefs.keepGreen} reviews=${prefs.addressReviews}` });
      res.json({ prefs });
    } catch (e) {
      c.failWith(res, e);
    }
  });

  // Create or rotate the follow-up webhook. The secret is shown ONCE, here.
  app.post("/pr-followups/hook.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    try {
      const { id, secret } = rotateHook(c.db, c.box, owner);
      c.audit(owner, "followups.hook", { trigger: id });
      res.json({ id, secret, hookUrl: hookUrl(id, secret), events: FOLLOWUP_HOOK_EVENTS });
    } catch (e) {
      c.failWith(res, e);
    }
  });

  const limiter = makeRateLimiter({ limit: 120, windowMs: 60_000 });
  app.post("/hooks/prs/:id/:secret", async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").slice(0, 64);
    if (limiter.over(id)) {
      res.setHeader("Retry-After", "60");
      return void res.status(429).json({ error: "slow down" });
    }
    const h = hookById(c.db, id);
    const real = h ? revealHookSecret(c.db, c.box, h.id) : undefined;
    const okSecret = safeEqual(real ?? "\u0000no-hook\u0000", String(req.params.secret ?? ""));
    if (!h || !real || !okSecret) return void res.status(404).json({ error: "not found" });
    const at = Date.now();
    const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
    const headers = req.headers as Record<string, string | string[] | undefined>;
    if (!verifyGithubSignature(real, raw, headers["x-hub-signature-256"] as string | undefined)) {
      logDelivery(c.db, h.id, { at, outcome: "rejected", reason: "signature", detail: "bad X-Hub-Signature-256" });
      return void res.status(401).json({ error: "bad signature (set the webhook secret to the follow-up hook's secret)" });
    }
    const ev = typeof headers["x-github-event"] === "string" ? (headers["x-github-event"] as string) : "";
    if (ev === "ping") return void res.json({ ok: true, pong: true });
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      logDelivery(c.db, h.id, { at, outcome: "rejected", reason: "payload", detail: "body is not JSON" });
      return void res.status(400).json({ error: "deliveries must be JSON (content type application/json)" });
    }
    if (!claimDelivery(c.db, h.id, deliveryKeys(headers, raw), at)) return void res.json({ ok: true, duplicate: true });
    const cl = c.engine.claims(h.owner, ev, payload);
    if (!cl.ok) {
      // Successes and green checks are the common case: only log what looked like follow-up material.
      if (FOLLOWUP_EVENTS.has(ev) && !/^check (run|suite) success|^workflow run success|neutral|skipped|in_progress|requested|queued/.test(cl.reason))
        logDelivery(c.db, h.id, { at, outcome: "skipped", reason: "ignored", detail: `${ev}: ${cl.reason}` });
      return void res.status(202).json({ ok: true, ignored: cl.reason });
    }
    // Answer inside GitHub's 10 s; the start lands in the delivery log.
    void c.engine.handle({ id: h.id, owner: h.owner }, ev, payload).catch((e) => {
      logDelivery(c.db, h.id, { at, outcome: "failed", reason: "error", detail: (e as Error).message.slice(0, 200) });
    });
    res.status(202).json({ ok: true, accepted: true });
  });
}
