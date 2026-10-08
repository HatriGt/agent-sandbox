import { useEffect, useState } from "react";

// One shared interval per cadence, not one per mounted row (web/src/hooks/useNow.ts): a 60-step
// plan must not run 60 timers.
const tickers = new Map<number, { subs: Set<() => void>; id: ReturnType<typeof setInterval> }>();
function subscribeTick(every: number, cb: () => void) {
  let t = tickers.get(every);
  if (!t) {
    const subs = new Set<() => void>();
    t = { subs, id: setInterval(() => subs.forEach((f) => f()), every) };
    tickers.set(every, t);
  }
  t.subs.add(cb);
  return () => {
    t!.subs.delete(cb);
    if (!t!.subs.size) {
      clearInterval(t!.id);
      tickers.delete(every);
    }
  };
}

/** Wall clock that re-renders every `intervalMs` while `active`; frozen (and timer-free) otherwise. */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    return subscribeTick(intervalMs, () => setNow(Date.now()));
  }, [active, intervalMs]);
  return now;
}
