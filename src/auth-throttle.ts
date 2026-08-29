/**
 * Slow down credential guessing. One shared bearer token protects everything, so a brute-force
 * against it must not be free: after `limit` failed attempts from one client within `windowMs`,
 * that client gets 429 for the rest of the window — without touching successful requests from
 * anyone else. In-memory; a restart forgets. Behind a reverse proxy the client is the first hop
 * of X-Forwarded-For (spoofable, so this is a speed bump, not the lock — see SECURITY notes).
 */
export interface Throttle {
  /** True when the client is currently locked out. */
  blocked(client: string): boolean;
  /** Record a failed attempt. */
  fail(client: string): void;
  /** For tests / introspection. */
  size(): number;
}

export function makeAuthThrottle(opts: { limit?: number; windowMs?: number; now?: () => number } = {}): Throttle {
  const limit = opts.limit ?? 20;
  const windowMs = opts.windowMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { n: number; since: number }>();
  const sweep = () => {
    const t = now();
    for (const [k, v] of hits) if (t - v.since > windowMs) hits.delete(k);
  };
  return {
    blocked(client) {
      const v = hits.get(client);
      if (!v) return false;
      if (now() - v.since > windowMs) {
        hits.delete(client);
        return false;
      }
      return v.n >= limit;
    },
    fail(client) {
      if (hits.size > 10_000) sweep();
      const t = now();
      const v = hits.get(client);
      if (!v || t - v.since > windowMs) hits.set(client, { n: 1, since: t });
      else v.n++;
    },
    size: () => hits.size,
  };
}

/** The client identity for throttling: first X-Forwarded-For hop when proxied, else the socket. */
export function clientOf(headers: Record<string, string | string[] | undefined>, socketAddr: string | undefined): string {
  const xff = headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || socketAddr || "unknown";
}

/**
 * Per-caller rate limit for state-changing requests: a sliding window of `limit` per `windowMs`.
 * Keys are principals (user id / "operator") or, before auth, the client address. Reads are not
 * limited — the fleet poll is legitimately chatty; mutations are what cost machines and money.
 */
export function makeRateLimiter(opts: { limit?: number; windowMs?: number; now?: () => number } = {}) {
  const limit = opts.limit ?? 60;
  const windowMs = opts.windowMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    /** Records the hit and reports whether it is over the limit. */
    over(key: string): boolean {
      const t = now();
      const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      arr.push(t);
      hits.set(key, arr);
      if (hits.size > 20_000) for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k);
      return arr.length > limit;
    },
  };
}
