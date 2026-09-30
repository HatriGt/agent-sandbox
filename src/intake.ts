/**
 * "Starts from your inbox": the PURE half of the intake channels (email, Slack, pasted links). No
 * I/O here, so every rule is unit-tested (test/intake.test.ts); src/intake-routes.ts does the rest.
 *
 *   Email — four inbound-parse shapes normalise to one `InboundEmail`:
 *     postmark    JSON (Postmark inbound webhook). Postmark does not sign; the secret token in the URL is the gate.
 *     sendgrid    multipart/form-data (SendGrid Inbound Parse, parsed or "raw" mode). Not signed; URL token.
 *     mailgun     urlencoded or multipart (Mailgun routes → forward()). Signed: `signature` =
 *                 hex HMAC-SHA256(webhook signing key, timestamp + token); checked when the key is set.
 *     cloudflare  raw RFC 822 (a Cloudflare Email Worker POSTs `message.raw`). Not signed; URL token.
 *   then: sender allowlist, SPF/DKIM/DMARC verdicts where the provider reports them, quoted-reply and
 *   signature stripping, attachments (images become run attachments; everything else is listed).
 *
 *   Slack — X-Slack-Signature v0 (HMAC-SHA256 over `v0:<ts>:<raw body>`, 5-minute window), then the
 *   slash command / message shortcut / button click in one parsed shape.
 *
 *   Repo — named in the text → that repo; several named → ask; none → the default repo from
 *   settings; still nothing → the only repo, or ask with the most recent ones.
 */
import crypto from "node:crypto";
import { safeEqual } from "./triggers.js";
import { inferRepos, type RepoInfo } from "./repos.js";

type H = Record<string, string | string[] | undefined>;
const hget = (h: H, k: string): string | undefined => {
  const v = h[k.toLowerCase()];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
};

export const EMAIL_PROVIDERS = ["postmark", "sendgrid", "mailgun", "cloudflare"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];
export const isEmailProvider = (s: string): s is EmailProvider => (EMAIL_PROVIDERS as readonly string[]).includes(s);

export const MAX_TASK_CHARS = 20_000;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES = 8;

export interface InboundAttachment {
  name: string;
  contentType: string;
  data: Buffer;
}

export interface InboundEmail {
  /** Bare, lower-cased sender address. */
  from: string;
  subject: string;
  /** Plain text (HTML converted when that is all there is), not yet stripped. */
  text: string;
  /** A provider's own reply-stripped text, when it offers one (Postmark, Mailgun). */
  stripped?: string;
  messageId?: string;
  attachments: InboundAttachment[];
  /** What the receiving provider said about authenticity, when it said anything. */
  auth: { spf?: string; dkim?: string; dmarc?: string };
}

/* ───────────────────────────── MIME and form parsing ───────────────────────────── */

export interface MimeHeaders {
  [k: string]: string;
}

function splitHead(buf: Buffer): { head: string; body: Buffer } {
  let i = buf.indexOf("\r\n\r\n");
  let skip = 4;
  const j = buf.indexOf("\n\n");
  if (i < 0 || (j >= 0 && j < i)) {
    i = j;
    skip = 2;
  }
  if (i < 0) return { head: buf.toString("latin1"), body: Buffer.alloc(0) };
  return { head: buf.subarray(0, i).toString("latin1"), body: buf.subarray(i + skip) };
}

export function parseHeaderBlock(head: string): MimeHeaders {
  const out: MimeHeaders = {};
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const k = line.indexOf(":");
    if (k <= 0) continue;
    const name = line.slice(0, k).trim().toLowerCase();
    const value = line.slice(k + 1).trim();
    // Keep the FIRST occurrence (Authentication-Results from the receiving hop is on top), except
    // for headers that are fine to join.
    if (!(name in out)) out[name] = value;
  }
  return out;
}

/** `text/plain; charset="utf-8"; name=a.png` → { value, params }. */
export function parseParams(v: string | undefined): { value: string; params: Record<string, string> } {
  const parts = (v ?? "").split(";");
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const k = p.indexOf("=");
    if (k < 0) continue;
    const key = p.slice(0, k).trim().toLowerCase().replace(/\*$/, "");
    let val = p.slice(k + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    // RFC 2231 `filename*=utf-8''a%20b.png`
    const ext = val.match(/^([\w-]+)'[^']*'(.*)$/);
    if (ext && p.slice(0, k).trim().endsWith("*")) {
      try {
        val = decodeURIComponent(ext[2]);
      } catch {
        /* keep raw */
      }
    }
    params[key] = val;
  }
  return { value: (parts[0] ?? "").trim().toLowerCase(), params };
}

function decodeCharset(buf: Buffer, charset: string | undefined): string {
  const cs = (charset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(cs === "us-ascii" ? "utf-8" : cs).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

function decodeQP(s: string): Buffer {
  const bytes: number[] = [];
  const src = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(src.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** RFC 2047 encoded words: `=?utf-8?B?...?=` / `=?utf-8?Q?...?=`. */
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, cs: string, enc: string, data: string) => {
    const buf = enc.toUpperCase() === "B" ? Buffer.from(data, "base64") : decodeQP(data.replace(/_/g, " "));
    return decodeCharset(buf, cs);
  });
}

function decodeBody(body: Buffer, transferEncoding: string | undefined): Buffer {
  const te = (transferEncoding ?? "").toLowerCase();
  if (te === "base64") return Buffer.from(body.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (te === "quoted-printable") return decodeQP(body.toString("latin1"));
  return body;
}

/** Split a multipart body on its boundary. Binary-safe. */
export function splitMultipart(body: Buffer, boundary: string): Buffer[] {
  const delim = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let pos = body.indexOf(delim);
  while (pos >= 0) {
    let start = pos + delim.length;
    if (body.subarray(start, start + 2).toString() === "--") break; // closing delimiter
    if (body[start] === 0x0d) start++;
    if (body[start] === 0x0a) start++;
    const next = body.indexOf(delim, start);
    if (next < 0) break;
    let end = next;
    if (body[end - 1] === 0x0a) end--;
    if (body[end - 1] === 0x0d) end--;
    parts.push(body.subarray(start, end));
    pos = next;
  }
  return parts;
}

export interface ParsedMime {
  headers: MimeHeaders;
  text: string;
  html: string;
  attachments: InboundAttachment[];
}

/** A whole RFC 822 message → headers, first text/plain, first text/html, attachments. */
export function parseMime(raw: Buffer, depth = 0): ParsedMime {
  const { head, body } = splitHead(raw);
  const headers = parseHeaderBlock(head);
  const out: ParsedMime = { headers, text: "", html: "", attachments: [] };
  walk(headers, body, out, depth);
  return out;
}

function walk(headers: MimeHeaders, body: Buffer, out: ParsedMime, depth: number): void {
  if (depth > 8) return;
  const ct = parseParams(headers["content-type"] ?? "text/plain");
  const cd = parseParams(headers["content-disposition"]);
  if (ct.value.startsWith("multipart/") && ct.params.boundary) {
    for (const part of splitMultipart(body, ct.params.boundary)) {
      const { head, body: pb } = splitHead(part);
      walk(parseHeaderBlock(head), pb, out, depth + 1);
    }
    return;
  }
  const data = decodeBody(body, headers["content-transfer-encoding"]);
  const filename = cd.params.filename ?? ct.params.name;
  const isAttachment = cd.value === "attachment" || !!filename || (!ct.value.startsWith("text/") && ct.value !== "message/rfc822");
  if (isAttachment) {
    out.attachments.push({ name: decodeWords(filename ?? `attachment-${out.attachments.length + 1}`), contentType: ct.value || "application/octet-stream", data });
    return;
  }
  if (ct.value === "text/html") {
    if (!out.html) out.html = decodeCharset(data, ct.params.charset);
  } else if (ct.value === "text/plain" || !ct.value) {
    if (!out.text) out.text = decodeCharset(data, ct.params.charset);
  }
}

export interface FormData {
  fields: Record<string, string>;
  files: Array<InboundAttachment & { field: string }>;
}

/** multipart/form-data or application/x-www-form-urlencoded → fields + files. */
export function parseForm(contentType: string | undefined, raw: Buffer): FormData {
  const ct = parseParams(contentType);
  const out: FormData = { fields: {}, files: [] };
  if (ct.value === "multipart/form-data" && ct.params.boundary) {
    for (const part of splitMultipart(raw, ct.params.boundary)) {
      const { head, body } = splitHead(part);
      const h = parseHeaderBlock(head);
      const cd = parseParams(h["content-disposition"]);
      const name = cd.params.name ?? "";
      if (!name) continue;
      if (cd.params.filename !== undefined) {
        out.files.push({ field: name, name: cd.params.filename || name, contentType: parseParams(h["content-type"]).value || "application/octet-stream", data: decodeBody(body, h["content-transfer-encoding"]) });
      } else {
        out.fields[name] = decodeCharset(body, parseParams(h["content-type"]).params.charset);
      }
    }
    return out;
  }
  for (const [k, v] of new URLSearchParams(raw.toString("utf8"))) out.fields[k] = v;
  return out;
}

/* ───────────────────────────── addresses and authenticity ───────────────────────────── */

/** `"Ada" <Ada@Example.com>` → `ada@example.com`. */
export function bareAddress(s: string | undefined): string {
  const v = decodeWords(String(s ?? ""));
  const m = v.match(/<([^<>\s]+@[^<>\s]+)>/) ?? v.match(/([^\s<>"',;:]+@[^\s<>"',;:]+)/);
  return (m ? m[1] : "").trim().toLowerCase();
}

/** Pull spf/dkim/dmarc results out of an Authentication-Results header. */
export function authResults(header: string | undefined): InboundEmail["auth"] {
  const h = String(header ?? "").toLowerCase();
  const pick = (k: string) => h.match(new RegExp(`\\b${k}=(\\w+)`))?.[1];
  const out: InboundEmail["auth"] = {};
  const spf = pick("spf");
  const dkim = pick("dkim");
  const dmarc = pick("dmarc");
  if (spf) out.spf = spf;
  if (dkim) out.dkim = dkim;
  if (dmarc) out.dmarc = dmarc;
  return out;
}

/**
 * Reject mail the receiving provider itself flagged as forged: DMARC fail, or SPF (soft)fail with no
 * passing DKIM. Unknown verdicts pass — the sender allowlist still applies.
 */
export function authVerdict(auth: InboundEmail["auth"]): { ok: true } | { ok: false; reason: string } {
  const a = (s?: string) => (s ?? "").toLowerCase();
  if (a(auth.dmarc) === "fail") return { ok: false, reason: "DMARC failed for the sender's domain" };
  if ((a(auth.spf) === "fail" || a(auth.spf) === "softfail") && a(auth.dkim) !== "pass") return { ok: false, reason: `SPF ${a(auth.spf)} and no passing DKIM` };
  return { ok: true };
}

export function senderAllowed(from: string, allow: string[]): boolean {
  const f = from.trim().toLowerCase();
  if (!f) return false;
  return allow.some((a) => {
    const x = a.trim().toLowerCase();
    if (!x) return false;
    // "@example.com" allows a whole domain the owner explicitly typed.
    return x.startsWith("@") ? f.endsWith(x) : f === x;
  });
}

/** Mailgun: hex HMAC-SHA256(signing key, timestamp + token), timestamp within `windowSec`. */
export function verifyMailgun(key: string, f: { timestamp?: string; token?: string; signature?: string }, nowSec = Math.floor(Date.now() / 1000), windowSec = 900): { ok: true } | { ok: false; reason: string } {
  if (!f.timestamp || !f.token || !f.signature) return { ok: false, reason: "missing Mailgun signature fields" };
  const ts = Number(f.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > windowSec) return { ok: false, reason: "Mailgun timestamp outside the window" };
  const want = crypto.createHmac("sha256", key).update(f.timestamp + f.token).digest("hex");
  return safeEqual(want, f.signature.trim().toLowerCase()) ? { ok: true } : { ok: false, reason: "bad Mailgun signature" };
}

/* ───────────────────────────── provider → InboundEmail ───────────────────────────── */

export type ParseResult = { ok: true; email: InboundEmail; mailgun?: { timestamp?: string; token?: string; signature?: string } } | { ok: false; reason: string };

export function parseInboundEmail(provider: EmailProvider, contentType: string | undefined, raw: Buffer): ParseResult {
  try {
    if (provider === "postmark") return parsePostmark(raw);
    if (provider === "cloudflare") return fromMime(parseMime(raw));
    const form = parseForm(contentType, raw);
    if (provider === "sendgrid") return parseSendgrid(form);
    return parseMailgun(form);
  } catch (e) {
    return { ok: false, reason: `could not parse the email: ${(e as Error).message.slice(0, 120)}` };
  }
}

function fromMime(m: ParsedMime, extra: Partial<InboundEmail> = {}): ParseResult {
  const from = bareAddress(m.headers["from"]);
  if (!from) return { ok: false, reason: "no From address" };
  const auth = authResults(m.headers["authentication-results"] ?? m.headers["arc-authentication-results"]);
  if (!auth.spf) {
    const r = (m.headers["received-spf"] ?? "").trim().split(/\s/)[0]?.toLowerCase();
    if (r) auth.spf = r;
  }
  return {
    ok: true,
    email: {
      from,
      subject: decodeWords(m.headers["subject"] ?? ""),
      text: m.text || htmlToText(m.html),
      ...(m.headers["message-id"] ? { messageId: m.headers["message-id"] } : {}),
      attachments: m.attachments,
      auth,
      ...extra,
    },
  };
}

function parsePostmark(raw: Buffer): ParseResult {
  const p = JSON.parse(raw.toString("utf8")) as Record<string, any>;
  if (!p || typeof p !== "object") return { ok: false, reason: "not a Postmark inbound payload" };
  const from = bareAddress(p.FromFull?.Email ?? p.From);
  if (!from) return { ok: false, reason: "no From address" };
  const headers: Array<{ Name?: string; Value?: string }> = Array.isArray(p.Headers) ? p.Headers : [];
  const hv = (n: string) => headers.find((h) => String(h.Name ?? "").toLowerCase() === n)?.Value;
  const auth = authResults(hv("authentication-results"));
  if (!auth.spf) {
    const r = String(hv("received-spf") ?? "").trim().split(/\s/)[0]?.toLowerCase();
    if (r) auth.spf = r;
  }
  const attachments: InboundAttachment[] = (Array.isArray(p.Attachments) ? p.Attachments : []).map((a: Record<string, any>) => ({
    name: String(a.Name ?? "attachment"),
    contentType: String(a.ContentType ?? "application/octet-stream").toLowerCase(),
    data: Buffer.from(String(a.Content ?? ""), "base64"),
  }));
  return {
    ok: true,
    email: {
      from,
      subject: String(p.Subject ?? ""),
      text: String(p.TextBody ?? "") || htmlToText(String(p.HtmlBody ?? "")),
      ...(typeof p.StrippedTextReply === "string" && p.StrippedTextReply.trim() ? { stripped: p.StrippedTextReply } : {}),
      ...(p.MessageID ? { messageId: String(p.MessageID) } : {}),
      attachments,
      auth,
    },
  };
}

function parseSendgrid(form: FormData): ParseResult {
  const f = form.fields;
  // "POST the raw, full MIME message" mode.
  if (f.email) {
    const r = fromMime(parseMime(Buffer.from(f.email, "utf8")));
    if (r.ok) Object.assign(r.email.auth, sendgridAuth(f));
    return r;
  }
  const from = bareAddress(f.from);
  if (!from) return { ok: false, reason: "no From address" };
  const headers = parseHeaderBlock(f.headers ?? "");
  const auth = { ...authResults(headers["authentication-results"]), ...sendgridAuth(f) };
  let info: Record<string, { filename?: string; name?: string; type?: string }> = {};
  try {
    info = f["attachment-info"] ? JSON.parse(f["attachment-info"]) : {};
  } catch {
    /* names fall back to the part's own */
  }
  const attachments = form.files.map((x) => ({ name: info[x.field]?.filename ?? x.name, contentType: (info[x.field]?.type ?? x.contentType).toLowerCase(), data: x.data }));
  return {
    ok: true,
    email: {
      from,
      subject: f.subject ?? "",
      text: f.text || htmlToText(f.html ?? ""),
      ...(headers["message-id"] ? { messageId: headers["message-id"] } : {}),
      attachments,
      auth,
    },
  };
}

function sendgridAuth(f: Record<string, string>): InboundEmail["auth"] {
  const out: InboundEmail["auth"] = {};
  if (f.SPF) out.spf = f.SPF.trim().toLowerCase();
  // dkim: "{@example.com : pass}" — any pass counts.
  if (f.dkim) out.dkim = /:\s*pass/i.test(f.dkim) ? "pass" : /:\s*fail/i.test(f.dkim) ? "fail" : "none";
  return out;
}

function parseMailgun(form: FormData): ParseResult {
  const f = form.fields;
  const from = bareAddress(f.from ?? f.sender);
  if (!from) return { ok: false, reason: "no From address" };
  const auth: InboundEmail["auth"] = {};
  try {
    const mh = JSON.parse(f["message-headers"] ?? "[]") as Array<[string, string]>;
    const get = (n: string) => mh.find((x) => String(x[0]).toLowerCase() === n)?.[1];
    Object.assign(auth, authResults(get("authentication-results")));
    const spf = get("x-mailgun-spf");
    const dkim = get("x-mailgun-dkim-check-result");
    if (spf) auth.spf = spf.toLowerCase();
    if (dkim) auth.dkim = dkim.toLowerCase();
  } catch {
    /* headers are optional */
  }
  return {
    ok: true,
    email: {
      from,
      subject: f.subject ?? "",
      text: f["body-plain"] || htmlToText(f["body-html"] ?? ""),
      ...(f["stripped-text"]?.trim() ? { stripped: f["stripped-text"] } : {}),
      ...(f["Message-Id"] ? { messageId: f["Message-Id"] } : {}),
      attachments: form.files.map((x) => ({ name: x.name, contentType: x.contentType.toLowerCase(), data: x.data })),
      auth,
    },
    mailgun: { timestamp: f.timestamp, token: f.token, signature: f.signature },
  };
}

/* ───────────────────────────── text cleanup ───────────────────────────── */

export function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const REPLY_CUT = [
  /^On .{0,200}wrote:\s*$/i, // Gmail / Apple Mail
  /^-{2,}\s*Original Message\s*-{2,}/i, // Outlook
  /^-{2,}\s*Forwarded message\s*-{2,}/i,
  /^_{8,}\s*$/, // Outlook web separator
  /^From:\s.+\s*$/, // Outlook header block (only when followed by Sent:/Date:, see below)
  /^Le .{0,200}a écrit\s*:\s*$/i,
  /^Am .{0,200}schrieb .{0,200}:\s*$/i,
];
const SIGNATURE_CUT = [/^--\s?$/, /^Sent from my \w+/i, /^Get Outlook for /i, /^Sent from (Mail|Outlook|Yahoo)/i];

/** Drop quoted replies (`>` lines and everything after an "On … wrote:"), and the signature. */
export function stripReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    // Gmail wraps a long "On … wrote:" over two lines.
    const two = i + 1 < lines.length ? `${t} ${lines[i + 1].trim()}` : t;
    if (/^From:\s/.test(t)) {
      const after = lines.slice(i + 1, i + 5).join("\n");
      if (/^(Sent|Date|To|Subject):\s/m.test(after)) break;
    } else if (REPLY_CUT.some((r) => r.test(t)) || (/^On\s/i.test(t) && /wrote:\s*$/i.test(two))) break;
    if (SIGNATURE_CUT.some((r) => r.test(l))) break;
    if (t.startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** `Re: Fwd: FW: the thing` → `the thing`. */
export function cleanSubject(s: string): string {
  let v = s.trim();
  for (let i = 0; i < 5; i++) {
    const n = v.replace(/^(re|fwd?|fw|aw|wg|tr)\s*(\[\d+\])?\s*:\s*/i, "");
    if (n === v) break;
    v = n;
  }
  return v;
}

export interface IntakeAttachments {
  /** Images, as the delegate flow takes them (base64 data URLs; path under /workspace). */
  images: Array<{ path: string; base64: string }>;
  /** Everything not carried into the box: name + size. */
  listed: string[];
}

export function splitAttachments(atts: InboundAttachment[], stamp: string): IntakeAttachments {
  const images: IntakeAttachments["images"] = [];
  const listed: string[] = [];
  for (const a of atts) {
    const safe = a.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "file";
    const kb = Math.max(1, Math.round(a.data.length / 1024));
    if (/^image\/(png|jpe?g|gif|webp)$/.test(a.contentType) && a.data.length <= MAX_IMAGE_BYTES && images.length < MAX_IMAGES) {
      images.push({ path: `.attachments/${stamp}-${images.length + 1}-${safe}`, base64: `data:${a.contentType};base64,${a.data.toString("base64")}` });
    } else {
      listed.push(`${a.name} (${a.contentType}, ${kb} KB)`);
    }
  }
  return { images, listed };
}

/** Subject + stripped body (+ attachment notes) → the task text. */
export function emailTask(e: InboundEmail, atts: IntakeAttachments): string {
  const subject = cleanSubject(e.subject);
  const body = stripReply(e.stripped ?? e.text);
  const parts = [subject, body].filter((s) => s.trim());
  let task = parts.join("\n\n");
  if (atts.images.length) task += `\n\nAttached ${atts.images.length === 1 ? "image" : "images"} (open with the Read tool):\n${atts.images.map((a) => `- /workspace/${a.path}`).join("\n")}`;
  if (atts.listed.length) task += `\n\nAlso attached to the email (not copied into the machine):\n${atts.listed.map((s) => `- ${s}`).join("\n")}`;
  return task.slice(0, MAX_TASK_CHARS).trim();
}

/* ───────────────────────────── Slack ───────────────────────────── */

export const SLACK_WINDOW_SEC = 300;
export const SLACK_SHORTCUT_ID = "send_to_agent_sandbox";

export function verifySlack(secret: string | undefined, headers: H, raw: Buffer, nowSec = Math.floor(Date.now() / 1000)): { ok: true } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: "no Slack signing secret set" };
  const ts = hget(headers, "x-slack-request-timestamp") ?? "";
  const sig = hget(headers, "x-slack-signature") ?? "";
  if (!ts || !sig) return { ok: false, reason: "missing X-Slack-Signature" };
  const n = Number(ts);
  if (!/^\d+$/.test(ts) || Math.abs(nowSec - n) > SLACK_WINDOW_SEC) return { ok: false, reason: "Slack timestamp outside the 5-minute window" };
  const want = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:`).update(raw).digest("hex");
  return safeEqual(want, sig.trim()) ? { ok: true } : { ok: false, reason: "bad Slack signature" };
}

export type SlackRequest =
  | { kind: "command"; userId: string; teamId: string; text: string; responseUrl: string; channelId?: string }
  | { kind: "shortcut"; userId: string; teamId: string; text: string; responseUrl: string; channelId?: string; threadTs?: string; messageTs?: string; permalink?: string }
  | { kind: "choice"; userId: string; teamId: string; pendingId: string; repo: string; responseUrl: string }
  | { kind: "other"; type: string };

export function parseSlack(raw: Buffer): SlackRequest {
  const f = new URLSearchParams(raw.toString("utf8"));
  const payload = f.get("payload");
  if (!payload) {
    return { kind: "command", userId: f.get("user_id") ?? "", teamId: f.get("team_id") ?? "", text: f.get("text") ?? "", responseUrl: f.get("response_url") ?? "", ...(f.get("channel_id") ? { channelId: f.get("channel_id")! } : {}) };
  }
  let p: Record<string, any>;
  try {
    p = JSON.parse(payload);
  } catch {
    return { kind: "other", type: "bad-json" };
  }
  const userId = String(p.user?.id ?? "");
  const teamId = String(p.team?.id ?? p.user?.team_id ?? "");
  if (p.type === "message_action") {
    const m = p.message ?? {};
    return {
      kind: "shortcut",
      userId,
      teamId,
      text: String(m.text ?? ""),
      responseUrl: String(p.response_url ?? ""),
      ...(p.channel?.id ? { channelId: String(p.channel.id) } : {}),
      ...(m.thread_ts ? { threadTs: String(m.thread_ts) } : {}),
      ...(m.ts ? { messageTs: String(m.ts) } : {}),
    };
  }
  if (p.type === "block_actions") {
    const a = (Array.isArray(p.actions) ? p.actions[0] : undefined) ?? {};
    const v = String(a.value ?? "");
    const k = v.indexOf("|");
    if (String(a.action_id ?? "").startsWith("asb_repo") && k > 0) return { kind: "choice", userId, teamId, pendingId: v.slice(0, k), repo: v.slice(k + 1), responseUrl: String(p.response_url ?? "") };
  }
  return { kind: "other", type: String(p.type ?? "") };
}

/** Only ever POST back to Slack's own response URLs (the URL arrives in the request body). */
export function isSlackResponseUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && x.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}

/** A thread (conversations.replies) → task text, oldest first. */
export function threadTask(messages: Array<{ text?: string; user?: string; bot_id?: string }>, max = MAX_TASK_CHARS): string {
  const lines = messages.map((m) => (m.text ?? "").trim()).filter(Boolean);
  return lines.join("\n\n---\n\n").slice(0, max);
}

/** Slack's markup → plain: <@U1|ada> → @ada, <https://x|label> → label (https://x), &amp; → &. */
export function slackText(s: string): string {
  return s
    .replace(/<@([A-Z0-9]+)\|([^>]+)>/g, "@$2")
    .replace(/<@([A-Z0-9]+)>/g, "@$1")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/* ───────────────────────────── repo resolution ───────────────────────────── */

export const MAX_REPO_CHOICES = 4;
export type RepoPick = { kind: "repo"; repo: string; how: "named" | "default" | "only" } | { kind: "ask"; choices: string[] } | { kind: "none" };

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function resolveIntakeRepo(text: string, known: RepoInfo[], defaultRepo?: string): RepoPick {
  const named = inferRepos(text, known).map((r) => r.fullName);
  // A bare name several owners share: inferRepos skips it; intake asks instead of guessing.
  const lower = text.toLowerCase();
  const byName = new Map<string, string[]>();
  for (const r of known) {
    const n = r.fullName.slice(r.fullName.indexOf("/") + 1).toLowerCase();
    byName.set(n, [...(byName.get(n) ?? []), r.fullName]);
  }
  const shared: string[] = [];
  for (const [n, rs] of byName) if (rs.length > 1 && n.length >= 4 && new RegExp(`(^|[^\\w.-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`).test(lower)) shared.push(...rs);
  // An explicit owner/name wins over the bare-name ambiguity it resolves.
  const explicit = new Set(named.map((x) => x.split("/")[1].toLowerCase()));
  const all = [...new Set([...named, ...shared.filter((s) => !explicit.has(s.split("/")[1].toLowerCase()))])];
  if (all.length === 1) return { kind: "repo", repo: all[0], how: "named" };
  if (all.length > 1) return { kind: "ask", choices: all.slice(0, MAX_REPO_CHOICES) };
  if (defaultRepo && REPO_RE.test(defaultRepo)) return { kind: "repo", repo: defaultRepo, how: "default" };
  if (known.length === 1) return { kind: "repo", repo: known[0].fullName, how: "only" };
  if (known.length > 1) return { kind: "ask", choices: known.slice(0, MAX_REPO_CHOICES).map((r) => r.fullName) };
  return { kind: "none" };
}

/* ───────────────────────────── pasted links (composer) ───────────────────────────── */

export type IssueLink = { kind: "github"; repo: string; number: number; url: string } | { kind: "sentry"; org: string; issueId: string; url: string };

export function parseIssueUrl(s: string): IssueLink | undefined {
  const v = s.trim();
  if (!v || /\s/.test(v) || v.length > 500) return undefined;
  const gh = v.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)(?:[/?#].*)?$/i);
  if (gh) return { kind: "github", repo: gh[1], number: Number(gh[2]), url: v };
  const s1 = v.match(/^https?:\/\/([\w-]+)\.sentry\.io\/issues\/(\d+)(?:[/?#].*)?$/i);
  if (s1) return { kind: "sentry", org: s1[1].toLowerCase(), issueId: s1[2], url: v };
  const s2 = v.match(/^https?:\/\/(?:www\.)?sentry\.io\/organizations\/([\w-]+)\/issues\/(\d+)(?:[/?#].*)?$/i);
  if (s2) return { kind: "sentry", org: s2[1].toLowerCase(), issueId: s2[2], url: v };
  return undefined;
}

export function unfurlTask(link: IssueLink, f: { title: string; body?: string; extra?: string }): string {
  const what = link.kind === "github" ? `${link.repo}#${link.number}` : `Sentry issue ${link.issueId}`;
  const body = (f.body ?? "").replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim().slice(0, 6000);
  return [`${f.title}`, `(${what}: ${link.url})`, f.extra ?? "", body].filter((x) => x.trim()).join("\n\n").slice(0, MAX_TASK_CHARS);
}
