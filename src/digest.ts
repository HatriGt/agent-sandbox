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
import type { VerifyResult } from "./verify.js";
import { AGENT_LABELS, isAgentKind } from "./agent-kind.js";
import type { StartedBy } from "./started-by.js";
import type { SkillPick } from "./skill-match.js";
import type { MemoryKind } from "./drivers/sentinels.js";

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
  /** Verified-outcomes result (src/verify.ts), when the run carried a verify clause. */
  verified?: VerifyResult;
  /** How many times a failed verification sent the run back (harness autoRetry) before this finish. */
  retries?: number;
  /** Which coding agent ran (the box's .agent.kind mark), when known. */
  agent?: string;
  /** The model the run used, when the controller knows it (never guessed). */
  model?: string;
  /** The user model provider's label (src/providers.ts), when the thread named one. */
  provider?: string;
  /** How the run was started, recorded at delegation time (src/started-by.ts). */
  startedBy?: StartedBy;
  /** Skills the controller pointed the run at (src/skill-match.ts), explicit or auto. */
  skills?: SkillPick[];
}

/** Receipt provenance: who ran this. Only known facts; absent fields were not recorded. */
export interface DigestProvenance {
  agent?: string;
  agentLabel?: string;
  model?: string;
  provider?: string;
  /** How the run was started: manual (dashboard), mcp, after: handoff, or a trigger. */
  startedBy?: StartedBy;
  /** Skills suggested (auto) or requested (explicit) for the run. */
  skills?: SkillPick[];
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
  /** Calls the in-box guard denied (src/guard.ts). Split from failures: a blocked exfiltration
   *  attempt is a safety event the owner should SEE, not a command that merely errored. */
  blocked: Array<{ name: string; arg?: string }>;
  /** Turn-end token usage from the log's last ⟦usage⟧ sentinel; absent on logs from older boxes. */
  usage?: { inputTokens: number; outputTokens: number; contextTokens: number };
  questions: Array<{ question: string; answer?: string }>;
  /** Verified-outcomes result: pass means checked, not just claimed. */
  verified?: VerifyResult;
  /** Verification retries the controller issued before this finish (0 omitted). */
  retries?: number;
  /** Receipt provenance (driver, model), when known. Persisted with the archived digest. */
  provenance?: DigestProvenance;
  /** One sentence for notifications and list rows. */
  headline: string;
  /** Notes this run left in memory (src/memory-store.ts), harvested live and at the finish edge; absent = none. */
  remembered?: number;
  /** The same count by kind ("Remembered 2 lessons, 1 playbook"). */
  rememberedKinds?: Partial<Record<MemoryKind, number>>;
  /** The outcome card (src/outcome.ts), attached at archive time. */
  outcome?: import("./outcome.js").RunOutcome;
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
  blockedCount?: number;
  openQuestions: number;
  verified?: VerifyResult;
  retries?: number;
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
  if ((x.blockedCount ?? 0) > 0) bits.push(`${x.blockedCount} blocked`);
  if (x.openQuestions > 0 && x.state !== "waiting") bits.push(`${x.openQuestions} unanswered question${x.openQuestions === 1 ? "" : "s"}`);
  if (x.verified) bits.push(verifiedLabel(x.verified.pass, x.retries));
  return bits.join(" · ");
}

/** "verified" / "verified on 2nd try" / "UNVERIFIED after 3 tries" — the retry loop's one visible trace. */
export function verifiedLabel(pass: boolean, retries = 0): string {
  const tries = retries + 1;
  if (pass) return retries ? `verified on ${tries === 2 ? "2nd" : "3rd"} try` : "verified";
  return retries ? `UNVERIFIED after ${tries} tries` : "UNVERIFIED";
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
  const blocked: Array<{ name: string; arg?: string }> = [];
  const questions: Array<{ question: string; answer?: string }> = [];
  let pendingAsk: string | undefined;
  let usage: RunDigest["usage"];

  for (const ev of input.events) {
    if (ev.kind === "plan") {
      lastPlan = ev.items;
      activeStep = ev.items.findIndex((i) => i.state === "active");
      if (ev.at !== undefined) {
        if (startedAt === undefined) startedAt = ev.at;
        endedAt = ev.at;
      }
    } else if (ev.kind === "tool" && ev.failed) {
      // A guard denial surfaces as an errored tool_result carrying the guard's reason, and every
      // guard reason starts with "Refusing" (src/guard.ts). Split those out: "the sandbox stopped an
      // exfiltration attempt" is a different fact from "npm test failed".
      const entry = { name: ev.name, ...(ev.arg ? { arg: ev.arg } : {}) };
      if (/^\s*Refusing /.test(ev.result ?? "")) blocked.push(entry);
      else failedCommands.push(entry);
      if (activeStep >= 0) failedByStep.set(activeStep, true);
    } else if (ev.kind === "usage") {
      usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, contextTokens: ev.contextTokens };
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
    blockedCount: blocked.length,
    openQuestions,
    verified: input.verified,
    retries: input.retries,
  });

  const provenance: DigestProvenance = {
    ...(input.agent ? { agent: input.agent } : {}),
    ...(isAgentKind(input.agent) ? { agentLabel: AGENT_LABELS[input.agent] } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.startedBy ? { startedBy: input.startedBy } : {}),
    ...(input.skills?.length ? { skills: input.skills } : {}),
  };

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
    blocked,
    questions,
    ...(usage ? { usage } : {}),
    ...(input.verified ? { verified: input.verified } : {}),
    ...(input.retries ? { retries: input.retries } : {}),
    ...(Object.keys(provenance).length ? { provenance } : {}),
    headline,
  };
}
