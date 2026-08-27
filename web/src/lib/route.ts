import * as React from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * Console routing on React Router v7 (browser history, served by the SPA fallback):
 *
 *   /                      public landing
 *   /dashboard             hub
 *   /dashboard/box/:name   a machine's thread
 *   /dashboard/fleet       fleet view
 *   /dashboard/accounts    GitHub accounts
 *
 * The bearer token rides in `?token=` and must survive every navigation, so all in-app navigation
 * goes through `useGo`, which carries the current search string along. Old `#/box/<name>` links
 * (the previous hash router) are translated once on load by `legacyHashTarget`.
 */
export const BASE = "/dashboard";

export type ConsoleRoute =
  | { view: "hub" }
  | { view: "box"; name: string }
  | { view: "fleet" }
  | { view: "integrations" };

export function parseConsolePath(pathname: string): ConsoleRoute {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const box = rest.match(/^\/box\/([^/]+)/);
  if (box) return { view: "box", name: decodeURIComponent(box[1]) };
  if (/^\/fleet\/?$/.test(rest)) return { view: "fleet" };
  if (/^\/(accounts|integrations)\/?$/.test(rest)) return { view: "integrations" };
  return { view: "hub" };
}

export function consolePath(r: ConsoleRoute): string {
  switch (r.view) {
    case "box":
      return `${BASE}/box/${encodeURIComponent(r.name)}`;
    case "fleet":
      return `${BASE}/fleet`;
    case "integrations":
      return `${BASE}/integrations`;
    default:
      return BASE;
  }
}

/** `#/box/x` / `#/fleet` from the previous hash router → a route, or null. */
export function legacyHashTarget(hash: string): ConsoleRoute | null {
  const h = hash.replace(/^#\/?/, "");
  if (!h) return null;
  if (h === "fleet") return { view: "fleet" };
  const m = h.match(/^box\/(.+)$/);
  return m ? { view: "box", name: decodeURIComponent(m[1]) } : null;
}

export function useConsoleRoute(): ConsoleRoute {
  const { pathname } = useLocation();
  return React.useMemo(() => parseConsolePath(pathname), [pathname]);
}

/** Navigate inside the console, preserving `?token=`. */
export function useGo() {
  const navigate = useNavigate();
  const { search } = useLocation();
  return React.useCallback(
    (r: ConsoleRoute, opts: { replace?: boolean } = {}) => navigate({ pathname: consolePath(r), search }, { replace: opts.replace }),
    [navigate, search]
  );
}
