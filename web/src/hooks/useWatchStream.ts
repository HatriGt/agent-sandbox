import * as React from "react";
import { api, type WatchSnapshot } from "@/lib/api";

/**
 * Live thread stream over SSE, with a client-side cache so switching machines is instant.
 *
 * The controller fast-tails the box's `.agent.log` and pushes deltas. This hook rebuilds the full
 * log from `snapshot` + `append`/`reset` frames and exposes it as a normal {@link WatchSnapshot}.
 *
 * Why the cache: every thread open used to start from nothing — a blank column for the seconds it
 * took the first SSH-backed frame to arrive. Now the last snapshot of every box this tab has seen
 * lives in a module-level map. Opening a box renders that immediately, and the EventSource is opened
 * with `?from=<offset>` so the server sends only the bytes written since — usually nothing.
 *
 * Reconnects: EventSource replays `Last-Event-ID` (== byte offset). Terminal runs: the server sends
 * `done` and ends the stream; we flip `ok` to false so the slow poll takes over, and when the box
 * comes back to life (a follow-up), the caller bumps `generation` to reopen the stream.
 */
export interface WatchStream {
  snap: WatchSnapshot | null;
  /** True while the SSE connection is healthy. False → caller should fall back to polling. */
  ok: boolean;
  /** True when what is shown came from the cache and no frame has arrived yet this open. */
  fromCache: boolean;
}

interface Meta extends Omit<WatchSnapshot, "log"> {}

const cache = new Map<string, WatchSnapshot>();

/** Seed the cache from a fetched snapshot (a hover prefetch, or a poll result). Never regresses the log. */
export function seedWatchCache(snap: WatchSnapshot): void {
  const prev = cache.get(snap.name);
  if (prev && prev.log.length > snap.log.length && prev.runState === snap.runState) return;
  cache.set(snap.name, snap);
}

export function peekWatchCache(session: string): WatchSnapshot | null {
  return cache.get(session) ?? null;
}

/** Fire-and-forget warm-up for a box the user is about to open (hovering its row). */
const prefetching = new Set<string>();
export function prefetchWatch(session: string): void {
  if (prefetching.has(session)) return;
  const cached = cache.get(session);
  // A cached live box will be re-fetched on open anyway; only prefetch what we have never seen or
  // have not seen for a while.
  if (cached && Date.now() - (cachedAt.get(session) ?? 0) < 15_000) return;
  prefetching.add(session);
  api
    .watch(session)
    .then((s) => {
      seedWatchCache(s);
      cachedAt.set(session, Date.now());
    })
    .catch(() => {})
    .finally(() => prefetching.delete(session));
}
const cachedAt = new Map<string, number>();

export function useWatchStream(session: string, enabled = true, generation = 0): WatchStream {
  const [snap, setSnap] = React.useState<WatchSnapshot | null>(() => (session ? cache.get(session) ?? null : null));
  const [ok, setOk] = React.useState(false);
  const [fromCache, setFromCache] = React.useState(() => !!(session && cache.has(session)));

  React.useEffect(() => {
    if (!enabled || !session) {
      setSnap(null);
      setOk(false);
      setFromCache(false);
      return;
    }

    const cached = cache.get(session) ?? null;
    setSnap(cached);
    setFromCache(!!cached);
    setOk(false);

    let log = cached?.log ?? "";
    let meta: Meta | null = cached ? (({ log: _l, ...m }) => m)(cached) : null;
    let es: EventSource | null = null;
    let closedByUs = false;

    const publish = () => {
      if (!meta) return;
      const next: WatchSnapshot = { ...meta, log };
      cache.set(session, next);
      cachedAt.set(session, Date.now());
      setSnap(next);
      setFromCache(false);
    };

    const onSnapshot = (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { meta: Meta; log: string; from: number };
      meta = d.meta;
      // A resume (from>0) delivers only the missed tail; a fresh open (from=0) replaces.
      log = d.from > 0 ? log.slice(0, d.from) + d.log : d.log;
      publish();
      setOk(true);
    };
    const onAppend = (e: MessageEvent) => {
      log += (JSON.parse(e.data) as { chunk: string }).chunk;
      publish();
    };
    const onReset = (e: MessageEvent) => {
      log = (JSON.parse(e.data) as { chunk: string }).chunk;
      publish();
    };
    const onState = (e: MessageEvent) => {
      meta = (JSON.parse(e.data) as { meta: Meta }).meta;
      publish();
    };
    const onDone = (e: MessageEvent) => {
      meta = (JSON.parse(e.data) as { meta: Meta }).meta;
      publish();
      // The server ends the stream after this. Hand over to the slow poll so a follow-up that wakes
      // the run is still picked up; the caller reopens the stream when the state flips back.
      closedByUs = true;
      es?.close();
      setOk(false);
    };

    try {
      es = new EventSource(api.watchStreamUrl(session, log.length));
    } catch {
      setOk(false);
      return;
    }
    es.addEventListener("snapshot", onSnapshot as EventListener);
    es.addEventListener("append", onAppend as EventListener);
    es.addEventListener("reset", onReset as EventListener);
    es.addEventListener("state", onState as EventListener);
    es.addEventListener("done", onDone as EventListener);
    es.onopen = () => setOk(true);
    es.onerror = () => {
      if (closedByUs) return;
      if (es && es.readyState === EventSource.CLOSED) setOk(false);
    };

    return () => {
      closedByUs = true;
      es?.close();
    };
  }, [session, enabled, generation]);

  return { snap, ok, fromCache };
}
