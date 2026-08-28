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

export interface Prefill {
  task: string;
  /** The source run had repositories attached — open the picker so they can be re-attached. */
  wantsRepo?: boolean;
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
