/**
 * The launch story: what a task is doing between Send and the agent's first words, as rows for
 * the launch bubble. The controller names each stage as it starts (src/launch-progress.ts:
 * accepted → access → host → clone → sandbox → setup → agent → started); the browser adds the two
 * stages only it can see — the request leaving, and the wait for the first log frame after the
 * agent has started. Pure, so the row rules are unit tested (test/launch-rows.test.ts).
 */

export type LaunchPhase = "accepted" | "access" | "host" | "clone" | "sandbox" | "setup" | "agent" | "started" | "failed";

export interface LaunchStep {
  phase: LaunchPhase;
  label: string;
  detail?: string;
  /** When this tab received the step (the controller's clock is not ours). */
  at: number;
}

export interface LaunchRow {
  key: string;
  label: string;
  /** The failure reason, on a failed row. */
  detail?: string;
  state: "done" | "active" | "failed";
  /** When the row started, this tab's clock. */
  at: number;
  /** How long a done row took, ms. */
  took?: number;
}

/** A launch id the controller accepts (its LAUNCH_ID_RE): letters, digits, dashes, 12 to 64 long. */
export function newLaunchId(): string {
  const rnd = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  return `l-${Date.now().toString(36)}-${rnd}`;
}

/**
 * The rows to show. Every stage so far, done ones with how long they took, the current one active;
 * then, once the agent has started, the wait for its first words. A launch whose stages never
 * arrive (an older controller, a group of attempts) still progresses on what the tab knows: the
 * request going out, then the machine it was given.
 */
export function launchRows(steps: LaunchStep[], o: { sentAt: number; machine?: string; now: number }): LaunchRow[] {
  const rows: LaunchRow[] = [];
  const firstAt = steps[0]?.at;
  rows.push({ key: "send", label: "Sending the task", state: "done", at: o.sentAt, took: Math.max(0, (firstAt ?? o.now) - o.sentAt), ...(firstAt === undefined && !o.machine ? { state: "active" as const, took: undefined } : {}) });
  steps.forEach((s, i) => {
    const next = steps[i + 1];
    if (s.phase === "failed") {
      rows.push({ key: `${i}:${s.phase}`, label: s.label, detail: s.detail, state: "failed", at: s.at });
      return;
    }
    rows.push({ key: `${i}:${s.phase}`, label: s.label, state: next || s.phase === "started" ? "done" : "active", at: s.at, ...(next ? { took: Math.max(0, next.at - s.at) } : s.phase === "started" ? { took: 0 } : {}) });
  });
  const last = steps[steps.length - 1];
  if (last?.phase === "started") {
    rows.push({ key: "words", label: "Waiting for the first words", state: "active", at: last.at });
  } else if (!last && o.machine) {
    // Delegate answered but no stages came: the tab knows only the machine.
    rows.push({ key: "connect", label: `Connecting to ${o.machine}`, state: "active", at: o.sentAt });
  }
  return rows;
}

/** After this long on one stage the bubble says so; a paused host takes minutes to resume. */
export function stuckAfterMs(row: LaunchRow): number {
  return /^Waking the /.test(row.label) ? 150_000 : /^Booting a fresh/.test(row.label) ? 90_000 : 45_000;
}

/** "warm" | "cold" | undefined, from the sandbox stage's detail. */
export function launchKind(steps: LaunchStep[]): "warm" | "cold" | undefined {
  const s = steps.find((x) => x.phase === "sandbox" && (x.detail === "warm" || x.detail === "cold"));
  return s?.detail as "warm" | "cold" | undefined;
}
