/**
 * Incremental memory harvest — the controller-side half of "capture as it happens".
 *
 * The agent writes `<!-- remember: … -->` lines whenever something durable happens (a correction,
 * an abandoned approach, an answered question). Waiting for the finish edge to read them would turn
 * a lesson from minute 3 into a toast at minute 40, so the fleet tick (src/http.ts) hands every
 * running box's log here every few seconds and the finish edge does a last pass. The log is a
 * sliding tail, re-read whole each time, so the same line is seen many times: a per-box Set of
 * note keys makes the harvest idempotent, and it is dropped with the box (like boxVerified).
 *
 * This class also keeps the two bits of per-box state the thread view needs that the store does
 * not: which notes a box produced recently (`memoryNew` on its WatchSnapshot, for the toasts) and
 * a tally by kind for the digest. All in memory — a controller restart loses the toasts for notes
 * already stored, which is a visible, harmless degradation (the notes themselves are in the store).
 *
 * Store IO is injected so the harvest can be driven in tests without a database, and so the caller
 * can wrap the load→mutate→save in its per-owner store lock.
 */
import {
  autoKeepPending,
  countKinds,
  MEMORY_NEW_WINDOW_MS,
  rememberRunNotes,
  type MemoryKind,
  type MemoryNote,
  type MemoryStore,
} from "./memory-store.js";

/** A freshly produced note as the WatchSnapshot carries it (`memoryNew`). */
export interface MemoryNewItem {
  id: string;
  kind: MemoryKind;
  text: string;
  why?: string;
  status: "pending" | "kept";
  at: number;
}

export interface HarvesterDeps {
  load(owner: string): MemoryStore;
  save(store: MemoryStore, owner: string): void;
  now?: () => number;
  /** Minimum gap between two harvests of one box (the finish edge ignores it). */
  minGapMs?: number;
}

export interface HarvestResult {
  /** Notes stored by THIS pass. */
  added: MemoryNote[];
  /** Pending notes the pass auto-kept (older than the window). */
  autoKept: MemoryNote[];
}

export class MemoryHarvester {
  private readonly seen = new Map<string, Set<string>>();
  private readonly recent = new Map<string, MemoryNewItem[]>();
  private readonly tally = new Map<string, MemoryNote[]>();
  private readonly last = new Map<string, { at: number; sig: string }>();
  private readonly lastSweep = new Map<string, number>();
  private readonly now: () => number;
  private readonly minGapMs: number;

  constructor(private readonly deps: HarvesterDeps) {
    this.now = deps.now ?? Date.now;
    this.minGapMs = deps.minGapMs ?? 5_000;
  }

  /**
   * Should the tick harvest this box now? Only when the throttle window passed AND the log moved
   * since the last pass — a quiet box costs nothing. The log is a capped sliding tail, so its length
   * alone stops changing once full: the signature is length plus the last bytes. Call `harvest`
   * with `force` at the finish edge.
   */
  due(box: string, log: string): boolean {
    const l = this.last.get(box);
    if (!l) return log.length > 0;
    return this.now() - l.at >= this.minGapMs && logSig(log) !== l.sig;
  }

  /**
   * Parse the log, store what this box has not produced yet, auto-keep stale proposals. Loads and
   * saves the owner's store only when something changed. Never throws into the tick: the caller
   * wraps it (a failing harvest must not stop the fleet sweep).
   */
  harvest(box: string, owner: string, log: string, repos: string[], opts: { questions?: Array<{ question: string; answer?: string }>; force?: boolean } = {}): HarvestResult {
    const now = this.now();
    if (!opts.force && !this.due(box, log)) return { added: [], autoKept: [] };
    this.last.set(box, { at: now, sig: logSig(log) });
    const seen = this.seen.get(box) ?? new Set<string>();
    this.seen.set(box, seen);
    const store = this.deps.load(owner);
    const added = rememberRunNotes(store, { box, log, repos, now, seen, ...(opts.questions ? { questions: opts.questions } : {}) });
    const autoKept = autoKeepPending(store, now);
    if (added.length || autoKept.length) this.deps.save(store, owner);
    if (added.length) {
      const list = this.recent.get(box) ?? [];
      list.push(...added.map(toNewItem));
      this.recent.set(box, list);
      this.tally.set(box, [...(this.tally.get(box) ?? []), ...added]);
    }
    for (const n of autoKept) this.noteChanged(n.id, { status: "kept" });
    return { added, autoKept };
  }

  /**
   * Auto-keep stale proposals for an owner even when none of their boxes is producing notes (the
   * run that proposed them may have finished). Throttled per owner; the tick calls it with the
   * owners of every box it sees. Returns the notes flipped.
   */
  sweepPending(owner: string, everyMs = 60_000): MemoryNote[] {
    const now = this.now();
    const l = this.lastSweep.get(owner);
    if (l !== undefined && now - l < everyMs) return [];
    this.lastSweep.set(owner, now);
    const store = this.deps.load(owner);
    const flipped = autoKeepPending(store, now);
    if (flipped.length) {
      this.deps.save(store, owner);
      for (const n of flipped) this.noteChanged(n.id, { status: "kept" });
    }
    return flipped;
  }

  /** The notes a box produced in the last window, oldest first; undefined when none (keeps snapshots lean). */
  memoryNew(box: string): MemoryNewItem[] | undefined {
    const list = this.recent.get(box);
    if (!list) return undefined;
    const cutoff = this.now() - MEMORY_NEW_WINDOW_MS;
    const live = list.filter((n) => n.at >= cutoff);
    if (live.length !== list.length) {
      if (live.length) this.recent.set(box, live);
      else this.recent.delete(box);
    }
    return live.length ? live : undefined;
  }

  /** Everything the box produced this run, by kind, for the digest. */
  rememberedKinds(box: string): Partial<Record<MemoryKind, number>> {
    return countKinds(this.tally.get(box) ?? []);
  }

  /** Reflect a dashboard keep/edit (any box's copy) so the next snapshot matches the store. */
  noteChanged(id: string, patch: { status?: "pending" | "kept"; text?: string; why?: string }): void {
    for (const list of this.recent.values()) {
      const n = list.find((x) => x.id === id);
      if (!n) continue;
      if (patch.status) n.status = patch.status;
      if (patch.text !== undefined) n.text = patch.text;
      if (patch.why !== undefined) {
        if (patch.why) n.why = patch.why;
        else delete n.why;
      }
    }
  }

  /** A forgotten (deleted) note leaves the toasts at once. */
  noteDeleted(id: string): void {
    for (const [box, list] of this.recent) {
      const next = list.filter((x) => x.id !== id);
      if (next.length !== list.length) {
        if (next.length) this.recent.set(box, next);
        else this.recent.delete(box);
      }
    }
  }

  /**
   * A new turn starts (resume): its digest counts only what IT remembers. The seen-keys survive on
   * purpose — the log keeps the earlier turns' lines, and re-harvesting them would resurrect a note
   * the operator forgot in between.
   */
  resetRun(box: string): void {
    this.tally.delete(box);
  }

  /** Drop every trace of a box (teardown / forget). */
  forget(box: string): void {
    this.seen.delete(box);
    this.recent.delete(box);
    this.tally.delete(box);
    this.last.delete(box);
  }
}

const logSig = (log: string): string => `${log.length}:${log.slice(-64)}`;

function toNewItem(n: MemoryNote): MemoryNewItem {
  return { id: n.id, kind: n.kind, text: n.text, ...(n.why ? { why: n.why } : {}), status: n.status, at: n.at };
}
