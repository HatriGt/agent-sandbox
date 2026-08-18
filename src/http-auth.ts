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

/**
 * Dashboard auth: allow the token via the `Authorization: Bearer` header (fetch calls) OR a `token`
 * query param (so the page can be opened directly in a browser, which can't set headers on navigation).
 */
export function checkDashboardAuth(
  authHeader: string | undefined,
  queryToken: unknown,
  token: string | undefined
): boolean {
  if (checkBearer(authHeader, token)) return true;
  return typeof queryToken === "string" && checkToken(queryToken, token);
}
