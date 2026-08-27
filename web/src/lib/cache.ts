import * as React from "react";

/**
 * Stale-while-revalidate for the small config-ish payloads (accounts, MCP servers, repos): paint the
 * last known value instantly — from memory, then sessionStorage — and refresh in the background.
 * Every round trip to the controller costs ~200–600 ms from a laptop (TLS + RTT + an SSH hop on the
 * VPS), so a page must never wait on one to show what it showed a second ago.
 */
const mem = new Map<string, { v: unknown; at: number }>();
const PREFIX = "asb-cache:";

export function readCache<T>(key: string): { v: T; at: number } | null {
  const m = mem.get(key);
  if (m) return m as { v: T; at: number };
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: T; at: number };
    mem.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, v: T) {
  const entry = { v, at: Date.now() };
  mem.set(key, entry);
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota — memory copy still works */
  }
  for (const fn of listeners.get(key) ?? []) fn();
}

const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<unknown>>();

/** Fetch into the cache unless a copy newer than `maxAgeMs` is already there. Safe to call from hover handlers. */
export function prefetch<T>(key: string, fn: (signal?: AbortSignal) => Promise<T>, maxAgeMs = 15_000): Promise<T> {
  const have = readCache<T>(key);
  if (have && Date.now() - have.at < maxAgeMs) return Promise.resolve(have.v);
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn()
    .then((v) => {
      writeCache(key, v);
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Cached value now + background refresh on mount; `setData` for optimistic updates after a mutation. */
export function useCached<T>(key: string, fn: (signal: AbortSignal) => Promise<T>) {
  const [entry, setEntry] = React.useState(() => readCache<T>(key));
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const fnRef = React.useRef(fn);
  fnRef.current = fn;

  const refresh = React.useCallback(async () => {
    const controller = new AbortController();
    setLoading(true);
    try {
      const v = await fnRef.current(controller.signal);
      writeCache(key, v);
      setError(null);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [key]);

  React.useEffect(() => {
    const on = () => setEntry(readCache<T>(key));
    const set = listeners.get(key) ?? new Set();
    set.add(on);
    listeners.set(key, set);
    on();
    void refresh();
    return () => {
      set.delete(on);
    };
  }, [key, refresh]);

  const setData = React.useCallback(
    (next: T | ((prev: T | null) => T)) => {
      const prev = readCache<T>(key)?.v ?? null;
      writeCache(key, typeof next === "function" ? (next as (p: T | null) => T)(prev) : next);
    },
    [key]
  );

  return { data: entry?.v ?? null, at: entry?.at ?? null, error, loading, refresh, setData };
}
