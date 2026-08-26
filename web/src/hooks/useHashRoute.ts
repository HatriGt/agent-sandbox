import * as React from "react";

/**
 * The selected machine and section live in the URL hash (`#/box/<name>`, `#/fleet`, `#/`), so a
 * reload lands back on the same thread and a thread can be shared by copying the address bar. The
 * token stays in the query string exactly as before; the hash never carries anything secret.
 */
export type Route = { view: "chat"; box: string | null } | { view: "fleet" };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  if (h === "fleet") return { view: "fleet" };
  const m = h.match(/^box\/(.+)$/);
  return { view: "chat", box: m ? decodeURIComponent(m[1]) : null };
}

export function routeHash(r: Route): string {
  if (r.view === "fleet") return "#/fleet";
  return r.box ? `#/box/${encodeURIComponent(r.box)}` : "#/";
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = React.useState<Route>(() => parseRoute(location.hash));
  React.useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const navigate = React.useCallback((r: Route) => {
    const h = routeHash(r);
    if (location.hash !== h) history.replaceState(null, "", h);
    setRoute(r);
  }, []);
  return [route, navigate];
}
