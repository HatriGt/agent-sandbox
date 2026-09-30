import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import type { Principal } from "./identity.js";
import type { RepoInfo } from "./repos.js";
import type { StartedBy } from "./started-by.js";
import { OPERATOR_OWNER } from "./user-store.js";
import { safeEqual } from "./triggers.js";
import { claimDelivery, logDelivery } from "./trigger-store.js";
import { makeRateLimiter } from "./auth-throttle.js";
import {
  authVerdict, emailTask, isEmailProvider, isSlackResponseUrl, parseInboundEmail, parseIssueUrl, parseSlack, resolveIntakeRepo, senderAllowed,
  slackText, splitAttachments, threadTask, unfurlTask, verifyMailgun, verifySlack, SLACK_SHORTCUT_ID, type EmailProvider, type IssueLink,
} from "./intake.js";
import {
  claimPending, createPending, dismissPending, getChannelById, getOrCreateChannel, listIntakeDeliveries, listPending, releasePending, revealChannelSecret,
  rotateEmailToken, setPendingBox, updateChannel, type IntakeChannel, type IntakeSource, type PendingIntake,
} from "./intake-store.js";

/**
 * "Starts from your inbox" (src/intake.ts has the rules). Owner-scoped settings routes for the
 * Integrations page, the composer's link unfurl, and two unauthenticated receivers:
 *
 *   POST /hooks/intake/email/:channel/:token/:provider   Postmark · SendGrid · Mailgun · Cloudflare
 *   POST /hooks/intake/slack/:channel                    slash command + shortcut + button clicks
 *
 * Both sit under /hooks/ so http.ts gives them raw bytes (signatures are over the exact body) and
 * masks the path in the audit log. Every delivery writes a row to the delivery log, including the
 * rejected ones, so "I emailed it and nothing happened" always has an answer.
 */

export const INTAKE_BODY_LIMIT = "25mb";
/** Raw parser for /hooks/intake/ — email with image attachments is far past the 512 KB hook cap. */
export const intakeBodyParser = express.raw({ type: () => true, limit: INTAKE_BODY_LIMIT });

type Attachment = { path: string; base64: string };
export type IntakeStart = { ok: true; box: string } | { ok: false; question: string };

export interface IntakeRouteCtx {
  db: Db;
  box: SecretBox;
  dashAuthed(req: Request, res: Response): boolean;
  principalOf(res: Response): Principal;
  failWith(res: Response, e: unknown): void;
  publicUrl?: string;
  audit(owner: string, action: string, detail: Record<string, string | undefined>): void;
  /** The account's own email address (GitHub-verified on OAuth sign-in) — allowed by default. */
  ownerEmail(owner: string): string | null | undefined;
  listRepos(owner: string): Promise<RepoInfo[]>;
  /** Start a run as the owner — the same flow as the composer. */
  startRun(owner: string, input: { task: string; repo?: string; attachments?: Attachment[]; startedBy: StartedBy }): Promise<IntakeStart>;
  /** A GitHub token of the owner's that can read `repo` (for pasted issue links), if any. */
  githubToken(owner: string, repo: string): Promise<string | undefined>;
  fetch?: typeof fetch;
  log?(m: string): void;
}

const ownerOfP = (p: Principal) => (p.kind === "user" ? p.userId : OPERATOR_OWNER);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^@[^\s@]+\.[^\s@]+$/;
const SLACK_USER_RE = /^[UW][A-Z0-9]{2,20}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function registerIntakeRoutes(app: Express, c: IntakeRouteCtx): void {
  const doFetch = c.fetch ?? fetch;
  const log = (m: string) => (c.log ? c.log(m) : console.error(m));
  const baseOf = (req: Request) => (c.publicUrl ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const runUrl = (base: string, box: string) => `${base}/dashboard/box/${encodeURIComponent(box)}`;
  const base0 = () => (c.publicUrl ?? "").replace(/\/$/, "");

  /* ─────────── settings (Integrations → Inbox) ─────────── */

  function view(req: Request, owner: string) {
    const ch = getOrCreateChannel(c.db, c.box, owner);
    const token = revealChannelSecret(c.db, c.box, ch.id, "email_token_enc") ?? "";
    const base = baseOf(req);
    const emailUrl = (p: EmailProvider) => `${base}/hooks/intake/email/${ch.id}/${token}/${p}`;
    const slackUrl = `${base}/hooks/intake/slack/${ch.id}`;
    return {
      channel: ch,
      accountEmail: c.ownerEmail(owner) ?? null,
      email: {
        urls: { postmark: emailUrl("postmark"), sendgrid: emailUrl("sendgrid"), mailgun: emailUrl("mailgun"), cloudflare: emailUrl("cloudflare") },
        cloudflareWorker: cloudflareWorker(emailUrl("cloudflare")),
      },
      slack: { url: slackUrl, manifest: slackManifest(slackUrl) },
      pending: listPending(c.db, owner),
      deliveries: listIntakeDeliveries(c.db, owner),
    };
  }

  app.get("/intake.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    res.json(view(req, ownerOfP(c.principalOf(res))));
  });

  app.post("/intake.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    const b = (req.body ?? {}) as Record<string, unknown>;
    const list = (v: unknown, re: RegExp, what: string, max: number): string[] | undefined => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v)) throw new Error(`${what} must be a list`);
      const out = [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))];
      if (out.length > max) throw new Error(`at most ${max} ${what}`);
      const bad = out.find((x) => !re.test(x));
      if (bad) throw new Error(`"${bad.slice(0, 60)}" is not a valid ${what.replace(/s$/, "")}`);
      return out;
    };
    const secret = (v: unknown, what: string): string | undefined => {
      if (v === undefined) return undefined;
      if (typeof v !== "string" || v.length > 500) throw new Error(`${what} must be a string`);
      return v.trim();
    };
    try {
      const allowEmails = list(b.allowEmails, { test: (s: string) => EMAIL_RE.test(s) || DOMAIN_RE.test(s) } as RegExp, "email addresses", 20)?.map((s) => s.toLowerCase());
      const slackUsers = list(b.slackUsers, SLACK_USER_RE, "Slack user IDs", 20);
      let defaultRepo: string | null | undefined;
      if (b.defaultRepo !== undefined) {
        const r = typeof b.defaultRepo === "string" ? b.defaultRepo.trim().replace(/\.git$/i, "") : "";
        if (r && !REPO_RE.test(r)) throw new Error("default repo must be owner/name");
        defaultRepo = r || null;
      }
      updateChannel(c.db, c.box, owner, {
        ...(allowEmails ? { allowEmails } : {}),
        ...(slackUsers ? { slackUsers } : {}),
        ...(defaultRepo !== undefined ? { defaultRepo } : {}),
        mailgunKey: secret(b.mailgunKey, "Mailgun signing key"),
        slackSigningSecret: secret(b.slackSigningSecret, "Slack signing secret"),
        slackBotToken: secret(b.slackBotToken, "Slack bot token"),
        sentryToken: secret(b.sentryToken, "Sentry token"),
      });
      c.audit(owner, "intake.update", {});
      res.json(view(req, owner));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post("/intake/rotate.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    getOrCreateChannel(c.db, c.box, owner);
    rotateEmailToken(c.db, c.box, owner);
    c.audit(owner, "intake.rotate", {});
    res.json(view(req, owner));
  });

  app.post("/intake/pending/:id/answer.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    const repo = String((req.body as { repo?: unknown })?.repo ?? "");
    try {
      const out = await answer(owner, req.params.id, repo);
      if (!out.ok) return void res.status(out.status).json({ error: out.error });
      res.json({ ok: true, box: out.box, url: runUrl(baseOf(req), out.box) });
    } catch (e) {
      c.failWith(res, e);
    }
  });

  app.post("/intake/pending/:id/dismiss.json", (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    if (!dismissPending(c.db, owner, req.params.id)) return void res.status(404).json({ error: "no such question" });
    res.json({ ok: true });
  });

  /* ─────────── composer: paste a GitHub / Sentry issue link ─────────── */

  app.post("/intake/unfurl.json", async (req, res) => {
    if (!c.dashAuthed(req, res)) return;
    const owner = ownerOfP(c.principalOf(res));
    const link = parseIssueUrl(String((req.body as { url?: unknown })?.url ?? ""));
    if (!link) return void res.status(400).json({ error: "not a GitHub issue/PR or Sentry issue link" });
    try {
      const out = await unfurl(owner, link);
      if (!out.ok) return void res.status(out.status).json({ error: out.error });
      res.json(out.body);
    } catch (e) {
      c.failWith(res, e);
    }
  });

  async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await doFetch(url, { headers: { "user-agent": "agent-sandbox", ...headers }, signal: ctl.signal, redirect: "error" });
      const text = await r.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      return { status: r.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  type Unfurled = { ok: true; body: { task: string; title: string; source: IssueLink["kind"]; repo?: string } } | { ok: false; status: number; error: string };
  async function unfurl(owner: string, link: IssueLink): Promise<Unfurled> {
    if (link.kind === "github") {
      const token = await c.githubToken(owner, link.repo).catch(() => undefined);
      const r = await getJson(`https://api.github.com/repos/${link.repo}/issues/${link.number}`, {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      });
      if (r.status === 404 || r.status === 401 || r.status === 403) return { ok: false, status: 404, error: token ? "GitHub says that issue does not exist or your account cannot read it" : "that issue is not public — connect a GitHub account that can read it" };
      if (r.status !== 200 || !r.body?.title) return { ok: false, status: 502, error: `GitHub answered ${r.status}` };
      const labels = Array.isArray(r.body.labels) ? r.body.labels.map((l: { name?: string }) => l?.name).filter(Boolean) : [];
      const kind = r.body.pull_request ? "PR" : "Issue";
      return {
        ok: true,
        body: {
          title: String(r.body.title),
          source: "github",
          repo: link.repo,
          task: unfurlTask(link, { title: `${kind}: ${r.body.title}`, body: String(r.body.body ?? ""), extra: labels.length ? `Labels: ${labels.join(", ")}` : "" }),
        },
      };
    }
    const ch = getOrCreateChannel(c.db, c.box, owner);
    const token = revealChannelSecret(c.db, c.box, ch.id, "sentry_token_enc");
    if (!token) return { ok: false, status: 400, error: "add a Sentry auth token under Integrations → Inbox to read Sentry issues" };
    const r = await getJson(`https://sentry.io/api/0/organizations/${encodeURIComponent(link.org)}/issues/${encodeURIComponent(link.issueId)}/`, { authorization: `Bearer ${token}` });
    if (r.status === 404 || r.status === 401 || r.status === 403) return { ok: false, status: 404, error: "Sentry says that issue does not exist or the token cannot read it" };
    if (r.status !== 200 || !r.body?.title) return { ok: false, status: 502, error: `Sentry answered ${r.status}` };
    const b = r.body;
    const facts = [
      b.culprit ? `Culprit: ${b.culprit}` : "",
      b.level ? `Level: ${b.level}` : "",
      b.count ? `Events: ${b.count}${b.userCount ? ` · users: ${b.userCount}` : ""}` : "",
      b.project?.slug ? `Project: ${b.project.slug}` : "",
      b.firstSeen ? `First seen: ${b.firstSeen}` : "",
    ].filter(Boolean);
    return {
      ok: true,
      body: {
        title: String(b.title),
        source: "sentry",
        task: unfurlTask(link, { title: `Sentry: ${b.title}`, body: b.metadata?.value ? String(b.metadata.value) : "", extra: facts.join("\n") }),
      },
    };
  }

  /* ─────────── shared intake path ─────────── */

  interface Item {
    source: IntakeSource;
    task: string;
    attachments: Attachment[];
    from?: string;
    label: string;
    responseUrl?: string;
  }
  type Accepted = { kind: "started"; box: string } | { kind: "asked"; pending: PendingIntake } | { kind: "failed"; reason: string };

  async function start(ch: IntakeChannel, item: Pick<Item, "source" | "task" | "attachments" | "from" | "label">, repo: string | undefined, at: number): Promise<Accepted> {
    const r = await c
      .startRun(ch.owner, {
        task: item.task,
        ...(repo ? { repo } : {}),
        ...(item.attachments.length ? { attachments: item.attachments } : {}),
        startedBy: { kind: "intake", source: item.source, ...(item.from ? { from: item.from } : {}) },
      })
      .catch((e): IntakeStart => ({ ok: false, question: (e as Error).message }));
    if (r.ok) {
      logDelivery(c.db, ch.id, { at, outcome: "fired", detail: `${item.label}${repo ? ` → ${repo}` : ""}`, box: r.box });
      c.audit(ch.owner, "intake.fire", { trigger: ch.id, box: r.box, outcome: item.source });
      return { kind: "started", box: r.box };
    }
    logDelivery(c.db, ch.id, { at, outcome: "failed", reason: "error", detail: `${item.label}: ${r.question}` });
    return { kind: "failed", reason: r.question };
  }

  async function accept(ch: IntakeChannel, item: Item): Promise<Accepted> {
    const at = Date.now();
    let known: RepoInfo[] = [];
    try {
      known = await c.listRepos(ch.owner);
    } catch {
      /* no listing: the default repo, or ask nothing and run task-only */
    }
    const pick = resolveIntakeRepo(item.task, known, ch.defaultRepo);
    if (pick.kind === "ask") {
      const pending = createPending(c.db, {
        owner: ch.owner,
        channelId: ch.id,
        source: item.source,
        task: item.task,
        attachments: item.attachments,
        choices: pick.choices,
        meta: { ...(item.from ? { from: item.from } : {}), ...(item.responseUrl ? { responseUrl: item.responseUrl } : {}) },
      });
      logDelivery(c.db, ch.id, { at, outcome: "skipped", reason: "asked", detail: `${item.label} — which repo? ${pick.choices.join(", ")}` });
      return { kind: "asked", pending };
    }
    return start(ch, item, pick.kind === "repo" ? pick.repo : undefined, at);
  }

  async function answer(owner: string, id: string, repo: string): Promise<{ ok: true; box: string } | { ok: false; status: number; error: string }> {
    const p = claimPending(c.db, owner, id);
    if (!p) return { ok: false, status: 409, error: "that question was already answered or has expired" };
    if (!p.choices.includes(repo)) {
      releasePending(c.db, id);
      return { ok: false, status: 400, error: "pick one of the offered repos" };
    }
    const ch = getChannelById(c.db, p.channelId);
    if (!ch || ch.owner !== owner) return { ok: false, status: 404, error: "no such question" };
    const r = await start(ch, { source: p.source, task: p.task, attachments: p.attachments, from: p.meta.from, label: `${p.source} (answered)` }, repo, Date.now());
    if (r.kind === "started") {
      setPendingBox(c.db, id, r.box);
      return { ok: true, box: r.box };
    }
    releasePending(c.db, id);
    return { ok: false, status: 502, error: r.kind === "failed" ? r.reason : "could not start" };
  }

  /* ─────────── email receiver ─────────── */

  const perChannel = makeRateLimiter({ limit: 30, windowMs: 60_000 });

  app.post("/hooks/intake/email/:id/:token/:provider", async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").slice(0, 64);
    const provider = String(req.params.provider ?? "");
    if (perChannel.over(`email:${id}`)) {
      res.setHeader("Retry-After", "60");
      return void res.status(429).json({ error: "slow down" });
    }
    const ch = getChannelById(c.db, id);
    const real = ch ? revealChannelSecret(c.db, c.box, ch.id, "email_token_enc") : undefined;
    // Always compare, so timing does not tell "no such channel" from "wrong token".
    const okToken = safeEqual(real ?? "\u0000no-channel\u0000", String(req.params.token ?? ""));
    if (ch && real && !okToken) logDelivery(c.db, ch.id, { at: Date.now(), outcome: "rejected", reason: "signature", detail: "email: wrong token in the URL" });
    if (!ch || !real || !okToken || !isEmailProvider(provider)) return void res.status(404).json({ error: "not found" });
    const at = Date.now();
    const note = (reason: "signature" | "payload" | "sender" | "dedupe", detail: string) => logDelivery(c.db, ch.id, { at, outcome: reason === "dedupe" ? "skipped" : "rejected", reason, detail: `email: ${detail}` });
    const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
    const parsed = parseInboundEmail(provider, req.headers["content-type"], raw);
    if (!parsed.ok) {
      note("payload", parsed.reason);
      return void res.status(400).json({ error: parsed.reason });
    }
    if (provider === "mailgun") {
      const key = revealChannelSecret(c.db, c.box, ch.id, "mailgun_key_enc");
      if (key) {
        const v = verifyMailgun(key, parsed.mailgun ?? {});
        if (!v.ok) {
          note("signature", v.reason);
          return void res.status(401).json({ error: v.reason });
        }
      }
    }
    const e = parsed.email;
    // Policy rejections answer 200: a provider retries on anything else, and a retry changes nothing.
    const allow = [c.ownerEmail(ch.owner) ?? "", ...ch.allowEmails].filter(Boolean);
    if (!senderAllowed(e.from, allow)) {
      note("sender", `${e.from || "unknown sender"} is not on the allowed senders list`);
      return void res.status(200).json({ ok: true, ignored: "sender not allowed" });
    }
    const auth = authVerdict(e.auth);
    if (!auth.ok) {
      note("sender", `${e.from}: ${auth.reason}`);
      return void res.status(200).json({ ok: true, ignored: auth.reason });
    }
    const keys = [e.messageId ? `msg:${e.messageId.slice(0, 200)}` : `body:${hash(raw)}`, ...(parsed.mailgun?.token ? [`mg:${parsed.mailgun.token.slice(0, 100)}`] : [])];
    if (!claimDelivery(c.db, ch.id, keys, at)) {
      note("dedupe", "same message seen already");
      return void res.status(200).json({ ok: true, duplicate: true });
    }
    const stamp = new Date(at).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const atts = splitAttachments(e.attachments, stamp);
    const task = emailTask(e, atts);
    if (!task) {
      note("payload", "empty subject and body");
      return void res.status(200).json({ ok: true, ignored: "empty" });
    }
    const label = `email from ${e.from}: ${(e.subject || task).slice(0, 80)}`;
    // Answer now (providers time out); the outcome lands in the delivery log.
    void accept(ch, { source: "email", task, attachments: atts.images, from: e.from, label }).catch((err) => {
      logDelivery(c.db, ch.id, { at, outcome: "failed", reason: "error", detail: `${label}: ${(err as Error).message.slice(0, 160)}` });
      log(`[intake] ${ch.id} email failed: ${(err as Error).message.slice(0, 200)}`);
    });
    res.status(200).json({ ok: true, accepted: true });
  });

  /* ─────────── Slack receiver ─────────── */

  async function slackPost(url: string | undefined, body: Record<string, unknown>): Promise<void> {
    if (!url || !isSlackResponseUrl(url)) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      await doFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal, redirect: "error" });
    } catch (e) {
      log(`[intake] slack response failed: ${(e as Error).message.slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  function slackOutcome(a: Accepted): Record<string, unknown> {
    if (a.kind === "started") return { response_type: "ephemeral", replace_original: true, text: `Started: ${runUrl(base0(), a.box)}` };
    if (a.kind === "failed") return { response_type: "ephemeral", replace_original: true, text: `Could not start: ${a.reason.slice(0, 300)}` };
    const p = a.pending;
    return {
      response_type: "ephemeral",
      text: "Which repo should this run on?",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*Which repo should this run on?*\n>${p.task.slice(0, 280).replace(/\n/g, "\n>")}` } },
        {
          type: "actions",
          elements: p.choices.map((r, i) => ({ type: "button", action_id: `asb_repo_${i}`, text: { type: "plain_text", text: r.slice(0, 75) }, value: `${p.id}|${r}` })),
        },
      ],
    };
  }

  async function fetchThread(ch: IntakeChannel, channelId: string | undefined, ts: string | undefined): Promise<string | undefined> {
    const token = revealChannelSecret(c.db, c.box, ch.id, "slack_bot_token_enc");
    if (!token || !channelId || !ts) return undefined;
    try {
      const r = await getJson(`https://slack.com/api/conversations.replies?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(ts)}&limit=50`, { authorization: `Bearer ${token}` });
      if (!r.body?.ok || !Array.isArray(r.body.messages)) return undefined;
      return threadTask(r.body.messages.map((m: { text?: string }) => ({ text: slackText(String(m.text ?? "")) })));
    } catch {
      return undefined;
    }
  }

  app.post("/hooks/intake/slack/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").slice(0, 64);
    if (perChannel.over(`slack:${id}`)) {
      res.setHeader("Retry-After", "60");
      return void res.status(429).json({ error: "slow down" });
    }
    const ch = getChannelById(c.db, id);
    if (!ch) return void res.status(404).json({ error: "not found" });
    const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);
    const at = Date.now();
    const v = verifySlack(revealChannelSecret(c.db, c.box, ch.id, "slack_signing_secret_enc"), req.headers as Record<string, string | string[] | undefined>, raw);
    if (!v.ok) {
      logDelivery(c.db, ch.id, { at, outcome: "rejected", reason: "signature", detail: `slack: ${v.reason}` });
      return void res.status(401).json({ error: v.reason });
    }
    // Slack retries when we were slow; the first attempt already did the work.
    if (req.headers["x-slack-retry-num"]) return void res.status(200).send("");
    const s = parseSlack(raw);
    if (s.kind === "other") return void res.status(200).send("");
    if (!ch.slackUsers.includes(s.userId)) {
      logDelivery(c.db, ch.id, { at, outcome: "rejected", reason: "sender", detail: `slack: user ${s.userId.slice(0, 20)} is not linked` });
      const text = `Your Slack user ID (${s.userId}) is not linked to this Agent Sandbox account. Add it under Integrations → Inbox → Slack.`;
      if (s.kind === "command") return void res.status(200).json({ response_type: "ephemeral", text });
      res.status(200).send("");
      return void slackPost(s.responseUrl, { response_type: "ephemeral", text });
    }
    if (s.kind === "choice") {
      res.status(200).send("");
      const out = await answer(ch.owner, s.pendingId, s.repo).catch((e) => ({ ok: false as const, status: 500, error: (e as Error).message }));
      return void slackPost(s.responseUrl, out.ok ? { replace_original: true, text: `Started on ${s.repo}: ${runUrl(base0(), out.box)}` } : { replace_original: false, response_type: "ephemeral", text: `Could not start: ${out.error}` });
    }
    let task = slackText(s.text);
    if (s.kind === "command" && !task) return void res.status(200).json({ response_type: "ephemeral", text: "Usage: /agent <what to do> — name the repo (owner/name) or set a default under Integrations → Inbox." });
    // Answer inside Slack's 3 s window; the run link follows on the response URL.
    if (s.kind === "command") res.status(200).json({ response_type: "ephemeral", text: "On it — starting a machine…" });
    else res.status(200).send("");
    if (s.kind === "shortcut") {
      const thread = await fetchThread(ch, s.channelId, s.threadTs ?? s.messageTs);
      if (thread) task = thread;
      if (!task) return void slackPost(s.responseUrl, { response_type: "ephemeral", text: "That message has no text to send." });
    }
    const label = `slack ${s.kind === "command" ? "/agent" : "shortcut"}: ${task.slice(0, 80)}`;
    const a = await accept(ch, { source: "slack", task, attachments: [], label, responseUrl: s.responseUrl }).catch((e): Accepted => ({ kind: "failed", reason: (e as Error).message }));
    await slackPost(s.responseUrl, slackOutcome(a));
  });
}

function hash(b: Buffer): string {
  return crypto.createHash("sha256").update(b).digest("hex").slice(0, 32);
}

/** The Cloudflare Email Worker the owner pastes (Email Routing → route to this Worker). */
export function cloudflareWorker(url: string): string {
  return [
    "export default {",
    "  async email(message, env, ctx) {",
    `    const r = await fetch(${JSON.stringify(url)}, {`,
    '      method: "POST",',
    '      headers: { "content-type": "message/rfc822" },',
    "      body: message.raw,",
    "    });",
    '    if (!r.ok) message.setReject("Agent Sandbox did not accept this message");',
    "  },",
    "};",
  ].join("\n");
}

/** A Slack app manifest: /agent + the message shortcut, both pointed at the owner's receiver. */
export function slackManifest(url: string): string {
  return JSON.stringify(
    {
      display_information: { name: "Agent Sandbox", description: "Start agent runs from Slack" },
      features: {
        bot_user: { display_name: "Agent Sandbox", always_online: false },
        slash_commands: [{ command: "/agent", url, description: "Start an Agent Sandbox run", usage_hint: "fix the flaky login test in acme/web", should_escape: false }],
        shortcuts: [{ name: "Send to Agent Sandbox", type: "message", callback_id: SLACK_SHORTCUT_ID, description: "Start a run from this message and its thread" }],
      },
      oauth_config: { scopes: { bot: ["commands", "channels:history", "groups:history", "im:history", "mpim:history"] } },
      settings: { interactivity: { is_enabled: true, request_url: url }, org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
    },
    null,
    2
  );
}
