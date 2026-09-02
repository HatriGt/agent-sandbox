/**
 * Run digest — a claim ledger, not a transcript (docs/features-2026-09.md §2).
 *
 * A human reviewing a finished run at a distance does not want to scroll a transcript; they want:
 * what was asked, what the agent claimed (its plan), what actually happened (files, failed
 * commands), what was decided along the way (questions/answers), and one headline they can read on
 * a phone. Everything here is a pure derivation from data the system already records — the parsed
 * trace (src/trace.ts, the same events the dashboard thread renders) and the /changes.json file
 * list. No new instrumentation runs in the box.
 */
import type { TraceEvent, PlanItem } from "./trace.js";

export interface DigestFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface DigestInput {
  box: string;
  task: string;
  runState: "running" | "waiting" | "done" | "idle";
  exitCode?: number;
  events: TraceEvent[];
  files: DigestFile[];
}

export interface DigestPlanStep extends PlanItem {
  /** True when an err-marked tool call ran while this step was the active one. */
  failed?: boolean;
}

export interface RunDigest {
  box: string;
  task: string;
  state: "done" | "failed" | "waiting" | "running";
  exitCode?: number;
  /** From the first/last plan sentinel stamps — the only wall clock the log carries. */
  startedAt?: number;
  endedAt?: number;
  plan: DigestPlanStep[];
  files: DigestFile[];
  failedCommands: Array<{ name: string; arg?: string }>;
  questions: Array<{ question: string; answer?: string }>;
  /** One sentence for notifications and list rows. */
  headline: string;
}

/** Exit codes the run wrapper reserves for non-agent terminations (msb.ts). */
const EXIT_NOTES: Record<number, string> = {
  254: "interrupted (restart or send-now)",
  253: "stopped by the operator",
};

function stateOf(runState: DigestInput["runState"], exitCode: number | undefined): RunDigest["state"] {
  if (runState === "waiting") return "waiting";
  if (runState === "running") return "running";
  return (exitCode ?? 0) === 0 ? "done" : "failed";
}

export function headlineOf(x: {
  state: RunDigest["state"];
  exitCode?: number;
  fileCount: number;
  stepCount: number;
  failedCount: number;
  openQuestions: number;
}): string {
  const bits: string[] = [];
  if (x.state === "failed") {
    const note = x.exitCode !== undefined ? EXIT_NOTES[x.exitCode] : undefined;
    bits.push(note ? `failed — ${note}` : `failed (exit ${x.exitCode})`);
  } else if (x.state === "waiting") {
    bits.push("needs an answer");
  } else if (x.state === "running") {
    bits.push("still working");
  } else {
    bits.push("done");
  }
  if (x.fileCount > 0) bits.push(`${x.fileCount} file${x.fileCount === 1 ? "" : "s"}`);
  if (x.stepCount > 0) bits.push(`${x.stepCount} step${x.stepCount === 1 ? "" : "s"}`);
  if (x.failedCount > 0) bits.push(`${x.failedCount} failed command${x.failedCount === 1 ? "" : "s"}`);
  if (x.openQuestions > 0 && x.state !== "waiting") bits.push(`${x.openQuestions} unanswered question${x.openQuestions === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

/**
 * Derive the digest. Attribution rule (same one the task board uses, web/src/lib/planTasks.ts):
 * work between two consecutive plan snapshots belongs to the step that was ACTIVE in the first —
 * so a failed tool call marks the step it ran under, and the last snapshot is the plan of record.
 */
export function buildDigest(input: DigestInput): RunDigest {
  const state = stateOf(input.runState, input.exitCode);

  // Plan: last snapshot wins; failures attribute to the step active when the failed call happened.
  const failedByStep = new Map<number, true>();
  let activeStep = -1;
  let lastPlan: PlanItem[] = [];
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  const failedCommands: Array<{ name: string; arg?: string }> = [];
  const questions: Array<{ question: string; answer?: string }> = [];
  let pendingAsk: string | undefined;

  for (const ev of input.events) {
    if (ev.kind === "plan") {
      lastPlan = ev.items;
      activeStep = ev.items.findIndex((i) => i.state === "active");
      if (ev.at !== undefined) {
        if (startedAt === undefined) startedAt = ev.at;
        endedAt = ev.at;
      }
    } else if (ev.kind === "tool" && ev.failed) {
      failedCommands.push({ name: ev.name, ...(ev.arg ? { arg: ev.arg } : {}) });
      if (activeStep >= 0) failedByStep.set(activeStep, true);
    } else if (ev.kind === "ask") {
      if (pendingAsk !== undefined) questions.push({ question: pendingAsk }); // an ask that was never answered
      pendingAsk = ev.text;
    } else if (ev.kind === "you" && pendingAsk !== undefined) {
      questions.push({ question: pendingAsk, answer: ev.text });
      pendingAsk = undefined;
    }
  }
  if (pendingAsk !== undefined) questions.push({ question: pendingAsk });

  const plan: DigestPlanStep[] = lastPlan.map((item, i) => ({
    ...item,
    ...(failedByStep.has(i) ? { failed: true } : {}),
  }));

  const openQuestions = questions.filter((q) => q.answer === undefined).length;
  const headline = headlineOf({
    state,
    exitCode: input.exitCode,
    fileCount: input.files.length,
    stepCount: plan.length,
    failedCount: failedCommands.length,
    openQuestions,
  });

  return {
    box: input.box,
    task: input.task,
    state,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
    plan,
    files: input.files,
    failedCommands,
    questions,
    headline,
  };
}
