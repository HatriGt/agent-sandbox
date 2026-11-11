/**
 * The canary: one tiny real task on the live pool, on a timer, so "new tasks do not start" is
 * noticed by the controller and not by the next user. It goes through the SAME path a dashboard
 * delegation takes (warm claim, prep, launch), which is the point — a synthetic probe of the
 * runtime alone would have passed for the whole two weeks the disk was full. The run itself is
 * the cheapest possible turn (one sentence, no tools) and its box is torn down right after.
 *
 * Pure parts (the task text, the verdict, the state machine and the alert policy) live here and
 * are unit-tested; the IO (delegate / read the log / teardown / notify) is injected by http.ts.
 */

export const CANARY_PREFIX = "[canary]";
export const CANARY_TOKEN = "CANARY-OK";
export const CANARY_TASK = `${CANARY_PREFIX} Reply with exactly the word ${CANARY_TOKEN} and nothing else. Do not use any tools.`;

/** The fleet sweep skips canary boxes for notifications, history and memory — they are not the user's runs. */
export function isCanaryTask(task: string | undefined): boolean {
  return !!task && task.trimStart().startsWith(CANARY_PREFIX);
}

export interface CanaryResult {
  ok: boolean;
  /** Milliseconds from the delegate call to the finish (or to the failure). */
  ms: number;
  /** One line: "replied in 9.8s", "exit 1 before the first turn: …", "no finish within 180s". */
  detail: string;
  box?: string;
}

/**
 * Judge a finished (or timed-out) canary run from what the box reports. The token must appear in
 * the agent's output; a clean exit that never said it is still a failure (an agent that cannot
 * answer one sentence is not a working agent).
 */
export function canaryVerdict(x: { runState: string; exitCode?: number; log: string; ms: number; timedOut?: boolean }): Omit<CanaryResult, "box"> {
  const sec = (x.ms / 1000).toFixed(1);
  if (x.timedOut) return { ok: false, ms: x.ms, detail: `no finish within ${sec}s` };
  if (x.runState !== "done") return { ok: false, ms: x.ms, detail: `run state ${x.runState} after ${sec}s` };
  if (x.exitCode !== undefined && x.exitCode !== 0) {
    const tail = x.log.split("\n").map((l) => l.trim()).filter(Boolean).slice(-2).join(" | ");
    return { ok: false, ms: x.ms, detail: `exit ${x.exitCode}${tail ? `: ${tail.slice(0, 200)}` : ""}` };
  }
  if (!x.log.includes(CANARY_TOKEN)) return { ok: false, ms: x.ms, detail: `finished in ${sec}s without saying ${CANARY_TOKEN}` };
  return { ok: true, ms: x.ms, detail: `replied in ${sec}s` };
}

export interface CanaryState extends CanaryResult {
  /** When this result was recorded (ms epoch). */
  at: number;
  /** Consecutive failures so far (0 after a pass). */
  failures: number;
  /** The last pass, kept through a failure so the page can say "last OK 3h ago". */
  lastOkAt?: number;
}

export interface CanaryIO {
  /** Run one canary task end to end and judge it. */
  run: () => Promise<CanaryResult>;
  /** Tell the operator. `recovered` is the pass after a failure. */
  notify: (s: CanaryState, recovered: boolean) => Promise<void> | void;
  log?: (m: string) => void;
  now?: () => number;
}

/**
 * The timer and the alert policy. A failure notifies at once; while it keeps failing, again only
 * after `alertCooldownMs`; the pass that ends a failing stretch notifies once ("recovered"). A pass
 * after a pass is silence. Runs never overlap: a tick that finds one in flight is skipped.
 */
export function makeCanary(io: CanaryIO, opts: { intervalMs: number; alertCooldownMs?: number; firstDelayMs?: number } ) {
  const now = io.now ?? Date.now;
  const log = io.log ?? (() => {});
  const cooldown = opts.alertCooldownMs ?? 6 * 3600_000;
  let state: CanaryState | null = null;
  let inFlight: Promise<CanaryState> | null = null;
  let alertedAt = 0;
  let timer: NodeJS.Timeout | null = null;

  const runOnce = async (): Promise<CanaryState> => {
    const prev = state;
    let r: CanaryResult;
    try {
      r = await io.run();
    } catch (e) {
      r = { ok: false, ms: 0, detail: `canary could not run: ${(e as Error).message.slice(0, 200)}` };
    }
    const failures = r.ok ? 0 : (prev?.failures ?? 0) + 1;
    const next: CanaryState = { ...r, at: now(), failures, ...(r.ok ? { lastOkAt: now() } : prev?.lastOkAt ? { lastOkAt: prev.lastOkAt } : {}) };
    state = next;
    log(`[canary] ${r.ok ? "ok" : "FAIL"} ${r.detail}${r.box ? ` (${r.box})` : ""}`);
    try {
      if (!r.ok && (alertedAt === 0 || now() - alertedAt >= cooldown)) {
        alertedAt = now();
        await io.notify(next, false);
      } else if (r.ok && prev && !prev.ok) {
        alertedAt = 0;
        await io.notify(next, true);
      }
    } catch (e) {
      log(`[canary] notify failed: ${(e as Error).message.slice(0, 200)}`);
    }
    return next;
  };

  const tick = (): Promise<CanaryState> => {
    if (inFlight) return inFlight;
    inFlight = runOnce().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    /** Arm the timer (unref'd: it never keeps the process alive). First run after `firstDelayMs`. */
    start(): void {
      if (opts.intervalMs <= 0 || timer) return;
      const first = setTimeout(() => void tick(), opts.firstDelayMs ?? Math.min(opts.intervalMs, 5 * 60_000));
      first.unref?.();
      timer = setInterval(() => void tick(), opts.intervalMs);
      timer.unref?.();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Run one now (shares an in-flight run instead of starting a second). */
    runNow: tick,
    state: (): CanaryState | null => (state ? { ...state } : null),
  };
}

/** The alert line for the operator's channel. */
export function canaryAlertText(s: CanaryState, recovered: boolean, publicUrl: string): string {
  const where = publicUrl ? ` ${publicUrl.replace(/\/+$/, "")}/dashboard/#/sandboxes` : "";
  if (recovered) return `Canary recovered: a task starts and finishes again (${s.detail}).${where}`;
  return `Canary failed${s.failures > 1 ? ` ${s.failures} times in a row` : ""}: a new task does not finish — ${s.detail}.${where}`;
}
