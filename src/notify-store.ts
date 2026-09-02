/**
 * Per-user notification settings: a webhook URL plus per-event toggles, stored exactly like skills
 * and MCP servers — one encrypted user_blobs row per owner (src/user-store.ts), a plain VPS file
 * for the stdio entry is unnecessary because notifications only exist on the HTTP controller.
 *
 * The webhook is generic JSON POST: `{text, url, event}` — enough for Slack incoming webhooks
 * (reads `text`), ntfy (reads the body), Discord (via a thin relay), and home-grown receivers,
 * without per-vendor formatting code.
 */
import { hasUserStoreBackend, loadBlob, saveBlob } from "./user-store.js";
import { isValidWebhookUrl, type NotifyEvent } from "./notify.js";

export interface NotifySettings {
  /** Webhook target; "" means notifications are off for this owner. */
  url: string;
  events: { waiting: boolean; done: boolean; failed: boolean };
}

export const DEFAULT_NOTIFY: NotifySettings = Object.freeze({
  url: "",
  events: Object.freeze({ waiting: true, done: true, failed: true }),
}) as NotifySettings;

/** Parse a stored blob; malformed/missing content yields the defaults (never throws). */
export function parseNotifySettings(raw: string | null | undefined): NotifySettings {
  try {
    const o = JSON.parse(raw || "{}") as Partial<NotifySettings> | null;
    if (!o || typeof o !== "object") return { ...DEFAULT_NOTIFY, events: { ...DEFAULT_NOTIFY.events } };
    const ev = (o.events ?? {}) as Partial<NotifySettings["events"]>;
    return {
      url: typeof o.url === "string" ? o.url : "",
      events: {
        waiting: ev.waiting !== false,
        done: ev.done !== false,
        failed: ev.failed !== false,
      },
    };
  } catch {
    return { ...DEFAULT_NOTIFY, events: { ...DEFAULT_NOTIFY.events } };
  }
}

/** Validate + shape editor input. Throws a human message on a bad URL; empty URL = off, always OK. */
export function normalizeNotifySettings(input: { url?: unknown; events?: unknown }): NotifySettings {
  const url = String(input.url ?? "").trim();
  if (url !== "" && !isValidWebhookUrl(url)) {
    throw new Error(
      /@/.test(url)
        ? "Webhook URL must not carry credentials — they would be stored and sent on every request."
        : "Webhook must be an http(s) URL, e.g. https://hooks.slack.com/services/…"
    );
  }
  const ev = (input.events ?? {}) as Partial<NotifySettings["events"]>;
  return {
    url,
    events: { waiting: ev.waiting !== false, done: ev.done !== false, failed: ev.failed !== false },
  };
}

export function eventEnabled(s: NotifySettings, kind: NotifyEvent["kind"]): boolean {
  return s.url !== "" && s.events[kind];
}

/* ───────────────────────────── IO (user_blobs) ───────────────────────────── */

const BLOB_KIND = "notify";

/** The stored settings for `owner` (a user id or "operator"). Defaults when unset. */
export function loadNotifySettings(owner: string): NotifySettings {
  if (!hasUserStoreBackend()) return { ...DEFAULT_NOTIFY, events: { ...DEFAULT_NOTIFY.events } };
  return parseNotifySettings(loadBlob(BLOB_KIND, owner));
}

export function saveNotifySettings(owner: string, s: NotifySettings): void {
  saveBlob(BLOB_KIND, JSON.stringify(s), owner);
}
