import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, type WatchSnapshot } from "@/lib/api";
import { openSse, type SseHandle } from "@/lib/sse";

const DONE_POLL_MS = 3000;

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

  const setLogBoth = (updater: (prev: string) => string) => {
    logRef.current = updater(logRef.current);
    setLog(logRef.current);
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
        const { log: l, ...rest } = snap;
        setMeta(rest);
        setLogBoth(() => l);
        setGone(false);
        if (rest.boxStatus === "Running" && (rest.runState === "running" || rest.runState === "waiting")) {
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
  }, [session]);

  const connect = useCallback(() => {
    if (!session || stopped.current) return;
    handle.current?.close();
    handle.current = openSse(
      `/watch.sse?session=${encodeURIComponent(session)}${offset.current ? `&from=${offset.current}` : ""}`,
      {
        lastEventId: offset.current,
        onFrame: (f) => {
          setConnected(true);
          retry.current = 0;
          if (f.id) offset.current = f.id;
          switch (f.event) {
            case "snapshot": {
              try {
                const snap = JSON.parse(f.data) as WatchSnapshot;
                const { log: l, ...rest } = snap;
                setMeta(rest);
                setLogBoth(() => l ?? "");
              } catch {
                /* malformed snapshot — wait for the next frame */
              }
              break;
            }
            case "append":
              setLogBoth((prev) => prev + f.data);
              break;
            case "reset":
              setLogBoth(() => f.data);
              break;
            case "state": {
              try {
                setMeta((m) => ({ ...(m as Omit<WatchSnapshot, "log">), ...JSON.parse(f.data) }));
              } catch {
                /* ignore */
              }
              break;
            }
            case "done":
              handle.current?.close();
              startPoll();
              break;
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
    logRef.current = "";
    setLog("");
    setMeta(null);
    offset.current = undefined;
    // Fetch the snapshot immediately over plain GET: for a sleeping (stopped)
    // box the SSE stream may error without ever delivering meta, and the
    // caller needs boxStatus to decide to wake it.
    api
      .watch(session)
      .then((snap) => {
        const { log: l, ...rest } = snap;
        setMeta((m) => m ?? rest);
        setLogBoth((prev) => prev || l);
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

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const snap = await api.watch(session);
      const { log: l, ...rest } = snap;
      setMeta(rest);
      setLogBoth(() => l);
    } catch {
      /* transient */
    }
  }, [session]);

  return { meta, log, connected, gone, refresh };
}
