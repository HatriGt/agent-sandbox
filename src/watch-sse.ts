/**
 * Server-sent-events (SSE) live stream of one box's `.agent.log`.
 *
 * Why not a real token stream? The in-box agent writes NDJSON that a formatter turns into
 * `.agent.log`; we read that log over the existing multiplexed SSH channel (`gatherWatch`). There is
 * no push from the box to the controller, so "live" here means the CONTROLLER polls the log fast
 * (sub-second) and pushes only the DELTA to each browser over a persistent SSE connection. The heavy
 * 3s client poll becomes a cheap server-side tail; the browser gets near-instant appends.
 *
 * This module is transport-only and deliberately split from http.ts so the delta/offset math is pure
 * and unit-testable (see test/watch-sse.test.ts). It reuses `gatherWatch`, so it inherits the same
 * SSH multiplexing and spawns no new long-lived processes (no `tail -f` to leak) — bounded by one
 * setTimeout loop per connected viewer that stops the instant the client disconnects.
 */
import type { Response } from "express";
import type { WatchSnapshot } from "./monitor.js";

/** How often the controller re-reads the log per connected viewer. Sub-second = feels live. */
export const SSE_TICK_MS = 800;
/** Heartbeat comment cadence, so proxies/browsers keep the idle connection open between deltas. */
export const SSE_HEARTBEAT_MS = 15000;

/**
 * The diff between what a client has already seen (its byte offset into the log) and the latest
 * snapshot. `append` carries only the new tail; `reset` signals the log shrank/replaced (a rare
 * dedupe re-emit or a fresh run) so the client should replace rather than concatenate.
 */
export interface LogDelta {
  /** New bytes to append after the client's current offset, or the full log when kind==="reset". */
  chunk: string;
  /** The client's new offset (== latest log length) to resume from on reconnect. */
  offset: number;
  kind: "append" | "reset" | "none";
}

/**
 * Compute what to send given the client's last-seen offset and the latest log.
 *
 * - grew from a prefix  -> append only the new tail (the common, cheap case)
 * - shrank or diverged  -> reset with the whole log (client replaces its buffer)
 * - unchanged           -> none (nothing to send; a heartbeat will keep the pipe warm)
 */
export function diffLog(prevOffset: number, latest: string, prevLog?: string): LogDelta {
  const len = latest.length;
  // The reader serves a sliding tail window: once it fills, same-length or longer output is NOT a
  // prefix extension. When the previous text is known, a mismatch means "replace", never "append".
  if (prevLog !== undefined && prevLog.length === prevOffset && !latest.startsWith(prevLog)) {
    return len === 0 && prevOffset === 0 ? { chunk: "", offset: 0, kind: "none" } : { chunk: latest, offset: len, kind: "reset" };
  }
  if (len === prevOffset) return { chunk: "", offset: len, kind: "none" };
  if (len > prevOffset) return { chunk: latest.slice(prevOffset), offset: len, kind: "append" };
  // len < prevOffset: the log got shorter than what the client saw — replace wholesale.
  return { chunk: latest, offset: len, kind: "reset" };
}

/** Snapshot fields (everything except the log body) the client needs to render state/vitals. */
export interface SnapshotMeta {
  name: string;
  boxStatus: string;
  runState: WatchSnapshot["runState"];
  exitCode?: number;
  task?: string;
  question?: string;
  uptime?: string;
  cpu?: string;
  mem?: string;
}

export function metaOf(s: WatchSnapshot): SnapshotMeta {
  const { log: _log, ...meta } = s;
  return meta;
}

/**
 * A signature of the meaningful meta fields — the ones a viewer needs a fresh `state` frame for.
 *
 * Deliberately EXCLUDES uptime/cpu/mem: those tick every second, so keying on them made the server
 * emit a `state` frame every 800ms tick even when nothing the user cares about changed (pure
 * chatter). Vitals still ride along inside whatever `snapshot`/`state`/`done` frame the meaningful
 * fields do trigger; they just no longer trigger a frame on their own. runState / boxStatus /
 * exitCode / question (waiting) are what flip the UI's state, so those still push immediately.
 */
export function meaningfulStateKey(m: SnapshotMeta): string {
  return JSON.stringify({
    runState: m.runState,
    boxStatus: m.boxStatus,
    exitCode: m.exitCode ?? null,
    question: m.question ?? null,
    task: m.task ?? null,
  });
}

/** True once the run has reached a terminal state and there is nothing more to stream. */
export function isTerminal(runState: WatchSnapshot["runState"]): boolean {
  return runState === "done" || runState === "idle";
}

/** Serialise one SSE event frame. `id` lets a reconnect resume via Last-Event-ID (we use the offset). */
export function sseFrame(event: string, data: unknown, id?: number): string {
  const lines = [`event: ${event}`];
  if (id != null) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return lines.join("\n") + "\n\n";
}

/** Options for {@link streamWatch}; `read` is injected so tests can drive it without SSH. */
export interface StreamWatchOpts {
  session: string;
  from?: number;
  read: (session: string) => Promise<WatchSnapshot>;
  tickMs?: number;
  heartbeatMs?: number;
}

/**
 * Drive an SSE response for one viewer until the run ends or the client disconnects.
 *
 * Emits: an initial `snapshot` (meta + full log from the requested offset), then `append`/`reset`
 * deltas as the log grows, `state` when runState/exitCode/question change, `:` heartbeats on an idle
 * timer, and a terminal `done` after which the loop stops. Returns a disposer the caller wires to
 * `req.on("close")`; it is also called internally on terminal so the SSH-backed loop never lingers.
 */
export function streamWatch(res: Response, opts: StreamWatchOpts): () => void {
  const tickMs = opts.tickMs ?? SSE_TICK_MS;
  const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Defeat proxy buffering (nginx/traefik) that would otherwise hold events until the buffer fills.
    "X-Accel-Buffering": "no",
  });
  // Tell the client how soon to retry if the connection drops.
  res.write(`retry: 3000\n\n`);

  let offset = Math.max(0, opts.from ?? 0);
  let lastMeta = "";
  let lastRun: WatchSnapshot["runState"] | null = null;
  let sentSnapshot = false;
  let lastLog = "";
  let closed = false;
  let tickTimer: NodeJS.Timeout | undefined;
  let beatTimer: NodeJS.Timeout | undefined;

  const stop = () => {
    if (closed) return;
    closed = true;
    if (tickTimer) clearTimeout(tickTimer);
    if (beatTimer) clearInterval(beatTimer);
  };

  const send = (frame: string): boolean => {
    if (closed) return false;
    return res.write(frame);
  };

  beatTimer = setInterval(() => send(`: ping\n\n`), heartbeatMs);

  const tick = async () => {
    if (closed) return;
    let snap: WatchSnapshot;
    try {
      snap = await opts.read(opts.session);
    } catch {
      // A transient read failure (SSH blip) should not kill the stream; try again next tick.
      if (!closed) tickTimer = setTimeout(tick, tickMs);
      return;
    }
    if (closed) return;

    const meta = metaOf(snap);

    if (!sentSnapshot) {
      // First frame: full state + the log from the requested offset (a reconnect with ?from= gets
      // only the tail it missed; a fresh viewer with from=0 gets everything).
      const initial = offset > 0 && offset <= snap.log.length ? snap.log.slice(offset) : snap.log;
      const startOffset = offset > 0 && offset <= snap.log.length ? offset : 0;
      offset = snap.log.length;
      lastLog = snap.log;
      sentSnapshot = true;
      lastMeta = meaningfulStateKey(meta);
      lastRun = snap.runState;
      send(sseFrame("snapshot", { meta, log: initial, from: startOffset }, offset));
    } else {
      const delta = diffLog(offset, snap.log, lastLog);
      if (delta.kind !== "none") {
        offset = delta.offset;
        lastLog = snap.log;
        send(sseFrame(delta.kind, { chunk: delta.chunk }, offset));
      }
      // Only push a `state` frame when a MEANINGFUL field changed (runState/waiting/exit/box status/
      // task) — not on every uptime tick. This kills the per-800ms chatter while keeping the UI's
      // state transitions instant. Vitals still arrive with the next meaningful frame.
      const key = meaningfulStateKey(meta);
      if (key !== lastMeta) {
        lastMeta = key;
        send(sseFrame("state", { meta }, offset));
      }
    }

    // Terminal: send one final `done` and stop the loop so we stop hitting SSH for a finished run.
    if (isTerminal(snap.runState) && lastRun !== null) {
      send(sseFrame("done", { meta, exitCode: snap.exitCode }, offset));
      // Give the socket a beat to flush, then end it.
      stop();
      try {
        res.end();
      } catch {
        /* already closed */
      }
      return;
    }
    lastRun = snap.runState;
    if (!closed) tickTimer = setTimeout(tick, tickMs);
  };

  void tick();
  return stop;
}
