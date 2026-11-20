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

/**
 * Join a tail window onto the full log seen so far. The reader serves only the last ~128 KB, so once
 * a run outgrows it every tick's window starts later; the new text is whatever follows the point
 * where the previous full log's end sits inside the window. Returns null when the window no longer
 * overlaps (the log was replaced, or it grew past a whole window between reads) — the caller then
 * re-reads the whole file. A window that is the whole file (`truncated` false) IS the full log.
 */
export function stitchLog(prev: string, win: string, truncated: boolean): string | null {
  if (!truncated) return win;
  if (!prev) return null;
  if (win.length === 0 || prev.endsWith(win)) return prev;
  // The window's first line may start mid-character or mid-line (tail -c): never compare it.
  const firstNl = win.indexOf("\n");
  // A long anchor finds the seam in one pass; a short one covers a window that moved by most of itself.
  for (const size of [512, 48]) {
    const anchorLen = Math.min(prev.length, size);
    const anchor = prev.slice(prev.length - anchorLen);
    for (let i = win.indexOf(anchor); i >= 0; i = win.indexOf(anchor, i + 1)) {
      const end = i + anchorLen;
      const from = firstNl >= 0 && firstNl < i ? firstNl + 1 : i;
      if (prev.endsWith(win.slice(from, end))) return prev + win.slice(end);
    }
  }
  return null;
}

export interface WatchHubOpts {
  /** Reads one fresh snapshot (the SSH-backed gatherWatch in production). */
  read: (session: string) => Promise<WatchSnapshot>;
  /** Reads the whole log (redacted) for readFull when the snapshot's tail window is truncated. */
  readLog?: (session: string) => Promise<string>;
  /**
   * The box cannot be read right now and nobody should try (its host is asleep or its VM paused: an
   * SSH would hang, or wake a metered VM for a look). The last snapshot is served as fresh instead.
   */
  skip?: (session: string) => boolean;
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
  /** When the read that produced `snap` began: a reader who needs the state after a moment compares against this. */
  begunAt: number;
  lastReadAt: number;
  timer: NodeJS.Timeout | null;
  inFlight: Promise<WatchSnapshot> | null;
  waiters: Array<{ resolve: (s: WatchSnapshot) => void; reject: (e: Error) => void; after?: number }>;
  failures: number;
  /** The whole log stitched from the tail windows, once a readFull asked for it. */
  full?: string;
  fullLoading?: Promise<void> | null;
}

export class WatchHub {
  private readonly entries = new Map<string, Entry>();
  private readonly tickMs: number;
  private readonly idleTickMs: number;
  private readonly graceMs: number;
  private readonly freshMs: number;
  private readonly now: () => number;
  private readonly readFn: (session: string) => Promise<WatchSnapshot>;
  private readonly skipFn?: (session: string) => boolean;
  private readonly readLogFn?: (session: string) => Promise<string>;

  constructor(opts: WatchHubOpts) {
    this.readFn = opts.read;
    this.skipFn = opts.skip;
    this.readLogFn = opts.readLog;
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
   * With `after` (ms), only a snapshot whose read BEGAN at or after that moment will do: a cached
   * or in-flight read from before it is not served, the next one is (the sleep route asks for the
   * state after the turn it started itself; a read from before the reply still says "done").
   */
  read(session: string, after?: number): Promise<WatchSnapshot> {
    const e = this.entry(session);
    e.lastReadAt = this.now();
    if (e.snap && this.now() - e.at < this.freshMs && (after == null || e.begunAt >= after)) {
      this.ensureLoop(session, e);
      return Promise.resolve(e.snap);
    }
    const p = new Promise<WatchSnapshot>((resolve, reject) => e.waiters.push({ resolve, reject, after }));
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

  /**
   * Like read(), but `log` is the WHOLE conversation rather than the tail window: the live thread
   * reads through here so a long run never loses its beginning, and its stream only ever grows by
   * appends (the window sliding used to reset the whole transcript every tick). The full text is
   * read once per box and then extended from each tick's window.
   */
  async readFull(session: string): Promise<WatchSnapshot> {
    const snap = await this.read(session);
    const e = this.entries.get(session);
    if (!e) return snap;
    if (e.full === undefined) {
      if (!snap.logTruncated || !this.readLogFn) {
        e.full = snap.log;
      } else {
        if (!e.fullLoading) {
          const readLog = this.readLogFn;
          e.fullLoading = readLog(session)
            .then((whole) => {
              const cur = e.snap ?? snap;
              e.full = stitchLog(whole, cur.log, true) ?? (whole.length >= cur.log.length ? whole : cur.log);
            })
            .catch(() => {
              // Fall back to the window; the next readFull tries the whole file again.
            })
            .finally(() => {
              e.fullLoading = null;
            });
        }
        await e.fullLoading;
        if (e.full === undefined) return snap;
      }
    }
    return { ...(e.snap ?? snap), log: e.full };
  }

  /** Forget a box (after teardown) so a destroyed machine's last log is not served as live. */
  drop(session: string): void {
    const e = this.entries.get(session);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    this.entries.delete(session);
    // Nobody may hang on a box that no longer exists: hand out the last snapshot, or fail fast.
    const waiters = e.waiters;
    e.waiters = [];
    for (const w of waiters) (e.snap ? w.resolve(e.snap) : w.reject(new Error(`no snapshot for ${session}: box gone`)));
  }

  /** Stop every loop (server shutdown / tests). */
  close(): void {
    for (const s of [...this.entries.keys()]) this.drop(s);
  }

  /**
   * Evict quiet entries nobody has read for an hour. Boxes torn down through the controller get
   * drop()ed explicitly, but pool-reaped or externally removed boxes never do — without this each
   * one parks its last snapshot (often hundreds of KB of log) in the map forever.
   */
  private prune(pruneAfterMs = 60 * 60_000): void {
    const cutoff = this.now() - pruneAfterMs;
    for (const [s, e] of this.entries) {
      if (!e.timer && !e.inFlight && e.waiters.length === 0 && e.lastReadAt < cutoff) this.entries.delete(s);
    }
  }

  private entry(session: string): Entry {
    let e = this.entries.get(session);
    if (!e) {
      e = { snap: null, at: 0, begunAt: 0, lastReadAt: 0, timer: null, inFlight: null, waiters: [], failures: 0 };
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
    let snap: WatchSnapshot | null = null;
    // Parked: the host is asleep or paused, so the last snapshot stands in for a read (nothing
    // SSHes it) and the loop idles at the terminal cadence until the host is back.
    const parked = !!e.snap && !!this.skipFn?.(session);
    const begun = this.now();
    if (parked) {
      snap = e.snap;
      e.failures = 0;
    } else {
      e.inFlight = this.readFn(session);
      try {
        snap = await e.inFlight;
        e.failures = 0;
      } catch {
        // Transient SSH blip: keep the last snapshot, back off a little, try again.
        e.failures++;
      } finally {
        e.inFlight = null;
      }
    }
    if (!this.entries.has(session)) return; // dropped while reading (drop() settled the waiters)
    if (snap) {
      e.snap = snap;
      e.at = this.now();
      if (!parked) e.begunAt = begun;
      if (e.full !== undefined && !e.fullLoading) {
        const next = stitchLog(e.full, snap.log, !!snap.logTruncated);
        // No overlap: drop the stitched copy; the next readFull re-reads the whole file.
        if (next === null) e.full = undefined;
        else e.full = next;
      }
      // A parked host's stand-in answers everyone; a real read answers those it is recent enough for.
      const served = e.waiters.filter((w) => parked || w.after == null || w.after <= begun);
      e.waiters = e.waiters.filter((w) => !served.includes(w));
      for (const w of served) w.resolve(snap);
      if (e.waiters.length && this.entries.has(session)) {
        // Someone needs a read that begins after a moment this one did not: go again now.
        void this.tick(session, e);
        return;
      }
    } else if (e.failures >= 3 && e.waiters.length) {
      // Three misses in a row: readers get the error instead of waiting forever.
      const waiters = e.waiters;
      e.waiters = [];
      const err = new Error(`could not read ${session} (${e.failures} failed attempts)`);
      for (const w of waiters) (e.snap ? w.resolve(e.snap) : w.reject(err));
    }

    // Keep tailing while someone read recently; otherwise let the entry go quiet (cache retained).
    const idleFor = this.now() - e.lastReadAt;
    if (idleFor > this.graceMs && e.waiters.length === 0) {
      e.timer = null;
      this.prune();
      return;
    }
    const terminal = parked || (e.snap ? isTerminal(e.snap.runState) || e.snap.boxStatus === "missing" || e.snap.boxStatus === "stopped" : false);
    const base = terminal ? this.idleTickMs : this.tickMs;
    const backoff = e.failures ? Math.min(base * 2 ** e.failures, 10_000) : base;
    e.timer = setTimeout(() => {
      e.timer = null;
      void this.tick(session, e);
    }, backoff);
  }
}
