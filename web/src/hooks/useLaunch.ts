import * as React from "react";
import { openSse, ApiError } from "@/lib/api";
import type { LaunchStep } from "@/lib/launch";

/**
 * One launch's feed from the controller (`/launch.sse`, src/launch-progress.ts), kept in a
 * module store so the booting pane and the Thread it hands over to read the same steps without
 * threading them through App. `startLaunch` is called the instant Send is pressed — before the
 * delegate POST is answered, which is the point: the stages arrive while that request is open.
 *
 * The stream ends itself on the controller's `done` (agent started, or the launch failed); the
 * entry stays so the thread can show the receipt ("started in 12s on a warm sandbox") after the
 * transcript takes over. A tab that never hears `done` stops listening after ten minutes.
 */
export interface LaunchFeed {
  /** When Send was pressed in this tab. */
  sentAt: number;
  steps: LaunchStep[];
  /** The controller said the launch is over (started or failed). */
  done: boolean;
}

const LAUNCH_MAX_MS = 10 * 60_000;
const feeds = new Map<string, LaunchFeed>();
const subs = new Map<string, Set<() => void>>();
const streams = new Map<string, AbortController>();

function publish(id: string): void {
  for (const f of subs.get(id) ?? []) f();
}

function set(id: string, patch: Partial<LaunchFeed>): void {
  const cur = feeds.get(id);
  if (!cur) return;
  feeds.set(id, { ...cur, ...patch });
  publish(id);
}

export function startLaunch(id: string): void {
  if (feeds.has(id)) return;
  feeds.set(id, { sentAt: Date.now(), steps: [], done: false });
  const ctrl = new AbortController();
  streams.set(id, ctrl);
  const startedAt = Date.now();
  let lastId: string | undefined;
  let attempt = 0;
  const loop = async () => {
    while (!ctrl.signal.aborted && Date.now() - startedAt < LAUNCH_MAX_MS) {
      try {
        await openSse(
          "/launch.sse",
          { id },
          {
            signal: ctrl.signal,
            lastEventId: lastId,
            onOpen: () => {
              attempt = 0;
            },
            onFrame: (f) => {
              if (f.event === "step") {
                // A reconnect replays from Last-Event-ID; anything at or before it is already here.
                if (f.id && lastId !== undefined && Number(f.id) <= Number(lastId)) return;
                if (f.id) lastId = f.id;
                const raw = JSON.parse(f.data) as Omit<LaunchStep, "at">;
                const cur = feeds.get(id);
                if (!cur) return;
                // Stamped on arrival: durations are measured on this clock, like `sentAt`.
                set(id, { steps: [...cur.steps, { ...raw, at: Date.now() }] });
              } else if (f.event === "done") {
                set(id, { done: true });
                ctrl.abort();
              }
            },
          }
        );
        if (feeds.get(id)?.done) return;
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) return;
      }
      attempt++;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** Math.min(attempt, 3), 8000)));
    }
  };
  void loop().finally(() => streams.delete(id));
}

/** Stop listening (the launch failed in this tab, or the transcript has taken over). The feed is kept. */
export function endLaunch(id: string): void {
  streams.get(id)?.abort();
}

export function useLaunch(id: string | undefined): LaunchFeed | undefined {
  const subscribe = React.useCallback(
    (cb: () => void) => {
      if (!id) return () => {};
      let s = subs.get(id);
      if (!s) subs.set(id, (s = new Set()));
      s.add(cb);
      return () => {
        s!.delete(cb);
        if (!s!.size) subs.delete(id);
      };
    },
    [id]
  );
  return React.useSyncExternalStore(subscribe, () => (id ? feeds.get(id) : undefined), () => undefined);
}
