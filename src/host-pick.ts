/**
 * Which host gets the next run. Pure: the pool (host-pool.ts) hands in one line per host and
 * takes the answer; nothing here touches a host.
 *
 * The order is the operator's priority first (the VPS of our own at 0 beats a metered VM at 10),
 * then, among equals: a host with a warm box ready beats one that would cold-boot, an awake host
 * beats one that has to resume (a Freestyle resume costs a minute or two), and the host with the
 * most allowance left beats the one nearly spent, so two accounts drain evenly. A host that is
 * disabled, unreachable, full, or out of allowance is never picked.
 */

export interface HostCandidate {
  id: string;
  enabled: boolean;
  /** The last sweep failed and no sweep since has succeeded. */
  unreachable: boolean;
  /** Running boxes that hold a session (claimed pool + session boxes). */
  running: number;
  /** Boots in flight on this host, counted by the capacity reservation. */
  reserved: number;
  maxBoxes: number;
  /** A warm box of the wanted flavor is free on this host right now. */
  warmReady: boolean;
  asleep: boolean;
  priority: number;
  /** vCPU-hours left this month; undefined when unmetered (treated as infinite). */
  allowanceLeft?: number;
  /** The minimum the next run is expected to cost, in vCPU-hours; a host under that is skipped. */
  minAllowance?: number;
}

export interface PickResult {
  id?: string;
  /** Why no host was picked, for the refusal message. */
  reason?: string;
  /** Hosts that were considered, in the order they were ranked. */
  ranked: string[];
}

export function pickHost(cands: readonly HostCandidate[]): PickResult {
  const open = cands.filter((c) => c.enabled && !c.unreachable);
  const withRoom = open.filter((c) => c.running + c.reserved < c.maxBoxes);
  const funded = withRoom.filter((c) => c.allowanceLeft === undefined || c.allowanceLeft > (c.minAllowance ?? 0));
  const ranked = [...funded].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.warmReady !== b.warmReady) return a.warmReady ? -1 : 1;
    if (a.asleep !== b.asleep) return a.asleep ? 1 : -1;
    const la = a.allowanceLeft ?? Number.POSITIVE_INFINITY;
    const lb = b.allowanceLeft ?? Number.POSITIVE_INFINITY;
    if (la !== lb) return lb - la;
    // The emptier host, as a share of its own capacity, so equal hosts fill evenly.
    const fa = (a.running + a.reserved) / Math.max(1, a.maxBoxes);
    const fb = (b.running + b.reserved) / Math.max(1, b.maxBoxes);
    if (fa !== fb) return fa - fb;
    return a.id.localeCompare(b.id);
  });
  if (ranked.length) return { id: ranked[0].id, ranked: ranked.map((c) => c.id) };
  const reason = !cands.length
    ? "no box host is configured"
    : !open.length
      ? cands.every((c) => !c.enabled)
        ? "every box host is disabled"
        : "every box host is unreachable"
      : !withRoom.length
        ? `every box host is full (${open.map((c) => `${c.id} ${c.running + c.reserved}/${c.maxBoxes}`).join(", ")})`
        : "every box host with room has used up its monthly allowance";
  return { reason, ranked: [] };
}

/** Capacity across the hosts that can take a run: the figure the dashboard's slot strip shows. */
export function totalCapacity(cands: readonly HostCandidate[]): number {
  return cands.filter((c) => c.enabled).reduce((n, c) => n + c.maxBoxes, 0);
}
