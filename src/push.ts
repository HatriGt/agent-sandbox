/**
 * Mobile push (docs/plan-agent-cloud.md increment 7): the phone channel for the walk-away edges
 * notify.ts already detects (waiting / done / failed / stalled).
 *
 * Delivery goes through the Expo push service (exp.host), so the controller needs no FCM/APNs keys;
 * EXPO_ACCESS_TOKEN is honoured when the Expo project has "enhanced push security" on.
 *
 * Privacy / safety rules (each one a deliberate design choice):
 *  - LOCK SCREEN: the payload carries only the run's short title (redacted, ≤ 60 chars) and a
 *    fixed phrase for the event. Never the question text, the task body, a diff, or a token —
 *    a locked phone on a desk is a public display. The app fetches the detail after the tap, over
 *    the authenticated API.
 *  - TOKENS are sealed at rest (SecretBox) and looked up by SHA-256, never returned by any route.
 *    A token lets anyone who holds it push to that device, so it is treated like a secret.
 *  - A token belongs to ONE owner: registering a token that another owner held moves it (a device
 *    that switched accounts must stop receiving the previous account's runs).
 *  - STORMS: the notifier already dedupes (box, kind, question) for 5 min; on top of that each
 *    owner gets at most PUSH_PER_MIN pushes per minute and one per (box, kind) is collapsed via
 *    the Android tag / iOS thread id so a burst replaces rather than stacks.
 *  - DeviceNotRegistered tickets delete the token immediately.
 */
import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import type { SecretBox } from "./secretbox.js";
import type { NotifyEvent } from "./notify.js";

export const MAX_DEVICES_PER_OWNER = 20;
export const PUSH_PER_MIN = 12;
const TITLE_MAX = 60;

/** Expo push tokens: `ExponentPushToken[…]` (legacy name) or `ExpoPushToken[…]`. */
export function isExpoPushToken(t: unknown): t is string {
  return typeof t === "string" && t.length <= 200 && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/.test(t);
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export type RegisterResult = { ok: true; id: string } | { ok: false; error: string };

export function registerDevice(db: Db, box: SecretBox, owner: string, token: unknown, platform: unknown, now = Date.now()): RegisterResult {
  if (!isExpoPushToken(token)) return { ok: false, error: "not an Expo push token" };
  const h = hashToken(token);
  const plat = platform === "ios" || platform === "android" ? platform : null;
  const existing = db.prepare(`SELECT owner FROM push_devices WHERE token_hash = ?`).get(h) as { owner: string } | undefined;
  if (!existing || existing.owner !== owner) {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM push_devices WHERE owner = ?`).get(owner) as { n: number }).n;
    if (n >= MAX_DEVICES_PER_OWNER) {
      // Evict the stalest device rather than refuse: the newest phone is the one in the hand.
      db.prepare(`DELETE FROM push_devices WHERE token_hash = (SELECT token_hash FROM push_devices WHERE owner = ? ORDER BY last_seen_at ASC LIMIT 1)`).run(owner);
    }
  }
  // Upsert: a token another owner held moves to this owner (the device switched accounts).
  db.prepare(
    `INSERT INTO push_devices (token_hash, owner, token_enc, platform, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token_hash) DO UPDATE SET owner = excluded.owner, token_enc = excluded.token_enc, platform = excluded.platform, last_seen_at = excluded.last_seen_at`
  ).run(h, owner, box.seal(token), plat, now, now);
  return { ok: true, id: h.slice(0, 12) };
}

/** Remove the caller's own registration. A token held by someone else is left alone (and reported as not found). */
export function unregisterDevice(db: Db, owner: string, token: unknown): boolean {
  if (typeof token !== "string") return false;
  return db.prepare(`DELETE FROM push_devices WHERE token_hash = ? AND owner = ?`).run(hashToken(token), owner).changes > 0;
}

export function listDeviceTokens(db: Db, box: SecretBox, owner: string): string[] {
  const rows = db.prepare(`SELECT token_enc FROM push_devices WHERE owner = ?`).all(owner) as { token_enc: string }[];
  const out: string[] = [];
  for (const r of rows) {
    try {
      out.push(box.open(r.token_enc));
    } catch {
      /* key rotated: the row is dead weight until the device re-registers */
    }
  }
  return out;
}

export function deviceCount(db: Db, owner: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM push_devices WHERE owner = ?`).get(owner) as { n: number }).n;
}

export function pruneToken(db: Db, token: string): void {
  db.prepare(`DELETE FROM push_devices WHERE token_hash = ?`).run(hashToken(token));
}

/* ───────────────────────────── payload ───────────────────────────── */

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: { box: string; kind: NotifyEvent["kind"]; url: string; nonce?: string; choices?: number };
  /** Registered in the app (mobile/src/lib/push.ts): `ask-choices-2` / `ask-choices-3` action buttons. */
  categoryId?: string;
  sound: "default";
  priority: "high" | "default";
  channelId: string;
  /** iOS groups by thread id; Android replaces a notification with the same tag. */
  threadId: string;
  tag: string;
  ttl: number;
}

const PHRASE: Record<NotifyEvent["kind"], string> = {
  waiting: "Needs an answer",
  done: "Finished",
  failed: "Failed",
  stalled: "Looks stalled",
};

/** Titles pass through the caller's redactor first; this trims to one short line. */
export function shortTitle(label: string | undefined, box: string): string {
  const one = (label ?? "").split("\n")[0].replace(/\s+/g, " ").trim();
  if (!one) return box;
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1).trimEnd()}…` : one;
}

/** Choice buttons for a waiting push (src/answer-choice.ts): redacted short labels + one-use nonce. */
export interface PushChoices {
  labels: readonly string[];
  nonce: string;
}

/** Category ids the app registers; the count picks how many action buttons the OS shows. */
export const choiceCategory = (n: number) => `ask-choices-${n}`;

/**
 * One Expo message per device. Deliberately content-free beyond the title: the body is a fixed
 * phrase, never the question — see the module comment on lock screens. A question with choices adds
 * the choice LABELS only (numbered to match the "1 / 2 / 3" action buttons, whose titles are fixed
 * per category on iOS) and the nonce in the data payload, which is never displayed.
 */
export function buildPushMessages(e: NotifyEvent, tokens: readonly string[], title: string, choices?: PushChoices): ExpoMessage[] {
  const needsYou = e.kind === "waiting";
  const labels = needsYou && choices ? choices.labels.slice(0, 3).map((l) => l.replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean) : [];
  const withChoices = labels.length >= 2 && !!choices;
  const body = withChoices
    ? `${PHRASE[e.kind]} · ${labels.map((l, i) => `${i + 1} ${l}`).join(" · ")}`
    : e.kind === "failed" && e.note
      ? `Failed — ${e.note}`
      : PHRASE[e.kind];
  return tokens.map((to) => ({
    to,
    title: shortTitle(title, e.box),
    body,
    data: {
      box: e.box,
      kind: e.kind,
      url: `asb://box/${encodeURIComponent(e.box)}`,
      ...(withChoices ? { nonce: choices!.nonce, choices: labels.length } : {}),
    },
    ...(withChoices ? { categoryId: choiceCategory(labels.length) } : {}),
    sound: "default",
    priority: needsYou ? "high" : "default",
    channelId: needsYou ? "needs-you" : "runs",
    threadId: e.box,
    tag: `${e.box}:${needsYou ? "ask" : "run"}`,
    // A question that is hours old is still actionable; a "done" a day later is not news.
    ttl: needsYou ? 24 * 3600 : 6 * 3600,
  }));
}

/* ───────────────────────────── send ───────────────────────────── */

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type Ticket = { status: "ok"; id?: string } | { status: "error"; message?: string; details?: { error?: string } };

/**
 * POST the messages (Expo accepts ≤ 100 per request), then prune every token whose ticket says
 * DeviceNotRegistered. Returns the count accepted. Throws only when the whole request failed, so the
 * notifier does not mark a never-sent event delivered.
 */
export async function sendExpoPush(
  messages: readonly ExpoMessage[],
  opts: { fetch: typeof fetch; prune: (token: string) => void; accessToken?: string; log?: (m: string) => void; timeoutMs?: number }
): Promise<number> {
  let accepted = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 8000);
    let tickets: Ticket[];
    try {
      const r = await opts.fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error(`expo push HTTP ${r.status}`);
      const j = (await r.json()) as { data?: Ticket[] };
      tickets = Array.isArray(j.data) ? j.data : [];
    } finally {
      clearTimeout(t);
    }
    tickets.forEach((tk, k) => {
      if (tk.status === "ok") accepted++;
      else if (tk.details?.error === "DeviceNotRegistered") opts.prune(batch[k].to);
      // Never log the token or message: the error class is enough to debug.
      else opts.log?.(`[push] ticket error: ${tk.details?.error ?? "unknown"}`);
    });
  }
  return accepted;
}

/** Per-owner sliding-window cap: the second line of defence against a storm of finishing runs. */
export function makeOwnerRateCap(limit = PUSH_PER_MIN, windowMs = 60_000, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    allow(owner: string): boolean {
      const t = now();
      const recent = (hits.get(owner) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= limit) {
        hits.set(owner, recent);
        return false;
      }
      recent.push(t);
      hits.set(owner, recent);
      return true;
    },
  };
}
