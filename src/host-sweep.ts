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
 */
import type { Config } from "./config.js";
import type { BoxView } from "./monitor.js";
import { gatherMonitor } from "./msb.js";
import { listClaims, listKept } from "./claims.js";
import { loadTitles } from "./titles.js";
import { hostPool } from "./host-pool.js";

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

async function sweepOne(cfg: Config, id: string): Promise<{ boxes: BoxView[] } & Last> {
  const [boxes, kept, claims, titles] = await Promise.all([
    gatherMonitor(cfg),
    listKept(cfg).catch(() => last.get(id)?.kept ?? new Set<string>()),
    listClaims(cfg).catch(() => last.get(id)?.claims ?? new Map<string, number>()),
    loadTitles(cfg).catch(() => last.get(id)?.titles ?? ({} as Record<string, string>)),
  ]);
  last.set(id, { kept, claims, titles });
  return { boxes: boxes.map((b) => ({ ...b, host: id })), kept, claims, titles };
}

export async function sweepHosts(cfg: Config): Promise<HostSweep> {
  const pool = hostPool();
  if (!pool) {
    const r = await sweepOne(cfg, cfg.hostId ?? "primary");
    return { ...r, swept: [cfg.hostId ?? "primary"], stale: [] };
  }
  const hosts = pool.enabled();
  if (!hosts.length) throw new Error("no box host is enabled");
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
      if (h.sleep.asleep()) {
        out.stale.push(id);
        merge(id, h.lastBoxes, last.get(id));
        return;
      }
      try {
        const r = await sweepOne(h.cfg, id);
        pool.noteSweep(id, r.boxes);
        out.swept.push(id);
        merge(id, r.boxes, r);
      } catch (e) {
        firstError ??= e as Error;
        pool.noteSweepError(id, (e as Error).message);
        out.stale.push(id);
        merge(id, h.lastBoxes, last.get(id));
      }
    })
  );
  if (!out.swept.length && firstError && !hosts.some((h) => h.sleep.asleep())) throw firstError;
  return out;
}

/** Just the boxes, for callers that used gatherMonitor across the one host. */
export async function sweepBoxes(cfg: Config): Promise<BoxView[]> {
  return (await sweepHosts(cfg)).boxes;
}
