/**
 * Block-until-boundary — the core of interactive A2A (Agent-to-Agent).
 *
 * `delegate`/`resume` launch the in-box agent and then WAIT here, server-side, until the agent
 * reaches an interactive boundary or a timeout fires. A boundary is the moment the caller actually
 * has something to act on:
 *   - `waiting` — the agent wrote a question to /workspace/.agent.question and paused, OR
 *   - `done`    — the run finished (exit code recorded).
 * `running`/`idle` are NOT boundaries: keep waiting.
 *
 * This is what makes the two agents "take turns": the MCP tool call stays open (the wait loop is the
 * listener) and returns the instant the box needs a decision or is finished — so the calling agent
 * cannot end its turn early. A bounded timeout returns `reached:false` so a genuinely long step
 * (big build) never hangs the client past its HTTP timeout; the caller reconnects via `status`.
 *
 * Pure by construction: all IO (the SSH poll) and time (sleep/now) are injected, so the loop is
 * unit-tested with no VPS and no real timers.
 */
import type { RunState } from "./monitor.js";

/** A boundary is a state the caller must act on: a pending question, or a finished run. */
export function isBoundary(state: RunState): boolean {
  return state === "waiting" || state === "done";
}

/** One poll result: the classified run state plus the human status text to hand back. */
export interface PollResult {
  state: RunState;
  text: string;
}

export interface WaitOpts {
  /** Read the box's current run state + status text (one SSH round-trip in prod). */
  poll: () => Promise<PollResult>;
  /** Sleep helper (injected so tests use a virtual clock). */
  sleep: (ms: number) => Promise<void>;
  /** Wall clock (injected; defaults to Date.now). */
  now?: () => number;
  /** Give up after this long and return reached:false (caller reconnects via status). */
  timeoutMs: number;
  /** Delay between polls. */
  intervalMs: number;
}

export interface WaitResult {
  /** true = hit a boundary (waiting/done); false = timed out still running. */
  reached: boolean;
  /** The last observed state. */
  state: RunState;
  /** The last status text (the question when waiting, the result when done). */
  text: string;
}

/**
 * Poll until a boundary or the deadline. Polls first (no initial sleep) so an already-waiting/done
 * box returns immediately; otherwise sleeps `intervalMs` between polls. A transient poll error is
 * swallowed (an SSH blip shouldn't abort the whole wait) — it's treated like a non-boundary tick.
 */
export async function waitForBoundary(opts: WaitOpts): Promise<WaitResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.timeoutMs;
  let last: PollResult = { state: "running", text: "" };

  // First poll happens immediately; subsequent iterations sleep first, then re-check the deadline.
  for (let first = true; ; first = false) {
    if (!first) {
      await opts.sleep(opts.intervalMs);
      if (now() > deadline) return { reached: false, state: last.state, text: last.text };
    }
    try {
      last = await opts.poll();
      if (isBoundary(last.state)) return { reached: true, state: last.state, text: last.text };
    } catch {
      // transient (e.g. SSH blip) — treat as a non-boundary tick and keep waiting.
    }
    if (first && now() > deadline) return { reached: false, state: last.state, text: last.text };
  }
}
