/**
 * One sweep across every enabled box host: the fleet read, the MCP monitor and the trigger
 * dispatcher's live set all take this one answer. Each host is swept in parallel; a host that is
 * asleep answers from its last sweep (an SSH would wake it), a host that fails answers from its
 * last sweep too and is marked unreachable until a sweep succeeds. Every box is tagged with the
 * host it lives on, which is how cfgForBox learns the map.
 *
 * Failing loud is kept where it matters: when no host answered at all and none is asleep, the
 * sweep throws, so the fleet's run memory is never wiped by "zero boxes" that was really "the
 * host was unreachable". Without a configured pool (CLI tools) it sweeps the one host in `cfg`.
 *
 * A host that does not answer is given HOST_ANSWER_TIMEOUT_MS per round and then served from
 * memory and marked unreachable: the controller's SSH has no connect timeout of its own, so a dead
 * target would otherwise hold every sweep (and the Fleet page) for the two minutes TCP takes to
 * give up. The slow read is left running and the next round attaches to it instead of stacking
 * another SSH behind it.
 */
import type { Config } from "./config.js";
import type { BoxView } from "./monitor.js";
import { gatherMonitor } from "./msb.js";
import { listClaims, listKept } from "./claims.js";
import { loadTitles } from "./titles.js";
import { hostPool, withTimeout, HOST_ANSWER_TIMEOUT_MS, type HostPool } from "./host-pool.js";

export interface HostSweep {
  boxes: BoxView[];
  kept: Set<string>;
  claims: Map<string, number>;
  titles: Record<string, string>;
  /** Hosts that answered this time. */
  swept: string[];
  /** Hosts served from memory: asleep or unreachable. */
  stale: string[];
}

interface Last {
  kept: Set<string>;
  claims: Map<string, number>;
  titles: Record<string, string>;
}
const last = new Map<string, Last>();
type OneSweep = { boxes: BoxView[] } & Last;
const inFlight = new Map<string, Promise<OneSweep>>();

/** Tests swap the per-host read and the cap. */
let sweepOneImpl: (cfg: Config, id: string) => Promise<OneSweep> = sweepOne;
let answerTimeoutMs = HOST_ANSWER_TIMEOUT_MS;
export function setSweepForTest(impl: ((cfg: Config, id: string) => Promise<OneSweep>) | null, timeoutMs?: number): void {
  sweepOneImpl = impl ?? sweepOne;
  answerTimeoutMs = timeoutMs ?? HOST_ANSWER_TIMEOUT_MS;
  inFlight.clear();
  last.clear();
}

/** One host's read, shared with any round still waiting on it, capped for this round. */
function sweepHost(cfg: Config, id: string): Promise<OneSweep> {
  // Keyed by the target too: a host re-pointed at another machine must not attach to the old read.
  const key = `${id}|${cfg.vpsSsh}`;
  let p = inFlight.get(key);
  if (!p) {
    p = sweepOneImpl(cfg, id).finally(() => {
      if (inFlight.get(key) === p) inFlight.delete(key);
    });
    inFlight.set(key, p);
  }
  return withTimeout(p, answerTimeoutMs, `sweep of ${id}`);
}

async function sweepOne(cfg: Config, id: string): Promise<OneSweep> {
  const [boxes, kept, claims, titles] = await Promise.all([
    gatherMonitor(cfg),
    listKept(cfg).catch(() => last.get(id)?.kept ?? new Set<string>()),
    listClaims(cfg).catch(() => last.get(id)?.claims ?? new Map<string, number>()),
    loadTitles(cfg).catch(() => last.get(id)?.titles ?? ({} as Record<string, string>)),
  ]);
  last.set(id, { kept, claims, titles });
  return { boxes: boxes.map((b) => ({ ...b, host: id })), kept, claims, titles };
}

export async function sweepHosts(cfg: Config, poolOverride?: HostPool): Promise<HostSweep> {
  const pool = poolOverride ?? hostPool();
  if (!pool) {
    const r = await sweepOne(cfg, cfg.hostId ?? "primary");
    return { ...r, swept: [cfg.hostId ?? "primary"], stale: [] };
  }
  // Every enabled host, and a disabled one that still has boxes on it (its runs are watched to the end).
  const hosts = pool.active();
  if (!pool.enabled().length) throw new Error("no box host is enabled");
  const out: HostSweep = { boxes: [], kept: new Set(), claims: new Map(), titles: {}, swept: [], stale: [] };
  let firstError: Error | undefined;
  const merge = (id: string, boxes: BoxView[], l: Last | undefined): void => {
    out.boxes.push(...boxes);
    if (!l) return;
    for (const k of l.kept) out.kept.add(k);
    for (const [k, v] of l.claims) out.claims.set(k, v);
    Object.assign(out.titles, l.titles);
  };
  await Promise.all(
    hosts.map(async (h) => {
      const id = h.spec.id;
      if (pool.dormant(id)) {
        out.stale.push(id);
        merge(id, h.lastBoxes, last.get(id));
        return;
      }
      try {
        const r = await sweepHost(h.cfg, id);
        const boxes = r.boxes.map((b) => (b.host === id ? b : { ...b, host: id }));
        pool.noteSweep(id, boxes);
        out.swept.push(id);
        merge(id, boxes, r);
      } catch (e) {
        firstError ??= e as Error;
        pool.noteSweepError(id, (e as Error).message);
        out.stale.push(id);
        merge(id, h.lastBoxes, last.get(id));
      }
    })
  );
  if (!out.swept.length && firstError && !hosts.some((h) => pool.dormant(h.spec.id))) throw firstError;
  return out;
}

/** Just the boxes, for callers that used gatherMonitor across the one host. */
export async function sweepBoxes(cfg: Config): Promise<BoxView[]> {
  return (await sweepHosts(cfg)).boxes;
}
