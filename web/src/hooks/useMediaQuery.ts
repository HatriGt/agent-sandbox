import * as React from "react";

const subscribe = (q: string) => (notify: () => void) => {
  const mq = window.matchMedia(q);
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
};

/** Whether the media query matches right now, re-rendering when that changes. */
export function useMediaQuery(q: string): boolean {
  return React.useSyncExternalStore(
    React.useMemo(() => subscribe(q), [q]),
    () => window.matchMedia(q).matches,
    () => false
  );
}
