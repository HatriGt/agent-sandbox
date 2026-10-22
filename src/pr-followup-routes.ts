import type { Express, Request, Response } from "express";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import type { Principal } from "./identity.js";
import type { FollowupEngine, GhRequest } from "./pr-followup-engine.js";
import { OPERATOR_OWNER } from "./user-store.js";
import { deliveryKeys, verifyGithubSignature } from "./triggers.js";
import { claimDelivery, logDelivery } from "./trigger-store.js";
import { dropInstall, followupsForPr, hookById, hookDeliveries, hookOf, installsOf, listAgentPrs, revealHookSecret, rotateHook, saveInstall, type HookRow } from "./pr-followup-store.js";
import { FOLLOWUP_EVENTS, normalizePrefs, type FollowupPrefs } from "./pr-followups.js";
import { makeRateLimiter } from "./auth-throttle.js";
import { registerHook, rotateSecret } from "./hooks.js";

/**
 * HTTP surface for PR follow-ups: the owner's settings ("Keep my PRs green" / "Address review
 * comments", both default ON), their follow-up webhook, and the receiver
 * `POST /hooks/prs/:id/:secret` — the shared front door (src/hooks.ts: raw body → rate limit →
 * constant-time URL secret, unknown id and wrong secret answer the same 404), then
 * X-Hub-Signature-256 over the raw body → dedupe by delivery id / body hash → the engine's own
 * loop guard. `POST /pr-followups/install.json` puts that webhook on an organisation or a repo
 * with one click (the owner's token must administer it), which is what makes `/agent` instant.
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
  /** One GitHub call as the owner's account that reaches `repo` (an org is given as `org/-`). */
  gh(owner: string, repo: string, req: GhRequest): Promise<any>;
}

/** `acme`, `acme/app`, or either as a github.com URL → the install target; undefined when it is none of those. */
export function parseInstallTarget(raw: unknown): { kind: "org" | "repo"; target: string; hooksPath: string; repoHint: string } | undefined {
  const s = String(raw ?? "")
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const parts = s.split("/").filter(Boolean);
  if (!parts.length || parts.length > 2 || !parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(p))) return undefined;
  const target = parts.join("/");
  return parts.length === 1
    ? { kind: "org", target, hooksPath: `/orgs/${target}/hooks`, repoHint: `${target}/-` }
    : { kind: "repo", target, hooksPath: `/repos/${target}/hooks`, repoHint: target };
}

const ownerOfP = (p: Principal) => (p.kind === "user" ? p.userId : OPERATOR_OWNER);
export const FOLLOWUP_HOOK_EVENTS = ["check_run", "check_suite", "workflow_run", "pull_request_review", "pull_request_review_comment", "issue_comment"];

export function registerFollowupRoutes(app: Express, c: FollowupRouteCtx): void {
  const base = (c.publicUrl ?? "").replace(/\/$/, "");
  const hookUrl = (id: string, secret: string) => `${base}/hooks/prs/${id}/${secret}`;
  const publicInstall = (i: { target: string; kind: "org" | "repo"; createdAt: number }) => ({ target: i.target, kind: i.kind, createdAt: i.createdAt });

  app.get("/pr-followups.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    const h = hookOf(c.db, owner);
    res.json({
      prefs: c.loadPrefs(owner),
      hook: h ? { id: h.id, createdAt: h.createdAt, events: FOLLOWUP_HOOK_EVENTS } : null,
      installs: installsOf(c.db, owner).map(publicInstall),
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
      c.audit(owner, "followups.settings", { outcome: `green=${prefs.keepGreen} reviews=${prefs.addressReviews} anywhere=${prefs.commandAnywhere}` });
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

  // One click: put the owner's follow-up webhook on an organisation (every repo in it) or one repo,
  // as the owner's own GitHub account. GitHub then delivers `/agent` comments, CI results and
  // reviews the instant they happen; the poller stays as the fallback. Re-installing updates the
  // hook GitHub already has (matched by payload URL) rather than adding a second one.
  app.post("/pr-followups/install.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const t = parseInstallTarget(body.target ?? body.org ?? body.repo);
    if (!t) return void res.status(400).json({ error: "give an organisation (acme) or a repository (acme/app)" });
    try {
      let h = hookOf(c.db, owner);
      let secret = h ? revealHookSecret(c.db, c.box, h.id) : undefined;
      if (!h || !secret) {
        const r = rotateHook(c.db, c.box, owner);
        h = hookOf(c.db, owner)!;
        secret = r.secret;
      }
      const config = { url: hookUrl(h.id, secret), content_type: "json", secret, insecure_ssl: "0" };
      const prefix = `${base}/hooks/prs/${h.id}/`;
      const existing = (await c.gh(owner, t.repoHint, { path: `${t.hooksPath}?per_page=100` })) as Array<{ id?: number; config?: { url?: string } }> | null;
      const mine = (Array.isArray(existing) ? existing : []).find((x) => String(x.config?.url ?? "").startsWith(prefix));
      let ghHookId: number;
      if (mine?.id) {
        await c.gh(owner, t.repoHint, { method: "PATCH", path: `${t.hooksPath}/${mine.id}`, body: { active: true, events: FOLLOWUP_HOOK_EVENTS, config } });
        ghHookId = Number(mine.id);
      } else {
        const created = (await c.gh(owner, t.repoHint, { method: "POST", path: t.hooksPath, body: { name: "web", active: true, events: FOLLOWUP_HOOK_EVENTS, config } })) as { id?: number } | null;
        ghHookId = Number(created?.id);
        if (!Number.isFinite(ghHookId)) throw new Error("GitHub created the webhook but sent no id");
      }
      const install = saveInstall(c.db, { owner, target: t.target, kind: t.kind, ghHookId });
      c.audit(owner, "followups.install", { target: t.target, outcome: mine ? "updated" : "created" });
      res.json({ install: publicInstall(install), updated: !!mine, installs: installsOf(c.db, owner).map(publicInstall) });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/answered 404/.test(msg)) return void res.status(409).json({ error: `GitHub answered 404 for ${t.target}: the connected account must administer it (org owner, or repo admin), and it must exist` });
      if (/answered 403/.test(msg)) return void res.status(409).json({ error: `GitHub refused (403) for ${t.target}: the token lacks webhook rights (classic token: admin:org_hook / admin:repo_hook; fine-grained: Webhooks read & write)` });
      if (/no stored GitHub account/.test(msg)) return void res.status(409).json({ error: `no connected GitHub account reaches ${t.target}: connect one that administers it` });
      c.failWith(res, e);
    }
  });

  // Take the webhook off GitHub again (a hook GitHub no longer has is simply forgotten).
  app.post("/pr-followups/uninstall.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    const t = parseInstallTarget(((req.body ?? {}) as Record<string, unknown>).target);
    if (!t) return void res.status(400).json({ error: "give the organisation or repository to remove" });
    const row = installsOf(c.db, owner).find((i) => i.target === t.target);
    if (!row) return void res.status(404).json({ error: "not installed" });
    try {
      await c.gh(owner, t.repoHint, { method: "DELETE", path: `${t.hooksPath}/${row.ghHookId}` }).catch((e) => {
        if (!/answered 404/.test((e as Error).message ?? "")) throw e;
      });
      dropInstall(c.db, owner, t.target);
      c.audit(owner, "followups.uninstall", { target: t.target });
      res.json({ ok: true, installs: installsOf(c.db, owner).map(publicInstall) });
    } catch (e) {
      c.failWith(res, e);
    }
  });

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
      // The owner's own hook adopts any PR a trusted commenter addressed with /agent (an automation's hook does not).
      const cl = c.engine.claims(h.owner, ev, payload, { adopt: true });
      if (!cl.ok) {
        // Successes and green checks are the common case: only log what looked like follow-up material.
        if (FOLLOWUP_EVENTS.has(ev) && !/^check (run|suite) success|^workflow run success|neutral|skipped|in_progress|requested|queued/.test(cl.reason))
          logDelivery(c.db, h.id, { at, outcome: "skipped", reason: "ignored", detail: `${ev}: ${cl.reason}` });
        return void res.status(202).json({ ok: true, ignored: cl.reason });
      }
      // Answer inside GitHub's 10 s; the start lands in the delivery log.
      void c.engine.handle({ id: h.id, owner: h.owner }, ev, payload, { adopt: true }).catch((e) => {
        logDelivery(c.db, h.id, { at, outcome: "failed", reason: "error", detail: (e as Error).message.slice(0, 200) });
      });
      res.status(202).json({ ok: true, accepted: true });
    },
  });
}
