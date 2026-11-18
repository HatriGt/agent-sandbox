/**
 * What a launch is doing between "Send" and the agent's first words, told to the browser as it
 * happens. The dashboard's delegate POST returns only once the agent is launched (10 s warm, a
 * minute or more cold or on a paused host), and the thread then shows nothing until the first log
 * frame — a skeleton with no story. Every real stage of that window already exists in code (host
 * pick, clone, warm claim or cold boot, repo setup, agent exec); this module is the one place they
 * are named, recorded per launch, and streamed to whoever is watching that launch.
 *
 * The browser mints the launch id (so it can subscribe before the POST is even answered), sends it
 * in the delegate body, and tails `/launch.sse?id=`. An entry belongs to the principal that opened
 * it; a viewer with another owner is refused. Entries are small and short-lived: dropped ten
 * minutes after they close, or after half an hour if a launch never closes (a crashed flow).
 *
 * Pure registry — no IO — so the replay/subscribe/close rules are unit tested (test/launch-progress.test.ts).
 */

export type LaunchPhase =
  /** The POST reached the controller; the task is being checked. */
  | "accepted"
  /** Repository access is being resolved (which account clones, which token). */
  | "access"
  /** A box host is being picked; `detail` names a host being woken from a pause. */
  | "host"
  /** A repository is being cloned into staging; `detail` is owner/name. */
  | "clone"
  /** A sandbox is being claimed (warm) or booted (cold); `detail` is "warm" | "cold". */
  | "sandbox"
  /** A known repo setup profile is being applied (dependencies installed). */
  | "setup"
  /** The agent process is being started in the box. */
  | "agent"
  /** The agent is running; `detail` is the box name. The flow is over for the controller. */
  | "started"
  /** The launch failed; `detail` is the reason. */
  | "failed";

export interface LaunchStep {
  phase: LaunchPhase;
  /** Sentence-case, present tense, what is happening now. */
  label: string;
  detail?: string;
  at: number;
}

/** The label for each phase — one source of truth, so the browser never invents a stage. */
export function launchLabel(phase: LaunchPhase, detail?: string): string {
  switch (phase) {
    case "accepted":
      return "Checking the task";
    case "access":
      return "Resolving repository access";
    case "host":
      return detail ? `Waking the ${detail} host` : "Picking a host";
    case "clone":
      return detail ? `Cloning ${detail}` : "Cloning the repository";
    case "sandbox":
      return detail === "warm" ? "Claiming a warm sandbox" : detail === "cold" ? "Booting a fresh sandbox" : "Getting a sandbox";
    case "setup":
      return "Installing dependencies";
    case "agent":
      return "Starting the agent";
    case "started":
      return "Agent started";
    case "failed":
      return "Could not start";
  }
}

export type LaunchReporter = (phase: LaunchPhase, detail?: string) => void;

/** A launch id is minted by the browser: letters, digits, dashes, long enough not to be guessed. */
export const LAUNCH_ID_RE = /^[A-Za-z0-9_-]{12,64}$/;

export function isLaunchId(v: unknown): v is string {
  return typeof v === "string" && LAUNCH_ID_RE.test(v);
}

interface Entry {
  owner: string;
  steps: LaunchStep[];
  closed: boolean;
  openedAt: number;
  closedAt?: number;
  subs: Set<Subscriber>;
}

interface Subscriber {
  owner: string;
  onStep: (step: LaunchStep, index: number) => void;
  onClose: () => void;
}

/** How long a closed entry stays replayable (a late subscriber, a reconnect). */
export const LAUNCH_KEEP_MS = 10 * 60_000;
/** A launch that never closed (the flow threw past the reporter) is forgotten after this. */
export const LAUNCH_ORPHAN_MS = 30 * 60_000;

export class LaunchRegistry {
  private entries = new Map<string, Entry>();
  /** Viewers that subscribed before the POST opened the entry, keyed by id. */
  private waiting = new Map<string, Set<Subscriber>>();
  constructor(private now: () => number = Date.now) {}

  /** The POST arrived: start the record and attach anyone already waiting on this id. */
  open(id: string, owner: string): LaunchReporter {
    this.sweep();
    let e = this.entries.get(id);
    if (!e) {
      e = { owner, steps: [], closed: false, openedAt: this.now(), subs: new Set() };
      this.entries.set(id, e);
      const w = this.waiting.get(id);
      if (w) {
        this.waiting.delete(id);
        for (const s of w) {
          // A viewer who is not this launch's owner learns nothing: its stream just ends.
          if (s.owner === owner) e.subs.add(s);
          else s.onClose();
        }
      }
    }
    const entry = e;
    return (phase, detail) => this.note(entry, phase, detail);
  }

  private note(e: Entry, phase: LaunchPhase, detail?: string): void {
    if (e.closed) return;
    const step: LaunchStep = { phase, label: launchLabel(phase, detail), ...(detail ? { detail } : {}), at: this.now() };
    e.steps.push(step);
    const index = e.steps.length - 1;
    for (const s of e.subs) s.onStep(step, index);
    if (phase === "started" || phase === "failed") this.close(e);
  }

  private close(e: Entry): void {
    if (e.closed) return;
    e.closed = true;
    e.closedAt = this.now();
    for (const s of e.subs) s.onClose();
    e.subs.clear();
  }

  /** Force-close a launch that ended without a terminal step (the flow threw before `started`). */
  fail(id: string, reason: string): void {
    const e = this.entries.get(id);
    if (!e || e.closed) return;
    this.note(e, "failed", reason.slice(0, 200));
  }

  steps(id: string): LaunchStep[] | undefined {
    return this.entries.get(id)?.steps;
  }

  /**
   * Tail a launch: every step so far (from `from`, an index) is replayed, then new ones arrive
   * live, then `onClose` when the launch has started or failed. Returns the unsubscribe. An id
   * that is not open yet is waited on (the browser subscribes while its POST is in flight); a
   * closed entry replays and closes at once; another owner's entry is refused (`false`).
   */
  subscribe(id: string, sub: Subscriber, from = 0): (() => void) | false {
    this.sweep();
    const e = this.entries.get(id);
    if (!e) {
      let w = this.waiting.get(id);
      if (!w) this.waiting.set(id, (w = new Set()));
      w.add(sub);
      return () => {
        w!.delete(sub);
        if (!w!.size) this.waiting.delete(id);
      };
    }
    if (e.owner !== sub.owner) return false;
    for (let i = Math.max(0, from); i < e.steps.length; i++) sub.onStep(e.steps[i], i);
    if (e.closed) {
      sub.onClose();
      return () => {};
    }
    e.subs.add(sub);
    return () => e.subs.delete(sub);
  }

  /** Drop what nobody can use any more. Called on open/subscribe, so no timer is needed. */
  sweep(): void {
    const t = this.now();
    for (const [id, e] of this.entries) {
      if (e.closed ? t - (e.closedAt ?? t) > LAUNCH_KEEP_MS : t - e.openedAt > LAUNCH_ORPHAN_MS) {
        this.close(e);
        this.entries.delete(id);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
