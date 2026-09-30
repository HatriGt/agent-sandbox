import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import {
  authVerdict, bareAddress, cleanSubject, emailTask, parseInboundEmail, parseIssueUrl, parseMime, parseSlack, resolveIntakeRepo, senderAllowed,
  slackText, splitAttachments, stripReply, verifyMailgun, verifySlack, isSlackResponseUrl,
} from "../src/intake.ts";
import { intakeBodyParser, registerIntakeRoutes } from "../src/intake-routes.ts";
import { getOrCreateChannel, revealChannelSecret, updateChannel } from "../src/intake-store.ts";
import type { RepoInfo } from "../src/repos.ts";

const box = makeSecretBox(crypto.randomBytes(32));
const repo = (fullName: string, pushedAt = "2026-01-01"): RepoInfo => ({ fullName, private: true, defaultBranch: "main", logins: ["a"], pushedAt });
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/* ─────────── pure: text ─────────── */

test("stripReply drops quoted replies, Outlook headers and signatures", () => {
  assert.equal(stripReply("Fix the login bug\n\nOn Mon, 1 Sep 2026 at 10:00, Bob <b@x.com> wrote:\n> old stuff"), "Fix the login bug");
  assert.equal(stripReply("Do it\n-- \nAda Lovelace\nCTO"), "Do it");
  assert.equal(stripReply("Please\n\nSent from my iPhone"), "Please");
  assert.equal(stripReply("Top\n\nFrom: Bob\nSent: Monday\nTo: me\nSubject: x\nold"), "Top");
  assert.equal(stripReply("a\n> quoted\nb"), "a\nb");
  // Gmail's two-line "On … wrote:"
  assert.equal(stripReply("new text\nOn Mon, 1 Sep 2026 at 10:00 Bob Smith\n<b@x.com> wrote:\n> q"), "new text");
});

test("cleanSubject and bareAddress", () => {
  assert.equal(cleanSubject("Re: Fwd: FW: the thing"), "the thing");
  assert.equal(bareAddress('"Ada L" <Ada@Example.COM>'), "ada@example.com");
  assert.equal(bareAddress("=?utf-8?B?QWRh?= <ada@x.io>"), "ada@x.io");
  assert.equal(bareAddress("nobody"), "");
});

test("senderAllowed: exact address or an explicit @domain", () => {
  assert.ok(senderAllowed("ada@x.io", ["ADA@x.io"]));
  assert.ok(senderAllowed("bob@corp.dev", ["@corp.dev"]));
  assert.ok(!senderAllowed("bob@evilcorp.dev.attacker.io", ["@corp.dev"]));
  assert.ok(!senderAllowed("eve@x.io", ["ada@x.io"]));
  assert.ok(!senderAllowed("", ["ada@x.io"]));
});

test("authVerdict rejects DMARC fail and SPF fail without DKIM", () => {
  assert.equal(authVerdict({}).ok, true);
  assert.equal(authVerdict({ dmarc: "fail" }).ok, false);
  assert.equal(authVerdict({ spf: "softfail" }).ok, false);
  assert.equal(authVerdict({ spf: "fail", dkim: "pass" }).ok, true);
});

/* ─────────── pure: providers ─────────── */

const mime = [
  "From: Ada <ada@x.io>",
  "To: inbox@me.dev",
  "Subject: =?utf-8?Q?Fix_the_caf=C3=A9_page?=",
  "Message-ID: <m1@x.io>",
  "Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=x.io; dkim=pass; dmarc=pass",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="B1"',
  "",
  "--B1",
  'Content-Type: multipart/alternative; boundary="B2"',
  "",
  "--B2",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "The caf=C3=A9 page 500s in acme/web.",
  "",
  "On Mon, Bob wrote:",
  "> earlier",
  "--B2",
  "Content-Type: text/html",
  "",
  "<p>html</p>",
  "--B2--",
  "--B1",
  'Content-Type: image/png; name="shot.png"',
  "Content-Disposition: attachment; filename=\"shot.png\"",
  "Content-Transfer-Encoding: base64",
  "",
  PNG.toString("base64"),
  "--B1",
  "Content-Type: application/pdf",
  'Content-Disposition: attachment; filename="spec.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4").toString("base64"),
  "--B1--",
  "",
].join("\r\n");

test("parseMime: nested multipart, QP, encoded subject, attachments", () => {
  const m = parseMime(Buffer.from(mime));
  assert.match(m.text, /café page 500s/);
  assert.equal(m.html, "<p>html</p>");
  assert.deepEqual(m.attachments.map((a) => [a.name, a.contentType]), [["shot.png", "image/png"], ["spec.pdf", "application/pdf"]]);
  assert.deepEqual(m.attachments[0].data, PNG);
});

test("cloudflare (raw MIME) → task with image attachment and a listed PDF", () => {
  const r = parseInboundEmail("cloudflare", "message/rfc822", Buffer.from(mime));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.email.from, "ada@x.io");
  assert.equal(r.email.subject, "Fix the café page");
  assert.equal(r.email.auth.dmarc, "pass");
  const atts = splitAttachments(r.email.attachments, "20260930");
  assert.equal(atts.images.length, 1);
  assert.match(atts.images[0].base64, /^data:image\/png;base64,/);
  const task = emailTask(r.email, atts);
  assert.match(task, /^Fix the café page\n\nThe café page 500s in acme\/web\./);
  assert.doesNotMatch(task, /earlier/);
  assert.match(task, /\/workspace\/\.attachments\/20260930-1-shot\.png/);
  assert.match(task, /spec\.pdf \(application\/pdf/);
});

test("postmark JSON", () => {
  const body = {
    FromFull: { Email: "Ada@x.io" },
    Subject: "Re: bump deps",
    TextBody: "bump deps\n\n> old",
    StrippedTextReply: "bump deps please",
    MessageID: "pm-1",
    Headers: [{ Name: "Received-SPF", Value: "Pass (sender ok)" }],
    Attachments: [{ Name: "a.png", ContentType: "image/png", Content: PNG.toString("base64") }],
  };
  const r = parseInboundEmail("postmark", "application/json", Buffer.from(JSON.stringify(body)));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.email.from, "ada@x.io");
  assert.equal(r.email.auth.spf, "pass");
  assert.equal(emailTask(r.email, splitAttachments([], "s")), "bump deps\n\nbump deps please");
  assert.equal(r.email.attachments[0].data.length, PNG.length);
});

function multipart(fields: Record<string, string>, files: Array<{ field: string; name: string; type: string; data: Buffer }> = []): { ct: string; body: Buffer } {
  const b = "XyZ" + crypto.randomBytes(4).toString("hex");
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`), f.data, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { ct: `multipart/form-data; boundary=${b}`, body: Buffer.concat(parts) };
}

test("sendgrid parsed mode: fields, SPF/DKIM, attachment-info names", () => {
  const { ct, body } = multipart(
    { from: "Ada <ada@x.io>", subject: "Hi", text: "do the thing", SPF: "pass", dkim: "{@x.io : pass}", headers: "Message-ID: <sg1@x.io>\n", "attachment-info": JSON.stringify({ attachment1: { filename: "real.png", type: "image/png" } }) },
    [{ field: "attachment1", name: "x", type: "image/png", data: PNG }]
  );
  const r = parseInboundEmail("sendgrid", ct, body);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.email.messageId, "<sg1@x.io>");
  assert.deepEqual(r.email.auth, { spf: "pass", dkim: "pass" });
  assert.equal(r.email.attachments[0].name, "real.png");
  assert.deepEqual(r.email.attachments[0].data, PNG);
});

test("mailgun: urlencoded fields + signature", () => {
  const key = "mg-key";
  const ts = String(Math.floor(Date.now() / 1000));
  const token = "tok123";
  const signature = crypto.createHmac("sha256", key).update(ts + token).digest("hex");
  const form = new URLSearchParams({ sender: "ada@x.io", from: "Ada <ada@x.io>", subject: "S", "body-plain": "body", "stripped-text": "stripped", timestamp: ts, token, signature });
  const r = parseInboundEmail("mailgun", "application/x-www-form-urlencoded", Buffer.from(form.toString()));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.email.stripped, "stripped");
  assert.deepEqual(verifyMailgun(key, r.mailgun!), { ok: true });
  assert.equal(verifyMailgun("wrong", r.mailgun!).ok, false);
  assert.equal(verifyMailgun(key, r.mailgun!, Number(ts) + 3600).ok, false);
});

/* ─────────── pure: Slack ─────────── */

function slackSign(secret: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  return { "x-slack-request-timestamp": String(ts), "x-slack-signature": "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex") };
}

test("verifySlack: v0 HMAC with a 5-minute window", () => {
  const body = "command=%2Fagent&text=hi";
  assert.deepEqual(verifySlack("s3", slackSign("s3", body), Buffer.from(body)), { ok: true });
  assert.equal(verifySlack("s3", slackSign("nope", body), Buffer.from(body)).ok, false);
  assert.equal(verifySlack("s3", slackSign("s3", body, Math.floor(Date.now() / 1000) - 600), Buffer.from(body)).ok, false);
  assert.equal(verifySlack(undefined, slackSign("s3", body), Buffer.from(body)).ok, false);
});

test("parseSlack: command, message shortcut, repo button", () => {
  const cmd = parseSlack(Buffer.from("command=%2Fagent&text=fix+it&user_id=U1&team_id=T1&response_url=https%3A%2F%2Fhooks.slack.com%2Fx"));
  assert.deepEqual(cmd, { kind: "command", userId: "U1", teamId: "T1", text: "fix it", responseUrl: "https://hooks.slack.com/x" });
  const sc = parseSlack(Buffer.from("payload=" + encodeURIComponent(JSON.stringify({ type: "message_action", callback_id: "send_to_agent_sandbox", user: { id: "U1" }, team: { id: "T1" }, channel: { id: "C1" }, message: { text: "the bug", ts: "1.2", thread_ts: "1.0" }, response_url: "https://hooks.slack.com/y" }))));
  assert.equal(sc.kind, "shortcut");
  if (sc.kind === "shortcut") assert.equal(sc.threadTs, "1.0");
  const ch = parseSlack(Buffer.from("payload=" + encodeURIComponent(JSON.stringify({ type: "block_actions", user: { id: "U1" }, actions: [{ action_id: "asb_repo_0", value: "inq_1|acme/web" }], response_url: "https://hooks.slack.com/z" }))));
  assert.deepEqual(ch, { kind: "choice", userId: "U1", teamId: "", pendingId: "inq_1", repo: "acme/web", responseUrl: "https://hooks.slack.com/z" });
  assert.equal(slackText("hi <@U1|ada> see <https://x.io|the doc> &amp; go"), "hi @ada see the doc (https://x.io) & go");
  assert.ok(isSlackResponseUrl("https://hooks.slack.com/actions/1"));
  assert.ok(!isSlackResponseUrl("https://hooks.slack.com.evil.io/x"));
  assert.ok(!isSlackResponseUrl("http://hooks.slack.com/x"));
});

/* ─────────── pure: repo + links ─────────── */

test("resolveIntakeRepo: named, several → ask, default, only, recent → ask", () => {
  const known = [repo("acme/web", "2026-09"), repo("acme/api-server", "2026-08"), repo("bob/tools", "2026-07")];
  assert.deepEqual(resolveIntakeRepo("fix acme/web login", known), { kind: "repo", repo: "acme/web", how: "named" });
  assert.equal(resolveIntakeRepo("sync acme/web with api-server", known).kind, "ask");
  assert.deepEqual(resolveIntakeRepo("something vague", known, "bob/tools"), { kind: "repo", repo: "bob/tools", how: "default" });
  assert.deepEqual(resolveIntakeRepo("something vague", [repo("a/b")]), { kind: "repo", repo: "a/b", how: "only" });
  assert.deepEqual(resolveIntakeRepo("something vague", known), { kind: "ask", choices: ["acme/web", "acme/api-server", "bob/tools"] });
  assert.deepEqual(resolveIntakeRepo("x", []), { kind: "none" });
  // A bare name two owners share: ask between them rather than guess.
  const shared = [repo("acme/widgets"), repo("bob/widgets"), repo("c/d")];
  assert.deepEqual(resolveIntakeRepo("the widgets build is red", shared, "c/d"), { kind: "ask", choices: ["acme/widgets", "bob/widgets"] });
  assert.deepEqual(resolveIntakeRepo("bob/widgets build is red", shared), { kind: "repo", repo: "bob/widgets", how: "named" });
});

test("parseIssueUrl", () => {
  assert.deepEqual(parseIssueUrl("https://github.com/acme/web/issues/12"), { kind: "github", repo: "acme/web", number: 12, url: "https://github.com/acme/web/issues/12" });
  assert.equal(parseIssueUrl("https://github.com/acme/web/pull/3#x")?.kind, "github");
  assert.deepEqual(parseIssueUrl("https://acme.sentry.io/issues/4567/?project=1"), { kind: "sentry", org: "acme", issueId: "4567", url: "https://acme.sentry.io/issues/4567/?project=1" });
  assert.equal(parseIssueUrl("https://sentry.io/organizations/acme/issues/9/")?.kind, "sentry");
  assert.equal(parseIssueUrl("see https://github.com/acme/web/issues/12"), undefined);
  assert.equal(parseIssueUrl("https://github.com.evil.io/a/b/issues/1"), undefined);
});

/* ─────────── routes ─────────── */

function setup(opts: { repos?: RepoInfo[]; email?: string | null } = {}) {
  const db = openMemoryDb();
  const starts: Array<{ owner: string; task: string; repo?: string; attachments?: unknown[]; startedBy: unknown }> = [];
  const slackPosts: Array<{ url: string; body: any }> = [];
  const app = express();
  app.use((req, res, next) => (req.path.startsWith("/hooks/intake/") ? intakeBodyParser : express.json())(req, res, next));
  registerIntakeRoutes(app, {
    db,
    box,
    dashAuthed: () => true,
    principalOf: () => ({ kind: "user", userId: "u1" }) as any,
    failWith: (res, e) => void res.status(500).json({ error: String(e) }),
    publicUrl: "https://asb.test",
    audit: () => {},
    ownerEmail: () => (opts.email === undefined ? "ada@x.io" : opts.email),
    listRepos: async () => opts.repos ?? [repo("acme/web")],
    githubToken: async () => "ghtok",
    startRun: async (owner, input) => {
      starts.push({ owner, ...input });
      return { ok: true, box: `box-${starts.length}` };
    },
    fetch: (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://hooks.slack.com/")) {
        slackPosts.push({ url: u, body: JSON.parse(String(init?.body)) });
        return new Response("ok");
      }
      if (u.startsWith("https://api.github.com/repos/acme/web/issues/12")) {
        assert.equal((init?.headers as Record<string, string>).authorization, "Bearer ghtok");
        return new Response(JSON.stringify({ title: "Login broken", body: "Steps: 1. click", labels: [{ name: "bug" }] }));
      }
      if (u.startsWith("https://slack.com/api/conversations.replies")) return new Response(JSON.stringify({ ok: true, messages: [{ text: "first" }, { text: "second <@U9|bob>" }] }));
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
    log: () => {},
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ch = getOrCreateChannel(db, box, "u1");
  const token = revealChannelSecret(db, box, ch.id, "email_token_enc")!;
  const wait = async (pred: () => boolean) => {
    for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 10));
  };
  const get = async (p: string) => (await fetch(base + p)).json() as Promise<any>;
  const post = async (p: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) => {
    const r = await fetch(base + p, { method: "POST", headers, body: typeof body === "string" || Buffer.isBuffer(body) ? (body as any) : JSON.stringify(body) });
    return { status: r.status, body: (await r.text().then((t) => (t ? JSON.parse(t) : {}))) as any };
  };
  return { db, ch, token, base, starts, slackPosts, wait, get, post, close: () => server.close() };
}

test("email: wrong token 404s and is logged; allowed sender starts a run with the image", async () => {
  const s = setup();
  try {
    assert.equal((await s.post(`/hooks/intake/email/${s.ch.id}/nope/cloudflare`, mime, { "content-type": "message/rfc822" })).status, 404);
    assert.equal((await s.post(`/hooks/intake/email/inb_nope/${s.token}/cloudflare`, mime, { "content-type": "message/rfc822" })).status, 404);
    const r = await s.post(`/hooks/intake/email/${s.ch.id}/${s.token}/cloudflare`, mime, { "content-type": "message/rfc822" });
    assert.equal(r.status, 200);
    await s.wait(() => s.starts.length > 0);
    assert.equal(s.starts.length, 1);
    assert.equal(s.starts[0].repo, "acme/web");
    assert.equal(s.starts[0].attachments?.length, 1);
    assert.deepEqual(s.starts[0].startedBy, { kind: "intake", source: "email", from: "ada@x.io" });
    // Replay of the same Message-ID fires nothing.
    await s.post(`/hooks/intake/email/${s.ch.id}/${s.token}/cloudflare`, mime, { "content-type": "message/rfc822" });
    const v = await s.get("/intake.json");
    const outcomes = v.deliveries.map((d: any) => `${d.outcome}:${d.reason ?? ""}`);
    assert.deepEqual(outcomes, ["skipped:dedupe", "fired:", "rejected:signature"]);
    assert.equal(s.starts.length, 1);
  } finally {
    s.close();
  }
});

test("email: a stranger is rejected (logged as sender); an extra allowed address works", async () => {
  const s = setup({ email: null });
  try {
    const body = JSON.stringify({ From: "eve@evil.io", Subject: "rm -rf", TextBody: "do bad things", MessageID: "e1" });
    await s.post(`/hooks/intake/email/${s.ch.id}/${s.token}/postmark`, body);
    assert.equal(s.starts.length, 0);
    assert.equal((await s.get("/intake.json")).deliveries[0].reason, "sender");
    updateChannel(s.db, box, "u1", { allowEmails: ["@evil.io"] });
    await s.post(`/hooks/intake/email/${s.ch.id}/${s.token}/postmark`, body.replace("e1", "e2"));
    await s.wait(() => s.starts.length > 0);
    assert.equal(s.starts.length, 1);
  } finally {
    s.close();
  }
});

test("email: mailgun with a key set requires a valid signature", async () => {
  const s = setup();
  try {
    updateChannel(s.db, box, "u1", { mailgunKey: "k" });
    const form = new URLSearchParams({ from: "ada@x.io", subject: "S", "body-plain": "b", timestamp: String(Math.floor(Date.now() / 1000)), token: "t", signature: "00" });
    const r = await s.post(`/hooks/intake/email/${s.ch.id}/${s.token}/mailgun`, form.toString(), { "content-type": "application/x-www-form-urlencoded" });
    assert.equal(r.status, 401);
    assert.equal(s.starts.length, 0);
  } finally {
    s.close();
  }
});

test("ambiguous repo asks with choices; answering starts once", async () => {
  const s = setup({ repos: [repo("acme/web"), repo("acme/api-server")] });
  try {
    await s.post(`/hooks/intake/email/${s.ch.id}/${s.token}/postmark`, JSON.stringify({ From: "ada@x.io", Subject: "something vague", TextBody: "x", MessageID: "a1" }));
    let v = await s.get("/intake.json");
    for (let i = 0; i < 100 && !v.pending.length; i++) {
      await new Promise((r) => setTimeout(r, 10));
      v = await s.get("/intake.json");
    }
    assert.equal(v.pending.length, 1);
    assert.deepEqual(v.pending[0].choices, ["acme/web", "acme/api-server"]);
    assert.equal(v.deliveries[0].reason, "asked");
    assert.equal(s.starts.length, 0);
    const id = v.pending[0].id;
    assert.equal((await s.post(`/intake/pending/${id}/answer.json`, { repo: "evil/repo" })).status, 400);
    const a = await s.post(`/intake/pending/${id}/answer.json`, { repo: "acme/api-server" });
    assert.equal(a.status, 200);
    assert.equal(a.body.url, "https://asb.test/dashboard/box/box-1");
    assert.equal(s.starts[0].repo, "acme/api-server");
    assert.equal((await s.post(`/intake/pending/${id}/answer.json`, { repo: "acme/web" })).status, 409);
    assert.equal(s.starts.length, 1);
  } finally {
    s.close();
  }
});

test("slack: signature, user allowlist, slash command, shortcut thread, button", async () => {
  const s = setup({ repos: [repo("acme/web"), repo("acme/api-server")] });
  try {
    const url = `/hooks/intake/slack/${s.ch.id}`;
    const form = "command=%2Fagent&text=fix+acme%2Fweb+login&user_id=U1&team_id=T1&response_url=https%3A%2F%2Fhooks.slack.com%2Fr1";
    const ct = { "content-type": "application/x-www-form-urlencoded" };
    // No secret yet → 401.
    assert.equal((await s.post(url, form, { ...ct, ...slackSign("sec", form) })).status, 401);
    updateChannel(s.db, box, "u1", { slackSigningSecret: "sec" });
    assert.equal((await s.post(url, form, { ...ct, ...slackSign("bad", form) })).status, 401);
    // Signed but the Slack user is not linked.
    let r = await s.post(url, form, { ...ct, ...slackSign("sec", form) });
    assert.equal(r.status, 200);
    assert.match(r.body.text, /U1\) is not linked/);
    assert.equal(s.starts.length, 0);
    updateChannel(s.db, box, "u1", { slackUsers: ["U1"], slackBotToken: "xoxb-1" });
    r = await s.post(url, form, { ...ct, ...slackSign("sec", form) });
    assert.equal(r.body.response_type, "ephemeral");
    await s.wait(() => s.slackPosts.length > 0);
    assert.equal(s.starts[0].repo, "acme/web");
    assert.match(s.slackPosts[0].body.text, /Started: https:\/\/asb\.test\/dashboard\/box\/box-1/);
    // Message shortcut: the whole thread becomes the task; no repo named → buttons.
    const sc = "payload=" + encodeURIComponent(JSON.stringify({ type: "message_action", user: { id: "U1" }, team: { id: "T1" }, channel: { id: "C1" }, message: { text: "only this", ts: "1.2", thread_ts: "1.0" }, response_url: "https://hooks.slack.com/r2" }));
    await s.post(url, sc, { ...ct, ...slackSign("sec", sc) });
    await s.wait(() => s.slackPosts.length > 1);
    const ask = s.slackPosts[1].body;
    assert.equal(ask.blocks[1].elements.length, 2);
    const value = ask.blocks[1].elements[1].value as string;
    assert.match(value, /^inq_.+\|acme\/api-server$/);
    const click = "payload=" + encodeURIComponent(JSON.stringify({ type: "block_actions", user: { id: "U1" }, actions: [{ action_id: "asb_repo_1", value }], response_url: "https://hooks.slack.com/r3" }));
    await s.post(url, click, { ...ct, ...slackSign("sec", click) });
    await s.wait(() => s.starts.length > 1);
    assert.equal(s.starts[1].repo, "acme/api-server");
    assert.equal(s.starts[1].task, "first\n\n---\n\nsecond @bob");
    await s.wait(() => s.slackPosts.length > 2);
    assert.match(s.slackPosts[2].body.text, /Started on acme\/api-server/);
  } finally {
    s.close();
  }
});

test("unfurl: GitHub issue with the owner's token; Sentry needs a token", async () => {
  const s = setup();
  try {
    const r = await s.post("/intake/unfurl.json", { url: "https://github.com/acme/web/issues/12" });
    assert.equal(r.status, 200);
    assert.match(r.body.task, /^Issue: Login broken\n\n\(acme\/web#12: https:\/\/github\.com\/acme\/web\/issues\/12\)\n\nLabels: bug\n\nSteps: 1\. click$/);
    assert.equal((await s.post("/intake/unfurl.json", { url: "https://acme.sentry.io/issues/1/" })).status, 400);
    assert.equal((await s.post("/intake/unfurl.json", { url: "https://example.com/x" })).status, 400);
  } finally {
    s.close();
  }
});

test("settings: validation and write-only secrets", async () => {
  const s = setup();
  try {
    assert.equal((await s.post("/intake.json", { allowEmails: ["not an email"] })).status, 400);
    assert.equal((await s.post("/intake.json", { slackUsers: ["u1"] })).status, 400);
    assert.equal((await s.post("/intake.json", { defaultRepo: "nope" })).status, 400);
    const r = await s.post("/intake.json", { allowEmails: ["Bob@X.io", "@corp.dev"], defaultRepo: "acme/web", slackSigningSecret: "sss" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.channel.allowEmails, ["bob@x.io", "@corp.dev"]);
    assert.equal(r.body.channel.hasSlackSecret, true);
    assert.doesNotMatch(JSON.stringify(r.body), /sss/);
    assert.match(r.body.email.urls.postmark, new RegExp(`/hooks/intake/email/${s.ch.id}/${s.token}/postmark$`));
    assert.match(r.body.slack.manifest, /send_to_agent_sandbox/);
    const rot = await s.post("/intake/rotate.json", {});
    assert.doesNotMatch(rot.body.email.urls.postmark, new RegExp(s.token));
  } finally {
    s.close();
  }
});
