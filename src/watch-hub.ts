/**
 * WatchHub — one shared tail loop per box, with an in-memory snapshot cache.
 *
 * Before this, every viewer of a box ran its own `gatherWatch` loop (one SSH round trip per 800ms
 * per viewer), and opening a thread paid the full round trip before the first byte reached the
 * browser — several seconds, every time you switched machines. The hub changes the shape:
 *
 *   · one loop per box, shared by every reader (SSE viewers, /watch.json, prefetches);
 *   · `read()` answers INSTANTLY from the cached snapshot when it is fresh enough, so a thread that
 *     was open a moment ago — or that a hover prefetched — renders with zero latency;
 *   · the loop keeps running for `graceMs` after the last read, so switching back is instant and a
 *     reconnecting EventSource never sees a cold cache;
 *   · a box in a terminal state (done/idle) is polled slowly (`idleTickMs`) instead of every 800ms —
 *     nothing changes until a follow-up, and the fleet poll notices that first.
 *
 * Transport-agnostic and pure enough to unit test with an injected `read` (see test/watch-hub.test.ts).
 */
import type { WatchSnapshot } from "./monitor.js";
import { isTerminal } from "./watch-sse.js";

export interface WatchHubOpts {
  /** Reads one fresh snapshot (the SSH-backed gatherWatch in production). */
  read: (session: string) => Promise<WatchSnapshot>;
  /** Tail cadence while the run is live. */
  tickMs?: number;
  /** Tail cadence once the run is terminal (done/idle). */
  idleTickMs?: number;
  /** How long to keep tailing a box after its last reader went away. */
  graceMs?: number;
  /** A cached snapshot younger than this is served without waiting for the next tick. */
  freshMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Entry {
  snap: WatchSnapshot | null;
  at: number;
  lastReadAt: number;
  timer: NodeJS.Timeout | null;
  inFlight: Promise<WatchSnapshot> | null;
  waiters: Array<(s: WatchSnapshot) => void>;
  failures: number;
}

export class WatchHub {
  private readonly entries = new Map<string, Entry>();
  private readonly tickMs: number;
  private readonly idleTickMs: number;
  private readonly graceMs: number;
  private readonly freshMs: number;
  private readonly now: () => number;
  private readonly readFn: (session: string) => Promise<WatchSnapshot>;

  constructor(opts: WatchHubOpts) {
    this.readFn = opts.read;
    this.tickMs = opts.tickMs ?? 800;
    this.idleTickMs = opts.idleTickMs ?? 3000;
    this.graceMs = opts.graceMs ?? 60_000;
    this.freshMs = opts.freshMs ?? this.tickMs;
    this.now = opts.now ?? Date.now;
  }

  /** The cached snapshot, if any, without triggering a read. */
  peek(session: string): WatchSnapshot | null {
    return this.entries.get(session)?.snap ?? null;
  }

  /** Number of boxes currently being tailed (for diagnostics/tests). */
  get active(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.timer || e.inFlight) n++;
    return n;
  }

  /**
   * Latest snapshot for a box. Resolves immediately from cache when fresh; otherwise waits for the
   * in-flight or next read. Either way it marks the box as watched so its loop keeps running.
   */
  read(session: string): Promise<WatchSnapshot> {
    const e = this.entry(session);
    e.lastReadAt = this.now();
    if (e.snap && this.now() - e.at < this.freshMs) {
      this.ensureLoop(session, e);
      return Promise.resolve(e.snap);
    }
    const p = new Promise<WatchSnapshot>((resolve) => e.waiters.push(resolve));
    this.ensureLoop(session, e);
    if (!e.inFlight && !e.timer) void this.tick(session, e);
    else if (!e.inFlight && e.timer) {
      // A slow (terminal) loop is scheduled; a reader wants data now — pull the tick forward.
      clearTimeout(e.timer);
      e.timer = null;
      void this.tick(session, e);
    }
    return p;
  }

  /** Forget a box (after teardown) so a destroyed machine's last log is not served as live. */
  drop(session: string): void {
    const e = this.entries.get(session);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    this.entries.delete(session);
  }

  /** Stop every loop (server shutdown / tests). */
  close(): void {
    for (const s of [...this.entries.keys()]) this.drop(s);
  }

  private entry(session: string): Entry {
    let e = this.entries.get(session);
    if (!e) {
      e = { snap: null, at: 0, lastReadAt: 0, timer: null, inFlight: null, waiters: [], failures: 0 };
      this.entries.set(session, e);
    }
    return e;
  }

  private ensureLoop(session: string, e: Entry): void {
    if (e.timer || e.inFlight) return;
    void this.tick(session, e);
  }

  private async tick(session: string, e: Entry): Promise<void> {
    if (e.inFlight) return;
    e.inFlight = this.readFn(session);
    let snap: WatchSnapshot | null = null;
    try {
      snap = await e.inFlight;
      e.failures = 0;
    } catch {
      // Transient SSH blip: keep the last snapshot, back off a little, try again.
      e.failures++;
    } finally {
      e.inFlight = null;
    }
    if (!this.entries.has(session)) return; // dropped while reading
    if (snap) {
      e.snap = snap;
      e.at = this.now();
      const waiters = e.waiters;
      e.waiters = [];
      for (const w of waiters) w(snap);
    }

    // Keep tailing while someone read recently; otherwise let the entry go quiet (cache retained).
    const idleFor = this.now() - e.lastReadAt;
    if (idleFor > this.graceMs && e.waiters.length === 0) {
      e.timer = null;
      return;
    }
    const terminal = e.snap ? isTerminal(e.snap.runState) || e.snap.boxStatus === "missing" : false;
    const base = terminal ? this.idleTickMs : this.tickMs;
    const backoff = e.failures ? Math.min(base * 2 ** e.failures, 10_000) : base;
    e.timer = setTimeout(() => {
      e.timer = null;
      void this.tick(session, e);
    }, backoff);
  }
}
