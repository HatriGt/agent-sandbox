import * as React from "react";
import { api, ApiError, openSse, type WatchSnapshot } from "@/lib/api";

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
      setOk(false);
    };

    // fetch-based SSE (the bearer token must travel as a header). Reconnects with backoff on network
    // errors, replaying from the last event id; a clean end (the server's terminal `done`) stops.
    const ctrl = new AbortController();
    let lastId: string | undefined = log.length ? String(log.length) : undefined;
    let attempt = 0;
    let stopped = false;
    const handle = (f: { event: string; data: string; id?: string }) => {
      if (f.id) lastId = f.id;
      const ev = { data: f.data } as MessageEvent;
      if (f.event === "snapshot") onSnapshot(ev);
      else if (f.event === "append") onAppend(ev);
      else if (f.event === "reset") onReset(ev);
      else if (f.event === "state") onState(ev);
      else if (f.event === "done") onDone(ev);
    };
    const loop = async () => {
      while (!stopped && !closedByUs) {
        try {
          await openSse("/watch.sse", { session }, { signal: ctrl.signal, lastEventId: lastId, onFrame: handle, onOpen: () => { attempt = 0; setOk(true); } });
          if (closedByUs || stopped) return;
          // Server ended without `done` (e.g. proxy idle cut): reconnect promptly.
        } catch (e) {
          if (stopped || (e instanceof DOMException && e.name === "AbortError")) return;
          if (e instanceof ApiError && e.status === 401) return; // signed out; the gate takes over
        }
        setOk(false);
        attempt++;
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** Math.min(attempt, 4), 15_000)));
      }
    };
    void loop();

    return () => {
      stopped = true;
      closedByUs = true;
      ctrl.abort();
    };
  }, [session, enabled, generation]);

  return { snap, ok, fromCache };
}
