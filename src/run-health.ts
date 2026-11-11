/**
 * Run health: the failures that are not the agent's.
 *
 * For two weeks every run in the claude tier died before its first turn (the 1G disk was full, see
 * msb.ts preinstallSh) and nothing said so: the dashboard showed a box that started and stopped, the
 * notification said "failed (exit 1)", and the operator read 55 of those as the agent's problem. A
 * run that ends without ever having a turn is a different kind of failure — the sandbox could not
 * start it — and this module names it, so the thread can say "failed to start", the notification
 * can carry the last lines the box wrote, and a STREAK of them can wake the operator the same hour
 * instead of the same month. Pure: the fleet sweep (http.ts) feeds it and acts on its answers.
 */
import type { TraceEvent } from "./trace.js";

/**
 * Exit code the controller records when a run was NOT started because the box's disk could not
 * hold it (runAgentTask's preflight). Reserved next to the wrapper's own 254/253 (msb.ts).
 */
export const EXIT_DISK_FULL = 250;

/** Human notes for the non-agent exit codes, shared by the digest and the notification. */
export const EXIT_NOTES: Record<number, string> = {
  254: "interrupted (restart or send-now)",
  253: "stopped by the operator",
  [EXIT_DISK_FULL]: "not started: the sandbox disk is full",
};

/**
 * Did the agent get a turn? The formatter stamps `● session started` (a lifecycle event) the moment
 * the CLI's init frame arrives, and every tool call / plan / thought / usage line is the agent at
 * work. What a run that died BEFORE that leaves in the log is only raw stderr — which parseTrace
 * renders as prose — so "has a say event" would wrongly count the error text as a turn.
 */
export function hadAgentTurn(events: readonly TraceEvent[]): boolean {
  return events.some((e) => e.kind === "lifecycle" || e.kind === "tool" || e.kind === "plan" || e.kind === "think" || e.kind === "usage");
}

/** A non-zero finish with no turn behind it: the sandbox failed the run, not the agent. */
export function isStartFailure(exitCode: number | undefined, events: readonly TraceEvent[]): boolean {
  return exitCode !== undefined && exitCode !== 0 && !hadAgentTurn(events);
}

/**
 * The last lines the box wrote, for a notification or a thread note: sentinel lines (the
 * formatter's `⟦…⟧` stamps) dropped, blank lines dropped, bounded in lines and characters so a
 * stack trace reads as its last few frames rather than the whole thing.
 */
export function logTail(log: string, lines = 6, maxChars = 480): string {
  const kept = log
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trimEnd())
    .filter((l) => l.trim() && !/^\s*⟦/.test(l) && !/^​?[●→]/.test(l));
  let out = kept.slice(-lines).join("\n");
  if (out.length > maxChars) out = "…" + out.slice(-maxChars);
  return out;
}

export interface StartFailureState {
  /** Consecutive start failures across the fleet; any finish with a turn resets it. */
  streak: number;
  /** The most recent one, for the alert text. */
  last?: { box: string; at: number; tail: string };
  /** When the operator alert last went out (0 = never). */
  alertedAt: number;
}

/**
 * Counts start failures across the fleet and decides when the operator should hear about it: the
 * THRESHOLD-th consecutive one fires, then not again until the cooldown has passed (a streak that
 * keeps growing is one incident, not one alert per run). A finish that had a turn ends the streak —
 * the sandbox can start runs again, whatever the agent then did.
 */
export class StartFailureStreak {
  private s: StartFailureState = { streak: 0, alertedAt: 0 };
  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 6 * 3600_000,
    private readonly now: () => number = Date.now
  ) {}

  /** Record one finish. Returns the streak after it and whether this one should alert. */
  record(box: string, startFailed: boolean, tail = ""): { streak: number; alert: boolean } {
    if (!startFailed) {
      this.s.streak = 0;
      return { streak: 0, alert: false };
    }
    this.s.streak += 1;
    this.s.last = { box, at: this.now(), tail };
    const due = this.s.streak >= this.threshold && this.now() - this.s.alertedAt >= this.cooldownMs;
    if (due) this.s.alertedAt = this.now();
    return { streak: this.s.streak, alert: due };
  }

  state(): StartFailureState {
    return { ...this.s, ...(this.s.last ? { last: { ...this.s.last } } : {}) };
  }
}

/** The one-line alert, leading with the count (the operator reads this on a phone). */
export function startFailureAlertText(streak: number, last: { box: string; tail: string } | undefined, publicUrl: string): string {
  const where = publicUrl ? ` ${publicUrl.replace(/\/+$/, "")}/dashboard/#/box/${last?.box ?? ""}` : "";
  const tail = last?.tail ? ` Last lines: ${last.tail.split("\n").slice(-2).join(" | ")}` : "";
  return `${streak} runs in a row died before their first turn — the sandboxes are failing to start, not the agent.${tail}${where}`;
}
