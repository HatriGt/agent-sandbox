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
  | { view: "pr"; name: string; repo: string; number: number }
  | { view: "fleet" }
  | { view: "history" }
  | { view: "activity" }
  | { view: "automations" }
  | { view: "automation-runs"; id: string }
  | { view: "skills" }
  | { view: "memory" }
  | { view: "harnesses" }
  | { view: "playbooks" }
  | { view: "integrations" }
  | { view: "account" }
  | { view: "connect" }
  | { view: "welcome" }
  | { view: "admin" };

export function parseConsolePath(pathname: string): ConsoleRoute {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  // The PR page is nested under its box, so it MUST be matched before the /box/:name rule below —
  // that one is a prefix match and would otherwise swallow the whole path.
  const pr = rest.match(/^\/box\/([^/]+)\/pr\/([^/]+)\/([^/]+)\/(\d+)\/?$/);
  if (pr) return { view: "pr", name: decodeURIComponent(pr[1]), repo: `${decodeURIComponent(pr[2])}/${decodeURIComponent(pr[3])}`, number: Number(pr[4]) };
  const box = rest.match(/^\/box\/([^/]+)/);
  if (box) return { view: "box", name: decodeURIComponent(box[1]) };
  if (/^\/fleet\/?$/.test(rest)) return { view: "fleet" };
  if (/^\/history\/?$/.test(rest)) return { view: "history" };
  if (/^\/activity\/?$/.test(rest)) return { view: "activity" };
  if (/^\/(automations|autopilot)\/?$/.test(rest)) return { view: "automations" };
  const runs = rest.match(/^\/autopilot\/automations\/([^/]+)\/runs\/?$/);
  if (runs) return { view: "automation-runs", id: decodeURIComponent(runs[1]) };
  if (/^\/skills\/?$/.test(rest)) return { view: "skills" };
  if (/^\/memory\/?$/.test(rest)) return { view: "memory" };
  if (/^\/harnesses\/?$/.test(rest)) return { view: "harnesses" };
  if (/^\/autopilot\/playbooks\/?$/.test(rest)) return { view: "playbooks" };
  if (/^\/(accounts|integrations)\/?$/.test(rest)) return { view: "integrations" };
  if (/^\/account\/?$/.test(rest)) return { view: "account" };
  if (/^\/connect\/?$/.test(rest)) return { view: "connect" };
  if (/^\/welcome\/?$/.test(rest)) return { view: "welcome" };
  if (/^\/admin\/?$/.test(rest)) return { view: "admin" };
  return { view: "hub" };
}

export function consolePath(r: ConsoleRoute): string {
  switch (r.view) {
    case "box":
      return `${BASE}/box/${encodeURIComponent(r.name)}`;
    case "pr": {
      const [owner, name] = r.repo.split("/");
      return `${BASE}/box/${encodeURIComponent(r.name)}/pr/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${r.number}`;
    }
    case "fleet":
      return `${BASE}/fleet`;
    case "history":
      return `${BASE}/history`;
    case "activity":
      return `${BASE}/activity`;
    case "automations":
      return `${BASE}/autopilot`;
    case "automation-runs":
      return `${BASE}/autopilot/automations/${encodeURIComponent(r.id)}/runs`;
    case "skills":
      return `${BASE}/skills`;
    case "memory":
      return `${BASE}/memory`;
    case "harnesses":
      return `${BASE}/harnesses`;
    case "playbooks":
      return `${BASE}/autopilot/playbooks`;
    case "integrations":
      return `${BASE}/integrations`;
    case "account":
      return `${BASE}/account`;
    case "connect":
      return `${BASE}/connect`;
    case "welcome":
      return `${BASE}/welcome`;
    case "admin":
      return `${BASE}/admin`;
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
