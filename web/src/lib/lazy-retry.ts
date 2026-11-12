/**
 * A tab that was open across a deploy still holds the old page, and the old page names chunk files
 * that no longer exist (every build renames them). Opening a page that had not been loaded yet then
 * failed with "Failed to fetch dynamically imported module" and the error screen. The only fix for
 * a page built against files that are gone is the new page, so a failed chunk load reloads once.
 * "Once" is kept in sessionStorage: if the reload does not help (offline, a real outage) the error
 * shows as before instead of looping.
 */
const KEY = "asb-chunk-reload";
/** A second failure this soon after a reload means the reload did not fix it. */
export const RELOAD_GUARD_MS = 30_000;

/** Is this the browser saying a code-split file could not be loaded? Every engine words it differently. */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /dynamically imported module|Importing a module script failed|Failed to load module script|Unable to preload CSS|ChunkLoadError/i.test(msg);
}

/** Reload only if the last reload for this reason was not just now. Pure. */
export function shouldReload(lastAt: number | null, nowMs: number): boolean {
  return lastAt === null || !Number.isFinite(lastAt) || nowMs - lastAt > RELOAD_GUARD_MS;
}

/** Reload onto the new build. Returns true when a reload was started. */
export function recoverFromStaleChunk(): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    const now = Date.now();
    if (!shouldReload(raw === null ? null : Number(raw), now)) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    return false; // no storage means no loop guard, so do not risk one
  }
  location.reload();
  return true;
}

/**
 * Wrap a dynamic import for React.lazy: a chunk that is gone reloads the page and never settles
 * (so no error screen flashes before the reload); any other failure is thrown as before.
 */
export function lazyRetry<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((e: unknown) => {
      if (isChunkLoadError(e) && recoverFromStaleChunk()) return new Promise<T>(() => {});
      throw e;
    });
}
