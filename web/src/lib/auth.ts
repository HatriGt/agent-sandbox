/**
 * The bearer token, in the browser.
 *
 * Interim model (until real accounts): one token = one operator = everything on the controller. It
 * lives in `localStorage` and rides as an `Authorization: Bearer` header on every request — never in
 * a URL, so it is out of history, logs and referrers. A `?token=` on first load (old links) is
 * consumed once and stripped from the address bar.
 */
const KEY = "asb-token";
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(KEY, token.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the session still works via memory below */
  }
  memory = token.trim();
  notify();
}

let memory = "";
export function currentToken(): string {
  return getToken() || memory;
}

/** Old-style link: take the token out of the URL, keep it, and clean the address bar. */
export function migrateTokenFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const t = params.get("token");
  if (!t) return;
  setToken(t);
  params.delete("token");
  const search = params.toString();
  history.replaceState(null, "", `${location.pathname}${search ? `?${search}` : ""}${location.hash}`);
}

export function onTokenChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called by the API layer on a 401: the stored token is wrong or revoked. */
export function signOut(): void {
  setToken("");
}
