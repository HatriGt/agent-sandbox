import * as React from "react";

// One shared interval per cadence, not one per mounted row: a 60-step group must not run 60 timers.
const tickers = new Map<number, { subs: Set<() => void>; id: number }>();
function subscribeTick(every: number, cb: () => void) {
  let t = tickers.get(every);
  if (!t) {
    const subs = new Set<() => void>();
    t = { subs, id: window.setInterval(() => subs.forEach((f) => f()), every) };
    tickers.set(every, t);
  }
  t.subs.add(cb);
  return () => {
    t!.subs.delete(cb);
    if (!t!.subs.size) {
      window.clearInterval(t!.id);
      tickers.delete(every);
    }
  };
}

/** Wall clock that re-renders every `every` ms while `active`; frozen (and timer-free) otherwise. */
export function useNow(active: boolean, every = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    return subscribeTick(every, () => setNow(Date.now()));
  }, [active, every]);
  return now;
}
