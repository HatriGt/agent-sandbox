/**
 * What the agent SAID it would do, joined to what it actually did.
 *
 * A TodoWrite plan is re-emitted whole on every change, so the log holds a series of snapshots with
 * the agent's real work interleaved between them:
 *
 *     ⟦plan⟧ 1756713600000   [>] Wire the parser        <- step becomes in progress here
 *     → Read: /workspace/src/trace.ts
 *     → Edit: /workspace/src/trace.ts
 *     ⟦plan⟧ 1756713609000   [x] Wire the parser        <- and finishes here
 *
 * Everything between two consecutive snapshots belongs to whichever step was in progress in the
 * FIRST of them. That single rule turns the flat log into per-step evidence — files written, commands
 * run, how long it took — with no extra instrumentation in the box. All of it is observed fact; a
 * step the agent never marked in progress simply has no evidence, and says so by showing none.
 *
 * Pure and dependency-free so the server's `node:test` suite covers it directly.
 */

import type { PlanItem, TraceEvent } from "./trace";

/** Tools that CHANGE a file. Read/Glob/Grep are research — they count as steps, not as files touched. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export interface TaskEvidence {
  /** Distinct paths written while this step was in progress, in the order first written. */
  files: string[];
  /** Distinct shell commands run while this step was in progress. */
  commands: string[];
  /** Every tool call attributed to the step, including reads and searches. */
  steps: number;
  /** Calls that are neither a write nor a command — reads, searches — counted by tool name. */
  others: { name: string; n: number }[];
  /** At least one attributed tool call came back as an error. */
  failed: boolean;
  /** Time in progress, summed over every window the step was active. Absent on logs with no stamps. */
  ms?: number;
  /** The most recent attributed call — what the step is doing right now, while it is still active. */
  latest?: { name: string; arg?: string };
}

export interface DerivedTask extends PlanItem {
  evidence: TaskEvidence;
}

export interface TaskBoard {
  tasks: DerivedTask[];
  done: number;
  /** True once every step is done. */
  complete: boolean;
  /** Number of plan snapshots — how many times the agent rewrote its own plan. */
  revisions: number;
  /** Total time across all attributed windows, when the log carries stamps. */
  ms?: number;
}

function blank(): TaskEvidence {
  return { files: [], commands: [], steps: 0, failed: false, others: [] };
}

/** Strip the workspace prefix so a chip reads `src/trace.ts`, not `/workspace/src/trace.ts`. */
export function shortPath(p: string): string {
  return p.replace(/^\/workspace\/?/, "").replace(/^\/+/, "") || p;
}

/**
 * Fold a trace into the latest plan plus the evidence each step accumulated. Returns null when the
 * agent never wrote a plan — most short runs, which should show no board at all rather than an empty one.
 */
export function deriveTaskBoard(events: TraceEvent[]): TaskBoard | null {
  // Keyed by step text: the agent edits statuses far more often than wording, and a step that goes
  // active → todo → active again must accumulate into one bucket rather than split in two.
  const acc = new Map<string, TaskEvidence>();
  const evidence = (key: string): TaskEvidence => {
    let e = acc.get(key);
    if (!e) acc.set(key, (e = blank()));
    return e;
  };

  let latest: PlanItem[] | null = null;
  let revisions = 0;
  // The step currently collecting work, and when its window opened.
  let openKey: string | null = null;
  let openAt: number | undefined;

  for (const ev of events) {
    if (ev.kind === "plan") {
      // Close the window the previous snapshot opened before starting a new one.
      if (openKey !== null && openAt !== undefined && ev.at !== undefined) {
        const e = evidence(openKey);
        e.ms = (e.ms ?? 0) + Math.max(0, ev.at - openAt);
      }
      latest = ev.items;
      revisions += 1;
      const active = ev.items.find((i) => i.state === "active");
      openKey = active ? active.text : null;
      openAt = ev.at;
      continue;
    }
    if (ev.kind === "tool" && openKey !== null) {
      const e = evidence(openKey);
      e.steps += 1;
      if (ev.failed) e.failed = true;
      e.latest = { name: ev.name, arg: ev.arg };
      const arg = (ev.arg ?? "").trim();
      if (ev.name === "Bash") {
        if (arg && !e.commands.includes(arg)) e.commands.push(arg);
      } else if (WRITE_TOOLS.has(ev.name)) {
        if (arg && !e.files.includes(arg)) e.files.push(arg);
      } else {
        // Named rather than lumped into a bare count: "Read ×2 · Grep ×1" tells the reader what the
        // step spent its calls on, which a number cannot.
        const hit = e.others.find((o) => o.name === ev.name);
        if (hit) hit.n += 1;
        else e.others.push({ name: ev.name, n: 1 });
      }
    }
  }

  if (!latest) return null;

  const tasks: DerivedTask[] = latest.map((i) => ({ ...i, evidence: acc.get(i.text) ?? blank() }));
  const done = tasks.filter((t) => t.state === "done").length;
  const total = tasks.reduce((n, t) => n + (t.evidence.ms ?? 0), 0);
  return {
    tasks,
    done,
    complete: tasks.length > 0 && done === tasks.length,
    revisions,
    ms: total > 0 ? total : undefined,
  };
}

/** `9s`, `2m 40s`, `1h 04m` — the console's duration voice, compact enough for a chip. */
export function shortDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}
