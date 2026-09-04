/**
 * Response security headers for the controller's HTTP entry. Pure + unit-tested.
 *
 * The dashboard holds a root-equivalent bearer token in `localStorage` (interim model until real
 * accounts — see docs/security.md). That makes script injection the highest-value attack on the
 * console: one XSS reads the token and inherits the whole controller. These headers are the
 * defence-in-depth layer around that, and CSP is the load-bearing part of it.
 *
 * Three profiles, picked by path:
 *  - `app`      the SPA shell (landing + /dashboard/**, including its built assets).
 *  - `artifact` bytes produced *inside a sandbox* — the most hostile thing we serve. Locked to
 *               `default-src 'none'` + `sandbox`, so even if a content-type slipped through, the
 *               response has no origin, no scripts and no same-origin privileges.
 *  - `data`     every JSON/SSE route. Nothing should ever be rendered from these.
 */
export type HeaderMap = Record<string, string>;

/**
 * SPA policy. Deliberately has NO `unsafe-eval` and NO `unsafe-inline` for scripts: the Vite build
 * emits external modules only, and the syntax highlighter runs shiki's JavaScript regex engine
 * (not the Oniguruma WASM build), so nothing needs to eval.
 *
 * `style-src` keeps `'unsafe-inline'`: shiki bakes per-token colours into `style=` attributes on the
 * spans it generates, and the motion layer writes inline styles. Inline *style* cannot exfiltrate a
 * localStorage token, so this is the one relaxation worth making.
 */
const CSP_APP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // GitHub avatars on the Integrations page (github.com/<login>.png redirects to avatars.githubusercontent.com).
  "img-src 'self' data: blob: https://github.com https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  // Same-origin only: the API, the SSE stream and artifact downloads are all on this origin, so a
  // successful injection still has nowhere to POST the token to.
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const CSP_DATA = ["default-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");

const CSP_ARTIFACT = `${CSP_DATA}; sandbox`;

export type CspKind = "app" | "artifact" | "data";

/** Which CSP profile a request path gets. Static assets under /dashboard count as the app shell. */
export function cspKindForPath(path: string): CspKind {
  if (path === "/artifact") return "artifact";
  if (path === "/" || path === "/dashboard" || path.startsWith("/dashboard/") || /^\/(signin|signup)\/?$/.test(path)) return "app";
  return "data";
}

export function cspFor(kind: CspKind): string {
  return kind === "app" ? CSP_APP : kind === "artifact" ? CSP_ARTIFACT : CSP_DATA;
}

/**
 * The full header set for a request path.
 *
 * HSTS is emitted unconditionally: TLS is terminated by Traefik in front, so express itself sees
 * plain HTTP and cannot detect the scheme — and a browser ignores the header when it arrives over
 * http, so sending it always is both safe and correct for the deployed (https) origin.
 */
export function securityHeaders(path: string): HeaderMap {
  return {
    "Content-Security-Policy": cspFor(cspKindForPath(path)),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    // frame-ancestors already covers modern browsers; this is the legacy companion.
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    // The token never rides in a URL, but no-referrer also keeps session ids and box names out of
    // the Referer on the external links the console renders (github.com, MCP vendor docs).
    "Referrer-Policy": "no-referrer",
    // microphone=(self): the dashboard's dictation (Web Speech + a local level meter) needs the mic
    // on this origin only; nothing embeds us (frame-ancestors 'none'), so no delegation surface opens.
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
