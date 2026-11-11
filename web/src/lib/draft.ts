/**
 * Unsent text survives a reload or a detour to another thread. Session-scoped: a draft is for now,
 * not for next week. A prefill is a one-shot handoff (e.g. "new task from this run") consumed by the
 * Hub when it mounts.
 */
const PREFIX = "asb-draft:";
const PREFILL = "asb-prefill";

export function readDraft(key: string): string {
  try {
    return sessionStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}
export function writeDraft(key: string, text: string) {
  try {
    if (text.trim()) sessionStorage.setItem(PREFIX + key, text);
    else sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* storage full or blocked: drafts are a convenience */
  }
}

/**
 * What was sent to a thread, newest last, so Up in an empty composer brings a message back to
 * resend or reword (the shell and every chat app's convention). Session-scoped like drafts.
 */
const SENT = "asb-sent:";
const SENT_MAX = 30;
export function readSent(key: string): string[] {
  try {
    const raw = sessionStorage.getItem(SENT + key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function pushSent(key: string, text: string) {
  const t = text.trim();
  if (!t) return;
  try {
    const list = readSent(key).filter((x) => x !== t);
    list.push(t);
    sessionStorage.setItem(SENT + key, JSON.stringify(list.slice(-SENT_MAX)));
  } catch {
    /* storage full or blocked: recall is a convenience */
  }
}

export interface Prefill {
  task: string;
  /** Repositories the source run had, by checkout name (and branch); the Hub resolves them to owner/name. */
  repos?: { name: string; branch?: string }[];
  /** Open the picker anyway (e.g. a repo could not be resolved). */
  wantsRepo?: boolean;
  /** A saved playbook id to preselect in the composer (palette "Run playbook"). */
  workflow?: string;
}
export function setPrefill(p: Prefill) {
  try {
    sessionStorage.setItem(PREFILL, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
export function takePrefill(): Prefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL);
    if (!raw) return null;
    sessionStorage.removeItem(PREFILL);
    return JSON.parse(raw) as Prefill;
  } catch {
    return null;
  }
}
