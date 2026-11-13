import * as React from "react";
import { api } from "@/lib/api";
import type { AutoCompactMode } from "@/lib/context-health";

/**
 * The viewer's auto-compact setting (Settings → Drivers), read once per page and shared: the context
 * meter needs it to place its "compacts here" tick and to word its advice. Saving the setting calls
 * {@link setAutoCompactMode} so open threads follow at once.
 */
let mode: AutoCompactMode = "standard";
let loaded: Promise<void> | null = null;
const subs = new Set<() => void>();

export function setAutoCompactMode(next: AutoCompactMode | undefined) {
  mode = next ?? "standard";
  subs.forEach((f) => f());
}

export function useAutoCompactMode(): AutoCompactMode {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    subs.add(bump);
    loaded ??= api
      .agentPrefs()
      .then((p) => setAutoCompactMode(p.autoCompact))
      .catch(() => {
        loaded = null;
      });
    return () => {
      subs.delete(bump);
    };
  }, []);
  return mode;
}
