import * as React from "react";

/**
 * Poll a promise on an interval, with the things a naive `setInterval(fetch)` gets wrong:
 *
 *  - it never stacks requests (a tick still in flight is not re-entered),
 *  - it stops entirely while the tab is hidden, then fetches once immediately on return, and
 *  - it can hold its first tick for `initialDelayMs` — used when the poll is a FALLBACK behind a
 *    live stream, so the two never race each other for the same first byte.
 */
export function usePoll<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
  opts: { initialDelayMs?: number; initial?: T | null; onData?: (data: T) => void } = {}
) {
  // `initial` lets a caller paint a cached snapshot before the first tick lands (instant first frame).
  const [data, setData] = React.useState<T | null>(opts.initial ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [live, setLive] = React.useState(false);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const fnRef = React.useRef(fn);
  fnRef.current = fn;
  const initialDelay = opts.initialDelayMs ?? 0;

  React.useEffect(() => {
    // A non-positive interval disables polling entirely — used when a live stream is the source of
    // truth, so the fallback never fires (and never spins in a setTimeout(run, 0) hot loop).
    if (intervalMs <= 0) {
      setLive(false);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const run = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await fnRef.current(controller.signal);
        if (cancelled) return;
        setData(next);
        opts.onData?.(next);
        setError(null);
        setLive(true);
        setUpdatedAt(Date.now());
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : String(e));
        setLive(false);
      } finally {
        if (!cancelled) timer = window.setTimeout(run, intervalMs);
      }
    };

    const onVisibility = () => {
      window.clearTimeout(timer);
      if (document.hidden) controller?.abort();
      else void run();
    };

    if (initialDelay > 0) timer = window.setTimeout(run, initialDelay);
    else void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, initialDelay, ...deps]);

  return { data, error, live, updatedAt };
}
