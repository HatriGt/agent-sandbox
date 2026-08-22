import * as React from "react";

/**
 * Poll a promise on an interval, with the two things a naive `setInterval(fetch)` gets wrong:
 *
 *  - it never stacks requests (a tick still in flight is not re-entered), and
 *  - it stops entirely while the tab is hidden, then fetches once immediately on return.
 *    A phone left on this page in a pocket should not wake a VPS every three seconds.
 */
export function usePoll<T>(fn: (signal: AbortSignal) => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [live, setLive] = React.useState(false);
  // When the last successful response landed, so the UI can show real freshness rather than
  // advertise an interval it may not achieve: /monitor.json does SSH round trips per machine, so a
  // 3s tick against a 4s response is a label that lies.
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const fnRef = React.useRef(fn);
  fnRef.current = fn;

  React.useEffect(() => {
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

    void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, ...deps]);

  return { data, error, live, updatedAt };
}
