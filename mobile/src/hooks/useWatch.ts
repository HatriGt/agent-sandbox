import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, type WatchSnapshot } from "@/lib/api";
import { openSse, type SseHandle } from "@/lib/sse";

const DONE_POLL_MS = 3000;

// Last-seen snapshot per box, module-level so it outlives the screen (the web's useWatchStream keeps
// the same cache). Opening a thread paints the cached log instantly instead of a blank "loading"
// state for the seconds the first SSH-backed frame takes; live frames then replace it.
const snapCache = new Map<string, { meta: Omit<WatchSnapshot, "log">; log: string }>();

/**
 * Forget everything cached for a box. A warm-pool box keeps its NAME when claimed for a new run, so
 * a snapshot cached before the claim describes the previous life's log — seeding it would show the
 * old transcript over the new run's. Called by /booting at the pool-free → claimed attach.
 */
export function dropWatchCache(session: string): void {
  snapCache.delete(session);
}

/**
 * Live view of one box: SSE stream of the agent log with byte-offset resume,
 * falling back to a 3s poll after the server closes the stream (`done`).
 * On app suspend the stream is dropped; on resume it reconnects from the
 * stored offset — the protocol is designed for exactly this.
 */
export function useWatch(session: string | undefined) {
  const [meta, setMeta] = useState<Omit<WatchSnapshot, "log"> | null>(null);
  const [log, setLog] = useState("");
  const [connected, setConnected] = useState(false);
  const [gone, setGone] = useState(false);
  const offset = useRef<string | undefined>(undefined);
  const handle = useRef<SseHandle | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useRef(0);
  const stopped = useRef(false);
  const logRef = useRef("");
  // True when the last server snapshot carried NO log (stopped/missing box) and we kept the old text
  // on screen instead. The server's offset is 0 then, so its next `append` is the whole log — it must
  // REPLACE our stale copy, not extend it.
  const stale = useRef(false);

  const setLogBoth = (updater: (prev: string) => string) => {
    logRef.current = updater(logRef.current);
    setLog(logRef.current);
  };

  /**
   * Apply a full snapshot. A sleeping box answers with boxStatus "stopped" and a booting one with
   * "missing" — both carry an EMPTY log because the controller will not exec into them. Replacing the
   * transcript with that blank wiped the thread for the whole sleep→wake→resume window and retired
   * optimistic echoes against an empty log, so the message you just sent vanished until the box was
   * execable again (minutes). Keep what is on screen; the next real log replaces it.
   */
  const applySnapshot = (snap: WatchSnapshot) => {
    const { log: l, ...rest } = snap;
    setMeta(rest);
    if (!l && logRef.current && (rest.boxStatus === "stopped" || rest.boxStatus === "missing")) {
      stale.current = true;
      return;
    }
    stale.current = false;
    setLogBoth(() => l);
  };

  // Set when the box goes terminal/asleep; a later "alive again" poll result
  // reopens the SSE stream (the server closed it at `done`, so a fresh
  // connection is the only way to get live appends after a wake or follow-up).
  const reconnectRef = useRef<() => void>(() => {});

  const startPoll = useCallback(() => {
    if (!session) return;
    const poll = async () => {
      if (stopped.current) return;
      try {
        const snap = await api.watch(session);
        applySnapshot(snap);
        setGone(false);
        // Case-insensitive: watch.json says "running", fleet.json says "Running".
        if (/^running$/i.test(snap.boxStatus ?? "") && (snap.runState === "running" || snap.runState === "waiting")) {
          if (pollTimer.current) clearTimeout(pollTimer.current);
          pollTimer.current = null;
          offset.current = undefined; // resnapshot: the log may have been replaced across the wake
          reconnectRef.current();
          return;
        }
      } catch (e) {
        if ((e as { status?: number }).status === 404) setGone(true);
      }
      pollTimer.current = setTimeout(poll, DONE_POLL_MS);
    };
    void poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const connect = useCallback(() => {
    if (!session || stopped.current) return;
    handle.current?.close();
    // `tail` proves the offset still points where we think inside the server's sliding log window;
    // on mismatch the server sends the full log instead of splicing an unrelated suffix onto ours.
    const from = offset.current && !stale.current ? offset.current : undefined;
    const tail = from && logRef.current ? `&tail=${encodeURIComponent(logRef.current.slice(-256))}` : "";
    handle.current = openSse(
      `/watch.sse?box=${encodeURIComponent(session)}${from ? `&from=${from}${tail}` : ""}`,
      {
        lastEventId: from,
        onFrame: (f) => {
          setConnected(true);
          retry.current = 0;
          if (f.id) offset.current = f.id;
          // Frame payloads mirror src/watch-sse.ts: snapshot={meta,log,from},
          // append/reset={chunk}, state/done={meta,...}. Rendering f.data raw
          // dumped literal {"chunk":"..."} JSON into the transcript.
          switch (f.event) {
            case "snapshot": {
              try {
                const d = JSON.parse(f.data) as { meta: Omit<WatchSnapshot, "log">; log: string; from: number };
                // A resume (from>0) delivers only the missed tail; a fresh open replaces.
                if (d.from > 0) {
                  setMeta(d.meta);
                  stale.current = false;
                  setLogBoth((prev) => prev.slice(0, d.from) + (d.log ?? ""));
                } else {
                  applySnapshot({ ...d.meta, log: d.log ?? "" });
                }
              } catch {
                /* malformed snapshot — wait for the next frame */
              }
              break;
            }
            case "append": {
              try {
                const { chunk } = JSON.parse(f.data) as { chunk: string };
                const replace = stale.current;
                stale.current = false;
                setLogBoth((prev) => (replace ? chunk : prev + chunk));
              } catch {
                /* ignore */
              }
              break;
            }
            case "reset": {
              try {
                const { chunk } = JSON.parse(f.data) as { chunk: string };
                // An empty reset is the box going to sleep (or a boot gap) — same rule as a blank
                // snapshot: keep the transcript, replace on the next real bytes.
                if (!chunk && logRef.current) stale.current = true;
                else {
                  stale.current = false;
                  setLogBoth(() => chunk);
                }
              } catch {
                /* ignore */
              }
              break;
            }
            case "state":
            case "done": {
              try {
                const { meta } = JSON.parse(f.data) as { meta: Omit<WatchSnapshot, "log"> };
                setMeta((m) => ({ ...(m as Omit<WatchSnapshot, "log">), ...meta }));
              } catch {
                /* ignore */
              }
              if (f.event === "done") {
                handle.current?.close();
                startPoll();
              }
              break;
            }
          }
        },
        onError: () => {
          setConnected(false);
          if (stopped.current) return;
          const delay = Math.min(15000, 1000 * 2 ** retry.current++);
          pollTimer.current = setTimeout(connect, delay);
        },
        onDone: () => {
          setConnected(false);
          if (!stopped.current && !pollTimer.current) startPoll();
        },
      },
    );
  }, [session, startPoll]);

  reconnectRef.current = connect;

  useEffect(() => {
    if (!session) return;
    stopped.current = false;
    // Seed from the cache so an already-seen thread paints instantly; a box we have never opened
    // still starts blank. The SSE snapshot frame replaces this wholesale moments later.
    const cached = snapCache.get(session);
    const seedLog = cached?.log ?? "";
    logRef.current = seedLog;
    setLog(logRef.current);
    setMeta(cached?.meta ?? null);
    offset.current = undefined;
    // Fetch the snapshot immediately over plain GET: for a sleeping (stopped)
    // box the SSE stream may error without ever delivering meta, and the
    // caller needs boxStatus to decide to wake it.
    stale.current = false;
    api
      .watch(session)
      .then((snap) => {
        // The fresh server log wins over the cache SEED: for a reused name (warm claim, recreate)
        // the cached log is a previous run's transcript, and `prev || l` kept it on screen whenever
        // the SSE snapshot never arrived (the sleeping-box path). But this GET races the SSE
        // snapshot — if live frames already replaced the seed, leave them alone.
        if (logRef.current !== seedLog) {
          const { log: _l, ...rest } = snap;
          setMeta((m) => m ?? rest);
          return;
        }
        applySnapshot(snap);
      })
      .catch((e) => {
        if ((e as { status?: number }).status === 404) setGone(true);
      });
    connect();
    const sub = AppState.addEventListener("change", (st) => {
      if (stopped.current) return;
      if (st === "active") {
        connect();
      } else {
        handle.current?.close();
        setConnected(false);
      }
    });
    return () => {
      stopped.current = true;
      handle.current?.close();
      if (pollTimer.current) clearTimeout(pollTimer.current);
      sub.remove();
    };
  }, [session, connect]);

  // Keep the cache current so the NEXT open of this thread paints immediately.
  useEffect(() => {
    if (session && meta) snapCache.set(session, { meta, log });
  }, [session, meta, log]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      applySnapshot(await api.watch(session));
    } catch {
      /* transient */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return { meta, log, connected, gone, refresh };
}
