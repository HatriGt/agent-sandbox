/**
 * Bearer-token guard for the HTTP MCP entry. Pure + unit-tested.
 *
 * Fails CLOSED: if no token is configured, every request is rejected (never accidentally run an
 * open, VM-spawning endpoint on the internet). Uses a length-checked timing-safe comparison.
 */
import crypto from "node:crypto";

/** Timing-safe equality of a provided secret against the configured token. Denies when unset. */
export function checkToken(provided: string | undefined, token: string | undefined): boolean {
  if (!token) return false; // no token configured -> deny everything
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return crypto.timingSafeEqual(a, b);
}

export function checkBearer(authHeader: string | undefined, token: string | undefined): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  return checkToken(authHeader.slice("Bearer ".length), token);
}

// There is deliberately no query-parameter auth helper here. The dashboard once accepted `?token=`
// so a link could open the console directly; that leaked a root-equivalent secret into browser
// history, proxy/server logs and Referer headers. Auth is header-only — if a browser API can't set
// headers (EventSource, <a download>), the client uses fetch instead. Do not add it back.
