/**
 * Bearer-token guard for the HTTP MCP entry. Pure + unit-tested.
 *
 * Fails CLOSED: if no token is configured, every request is rejected (never accidentally run an
 * open, VM-spawning endpoint on the internet). Uses a length-checked timing-safe comparison.
 */
import crypto from "node:crypto";

export function checkBearer(authHeader: string | undefined, token: string | undefined): boolean {
  if (!token) return false; // no token configured -> deny everything
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;

  const provided = authHeader.slice("Bearer ".length);
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return crypto.timingSafeEqual(a, b);
}
