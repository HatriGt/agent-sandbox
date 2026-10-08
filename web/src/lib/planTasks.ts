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
  /** The most recent attributed call that came back as an error — the reason a failed step shows. */
  failedCall?: { name: string; arg?: string };
}

export interface DerivedTask extends PlanItem {
  evidence: TaskEvidence;
}

/** What the LAST plan rewrite did to the step list, so the board can say it instead of silently swapping. */
export interface PlanChanges {
  /** Step texts present in the latest snapshot but not the previous one. */
  added: string[];
  /** Step texts present in the previous snapshot but gone from the latest. */
  removed: string[];
  /** Steps whose wording changed in place — close enough to read as an edit, not a swap. */
  reworded: { from: string; to: string }[];
  /** True when surviving steps changed their relative order. */
  reordered?: boolean;
  /** Stamp of the snapshot that made the change, when the log carries stamps. */
  at?: number;
}

export interface TaskBoard {
  tasks: DerivedTask[];
  done: number;
  /** True once every step is done. */
  complete: boolean;
  /** Number of plan snapshots — how many times the agent rewrote its own plan. */
  revisions: number;
  /** The diff the last revision made to the step list; absent when it only moved statuses. */
  changes?: PlanChanges;
  /** Total time across all attributed windows, when the log carries stamps. */
  ms?: number;
  /** Stamp of the snapshot that put the current active step in progress — the open window a live row ticks from. */
  activeSince?: number;
}

function blank(): TaskEvidence {
  return { files: [], commands: [], steps: 0, failed: false, others: [] };
}

/** Strip the workspace prefix so a chip reads `src/trace.ts`, not `/workspace/src/trace.ts`. */
export function shortPath(p: string): string {
  return p.replace(/^\/workspace\/?/, "").replace(/^\/+/, "") || p;
}

const words = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * Dice coefficient over word sets — enough to tell "Add tests" → "Add burst tests" (a rewording) from
 * "Add tests" → "Open a pull request" (a different step). Dependency-free on purpose.
 */
export function stepSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return (2 * shared) / (wa.size + wb.size);
}

const REWORD_MIN = 0.5;

/**
 * Diff two snapshots by step text. A step that vanished at one position while a similar one appeared
 * at the same position is a rewording; anything else is a removal plus an addition. Returns null when
 * only statuses moved — the common case, which should not be reported as a change at all.
 */
export function diffPlan(prev: PlanItem[], next: PlanItem[], at?: number): PlanChanges | null {
  const prevTexts = prev.map((i) => i.text);
  const nextTexts = next.map((i) => i.text);
  const prevSet = new Set(prevTexts);
  const nextSet = new Set(nextTexts);
  const gone = prevTexts.filter((t) => !nextSet.has(t));
  const fresh = nextTexts.filter((t) => !prevSet.has(t));
  const reworded: { from: string; to: string }[] = [];
  const removed: string[] = [];
  const added = new Set(fresh);
  for (const from of gone) {
    const pos = prevTexts.indexOf(from);
    const to = nextTexts[pos];
    if (to !== undefined && added.has(to) && stepSimilarity(from, to) >= REWORD_MIN) {
      reworded.push({ from, to });
      added.delete(to);
    } else {
      removed.push(from);
    }
  }
  // Reorder: the survivors (by text, rewordings mapped forward) must keep their relative order.
  const forward = new Map(reworded.map((r) => [r.from, r.to]));
  const survivors = prevTexts.map((t) => forward.get(t) ?? t).filter((t) => nextSet.has(t));
  const kept = nextTexts.filter((t) => survivors.includes(t));
  const reordered = survivors.some((t, i) => kept[i] !== t);
  if (!added.size && !removed.length && !reworded.length && !reordered) return null;
  return {
    added: [...added],
    removed,
    reworded,
    ...(reordered ? { reordered } : {}),
    ...(at !== undefined ? { at } : {}),
  };
}

const clip = (t: string, n = 32): string => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** `1 step added, 1 removed` · `reworded 'Add tests' → 'Add burst tests'` — the note under the header. */
export function describeChanges(c: PlanChanges): string {
  const parts: string[] = [];
  if (c.added.length) parts.push(`${c.added.length} step${c.added.length === 1 ? "" : "s"} added`);
  if (c.removed.length) parts.push(`${c.removed.length} removed`);
  if (c.reworded.length === 1 && !parts.length) {
    const [r] = c.reworded;
    parts.push(`reworded '${clip(r.from)}' → '${clip(r.to)}'`);
  } else if (c.reworded.length) {
    parts.push(`${c.reworded.length} reworded`);
  }
  if (c.reordered) parts.push(parts.length ? "reordered" : "steps reordered");
  return parts.join(", ");
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
  let changes: PlanChanges | null = null;
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
      // Only the LAST revision's diff is reported, but a rewording at any revision carries its evidence
      // forward: both texts share one bucket, so nothing collected under the old wording is lost.
      changes = latest ? diffPlan(latest, ev.items, ev.at) : null;
      for (const r of changes?.reworded ?? []) {
        const old = acc.get(r.from);
        if (old && !acc.has(r.to)) acc.set(r.to, old);
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
      e.latest = { name: ev.name, arg: ev.arg };
      if (ev.failed) {
        e.failed = true;
        e.failedCall = { name: ev.name, arg: ev.arg };
      }
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
    ...(changes ? { changes } : {}),
    ms: total > 0 ? total : undefined,
    ...(openKey !== null && openAt !== undefined ? { activeSince: openAt } : {}),
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
