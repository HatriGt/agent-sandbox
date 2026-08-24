import * as React from "react";
import { api, type WatchSnapshot } from "@/lib/api";

/**
 * Live thread stream over SSE.
 *
 * The controller fast-tails the box's `.agent.log` and pushes deltas, so agent output lands in the
 * browser sub-second instead of on the 3s poll. This hook reconstructs the full log client-side from
 * the `snapshot` + `append`/`reset` frames and exposes it as a normal {@link WatchSnapshot}, so the
 * rest of the thread (trace parse, StreamingMarkdown reveal) is unchanged — it just gets fresher data.
 *
 * Robustness: EventSource auto-reconnects on drop and replays from the last event id (== byte offset)
 * via the standard Last-Event-ID header, so a blip resumes without re-sending the whole log. If SSE
 * never connects (unsupported / proxy strips it), `ok` goes false and the caller falls back to the
 * poll. When a run reaches a terminal state the server ends the stream; we keep the final snapshot.
 */
export interface WatchStream {
  /** The reconstructed live snapshot, or null before the first frame. */
  snap: WatchSnapshot | null;
  /** True while the SSE connection is healthy. False → caller should fall back to polling. */
  ok: boolean;
}

interface Meta extends Omit<WatchSnapshot, "log"> {}

export function useWatchStream(session: string, enabled = true): WatchStream {
  const [snap, setSnap] = React.useState<WatchSnapshot | null>(null);
  const [ok, setOk] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || !session) {
      setSnap(null);
      setOk(false);
      return;
    }

    // Reset per session so switching threads never shows a stale log.
    setSnap(null);
    setOk(false);

    // The running log, rebuilt from frames. The offset is carried by EventSource's Last-Event-ID on
    // reconnect, so we only need `from=0` on the initial URL.
    let log = "";
    let meta: Meta | null = null;
    let es: EventSource | null = null;
    let closedByUs = false;

    const compose = (): WatchSnapshot | null => (meta ? { ...meta, log } : null);

    const onSnapshot = (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { meta: Meta; log: string; from: number };
      meta = d.meta;
      // A reconnect (from>0) delivers only the missed tail; append it. A fresh open (from=0) replaces.
      log = d.from > 0 ? log + d.log : d.log;
      setSnap(compose());
      setOk(true);
    };
    const onAppend = (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { chunk: string };
      log += d.chunk;
      setSnap(compose());
    };
    const onReset = (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { chunk: string };
      log = d.chunk;
      setSnap(compose());
    };
    const onState = (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { meta: Meta };
      meta = d.meta;
      setSnap(compose());
    };
    const onDone = (e: MessageEvent) => {
      const d = JSON.parse(e.data) as { meta: Meta };
      meta = d.meta;
      setSnap(compose());
      // Server will end the stream after this; keep the final snapshot on screen.
      closedByUs = true;
      es?.close();
    };

    try {
      es = new EventSource(api.watchStreamUrl(session));
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
      // EventSource retries on its own; only flip to fallback if it fully closed (not a transient
      // reconnect). A CLOSED readyState after our own done is expected and not a failure.
      if (closedByUs) return;
      if (es && es.readyState === EventSource.CLOSED) setOk(false);
    };

    return () => {
      closedByUs = true;
      es?.close();
    };
  }, [session, enabled]);

  return { snap, ok };
}
