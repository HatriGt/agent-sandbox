// Unsent text survives an app restart or a detour to another thread (web/src/lib/draft.ts, with
// AsyncStorage standing in for sessionStorage — a phone app is backgrounded and killed far more
// often than a tab is closed, so "session-scoped" would lose almost every draft).
//
// Keys: "new" for the New-task composer, `box:<name>` for a thread's follow-up composer.
// Saves are debounced per key so a fast typist does not hammer the storage bridge; `flushDraft`
// writes immediately (call before navigating away). A prefill is a one-shot, in-memory handoff
// ("new task from this run") consumed by whichever composer mounts next.
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "asb-draft:";
const SAVE_DEBOUNCE_MS = 400;

export const DRAFT_NEW = "new";
export const draftKeyForBox = (name: string) => `box:${name}`;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingText = new Map<string, string>();

async function write(key: string, text: string) {
  try {
    if (text.trim()) await AsyncStorage.setItem(PREFIX + key, text);
    else await AsyncStorage.removeItem(PREFIX + key);
  } catch {
    /* storage full or unavailable: drafts are a convenience, never an error */
  }
}

export async function loadDraft(key: string): Promise<string> {
  // A save still waiting on its debounce is newer than anything on disk.
  const queued = pendingText.get(key);
  if (queued !== undefined) return queued;
  try {
    return (await AsyncStorage.getItem(PREFIX + key)) ?? "";
  } catch {
    return "";
  }
}

/** Debounced (400 ms). Empty text removes the draft. */
export function saveDraft(key: string, text: string) {
  pendingText.set(key, text);
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const t = pendingText.get(key);
      pendingText.delete(key);
      if (t !== undefined) void write(key, t);
    }, SAVE_DEBOUNCE_MS),
  );
}

/** Write whatever is queued for `key` right now (before leaving the screen). */
export function flushDraft(key: string) {
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  timers.delete(key);
  const t = pendingText.get(key);
  pendingText.delete(key);
  if (t !== undefined) void write(key, t);
}

/** Drop the draft (after a successful send) — also cancels any save still in flight. */
export function clearDraft(key: string) {
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  timers.delete(key);
  pendingText.delete(key);
  void write(key, "");
}

let prefill: string | null = null;

/** One-shot handoff into the next composer that mounts. In memory only — it never outlives the app. */
export function setPrefill(text: string) {
  prefill = text;
}

export function takePrefill(): string | null {
  const p = prefill;
  prefill = null;
  return p;
}
