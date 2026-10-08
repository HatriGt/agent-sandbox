import type { Express, Request, Response } from "express";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import type { Principal } from "./identity.js";
import type { FollowupEngine } from "./pr-followup-engine.js";
import { OPERATOR_OWNER } from "./user-store.js";
import { deliveryKeys, verifyGithubSignature } from "./triggers.js";
import { claimDelivery, logDelivery } from "./trigger-store.js";
import { followupsForPr, hookById, hookDeliveries, hookOf, listAgentPrs, revealHookSecret, rotateHook, type HookRow } from "./pr-followup-store.js";
import { FOLLOWUP_EVENTS, normalizePrefs, type FollowupPrefs } from "./pr-followups.js";
import { makeRateLimiter } from "./auth-throttle.js";
import { registerHook, rotateSecret } from "./hooks.js";

/**
 * HTTP surface for PR follow-ups: the owner's settings ("Keep my PRs green" / "Address review
 * comments", both default ON), their follow-up webhook, and the receiver
 * `POST /hooks/prs/:id/:secret` — the shared front door (src/hooks.ts: raw body → rate limit →
 * constant-time URL secret, unknown id and wrong secret answer the same 404), then
 * X-Hub-Signature-256 over the raw body → dedupe by delivery id / body hash → the engine's own
 * loop guard.
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
  app.post("/pr-followups/hook.json", (req, res) =>
    rotateSecret(c, req, res, {
      owner: ownerOfP,
      action: "followups.hook",
      rotate: (owner) => rotateHook(c.db, c.box, owner),
      notFound: "not found",
      detail: (r) => ({ trigger: r.id }),
      body: ({ id, secret }) => ({ id, secret, hookUrl: hookUrl(id, secret), events: FOLLOWUP_HOOK_EVENTS }),
    })
  );

  registerHook<HookRow>(app, {
    path: "/hooks/prs/:id/:secret",
    limiter: makeRateLimiter({ limit: 120, windowMs: 60_000 }),
    resolve: (id) => {
      const h = hookById(c.db, id);
      if (!h) return undefined;
      const secret = revealHookSecret(c.db, c.box, h.id);
      return secret ? { target: h, secret } : { target: h };
    },
    failWith: c.failWith,
    handle: (h, raw, req, res, real) => {
      const at = Date.now();
      const headers = req.headers as Record<string, string | string[] | undefined>;
      if (!verifyGithubSignature(real!, raw, headers["x-hub-signature-256"] as string | undefined)) {
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
    },
  });
}
