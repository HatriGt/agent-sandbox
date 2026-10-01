/**
 * Verified outcomes — "done" means proven, not claimed (docs/features-2026-09.md §3).
 *
 * `run:done exit=0` means the agent SAID it finished. The verify lane makes done mean CHECKED, by
 * something that cannot edit the code under test:
 *
 *  - command mode: `verify: {command: "npm test"}` — the command runs in the box after the driver
 *    finishes; exit 0 is the verdict. The command may build/test freely; it is not the co-pilot, so
 *    the read-only hook does not apply to it — its authority is its exit code, and the driver is
 *    already done so nothing races.
 *  - criterion mode: `verify: {criterion: "…"}` — one turn of the READ-ONLY ask co-pilot (same box,
 *    RO hooks enforced) judges the criterion and must answer a `VERDICT: pass|fail — reason` line.
 *
 * A verify failure never un-finishes the run — it stamps it, in the digest and the notification:
 * `done:verified` vs `done:UNVERIFIED (…)`. Everything here is pure or IO-injected; the box exec
 * and the ask turn are wired in deps.ts/http.ts.
 */

import { parseTestCounts, type TestCounts } from "./test-counts.js";

export type VerifyPlan =
  | { mode: "command"; command: string }
  | { mode: "criterion"; criterion: string };

export type VerifyPlanValidation =
  | { ok: true; plan: VerifyPlan | undefined }
  | { ok: false; question: string };

const MAX_LEN = 4000;

/**
 * Validate the caller's verify clause. Explicit keys, no guessing: a string that "looks like" a
 * command is exactly the ambiguity that turns a criterion into an executed shell line.
 */
export function verifyPlanOf(input: Record<string, unknown> | undefined): VerifyPlanValidation {
  if (input === undefined) return { ok: true, plan: undefined };
  const command = typeof input.command === "string" ? input.command.trim() : "";
  const criterion = typeof input.criterion === "string" ? input.criterion.trim() : "";
  if (command && criterion) {
    return { ok: false, question: "verify takes EITHER {command} or {criterion}, not both. Pick one and re-call." };
  }
  if (!command && !criterion) {
    return {
      ok: false,
      question:
        'verify needs {command: "<shell command whose exit code is the verdict>"} or ' +
        '{criterion: "<acceptance criterion for the read-only co-pilot to judge>"}.',
    };
  }
  if (command.length > MAX_LEN || criterion.length > MAX_LEN) {
    return { ok: false, question: `verify text too long (max ${MAX_LEN} chars).` };
  }
  return { ok: true, plan: command ? { mode: "command", command } : { mode: "criterion", criterion } };
}

export interface VerifyResult {
  mode: VerifyPlan["mode"];
  pass: boolean;
  detail: string;
  /** Command mode: the command that ran (the outcome card's "Tested with `…`"). */
  command?: string;
  /** Command mode: pass/fail counts when the command's output was a recognised test runner's. */
  tests?: TestCounts;
  /** Command mode: the exit code. */
  code?: number;
  /** A failure's tail (last RETRY_TAIL_LINES lines) — what the retry feedback hands back to the agent. */
  output?: string;
}

const VERDICT_RE = /^\s*VERDICT:\s*(pass|fail)\s*(?:[—–-]+\s*(.*))?$/gim;

/**
 * Read the co-pilot's judgement. The LAST verdict line wins (the model may correct itself
 * mid-answer); no verdict at all is a FAIL with an honest detail — an enthusiastic answer that
 * never says pass/fail must never count as verified.
 */
export function parseVerdict(answer: string): { pass: boolean; detail: string } {
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  VERDICT_RE.lastIndex = 0;
  while ((m = VERDICT_RE.exec(answer)) !== null) last = m;
  if (!last) return { pass: false, detail: "no verdict line in the verifier's answer" };
  return { pass: last[1].toLowerCase() === "pass", detail: (last[2] ?? "").trim() || last[1].toLowerCase() };
}

/** The co-pilot prompt for criterion mode. One turn, one demanded output shape. */
export function verdictPrompt(criterion: string): string {
  return (
    "You are VERIFYING a finished run against an acceptance criterion. Check it against what is " +
    "actually in the workspace RIGHT NOW — run tests, read files, curl endpoints (read-only) — do " +
    "not take the driver's transcript at its word.\n\n" +
    `Criterion: ${criterion}\n\n` +
    "Your reply MUST end with exactly one line of the form `VERDICT: pass — <evidence>` or " +
    "`VERDICT: fail — <what is wrong>`. If you cannot check it, that is `VERDICT: fail — could not verify: <why>`."
  );
}

const TAIL = 500;
const RETRY_TAIL_LINES = 40;
const RETRY_TAIL_CHARS = 4000;

/**
 * Run one verification. IO is injected: `execCommand` runs a shell command in the box and returns
 * its exit code + combined output; `askCriterion` runs one read-only co-pilot turn. Any thrown
 * error is a FAIL with the error text — verification must never crash the delegation's return path.
 */
export async function runVerification(
  plan: VerifyPlan,
  io: {
    execCommand: (cmd: string) => Promise<{ code: number; output: string }>;
    askCriterion: (prompt: string) => Promise<{ answer: string }>;
  }
): Promise<VerifyResult> {
  try {
    if (plan.mode === "command") {
      const r = await io.execCommand(plan.command);
      const lines = r.output.trim().split("\n").filter((l) => l.trim());
      // Pass: the last line is the summary ("all green", "24 passing"). Fail: keep a short tail —
      // the failing assertion is usually a few lines up.
      const detail = (r.code === 0 ? lines.slice(-1) : lines.slice(-8)).join("\n").slice(-TAIL);
      const tests = parseTestCounts(r.output);
      const output = r.code === 0 ? "" : lines.slice(-RETRY_TAIL_LINES).join("\n").slice(-RETRY_TAIL_CHARS);
      return { mode: "command", pass: r.code === 0, detail: detail || `exit ${r.code}`, command: plan.command, code: r.code, ...(tests ? { tests } : {}), ...(output ? { output } : {}) };
    }
    const { answer } = await io.askCriterion(verdictPrompt(plan.criterion));
    const v = parseVerdict(answer);
    return { mode: "criterion", pass: v.pass, detail: v.detail };
  } catch (e) {
    return { mode: plan.mode, pass: false, detail: `verification errored: ${String((e as Error).message ?? e).slice(0, TAIL)}` };
  }
}

/** One line for transcripts, digests and notifications. */
export function formatVerifyResult(r: VerifyResult): string {
  return r.pass
    ? `verified (${r.mode}): ${r.detail}`
    : `UNVERIFIED (${r.mode}): ${r.detail}`;
}

/* ───────────────────────────── auto-retry ───────────────────────────── */

/** The harness rule's bounds (src/harness.ts autoRetry): 0 = stamp only, up to two more turns. */
export const AUTO_RETRY_DEFAULT = 1;
export const AUTO_RETRY_MAX = 2;

/** Clamp a harness rule value into the budget. Anything unparseable is the default. */
export function autoRetryOf(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : AUTO_RETRY_DEFAULT;
  return Math.min(AUTO_RETRY_MAX, Math.max(0, n));
}

/** What a failed verification tells the agent when the controller sends it back for another turn. */
export function verifyRetryMessage(r: VerifyResult): string {
  const what = r.mode === "command" ? (r.command ?? "verify command") : "criterion check";
  const tail = (r.output ?? r.detail).trim();
  return `Verification failed: ${what} — exit ${r.code ?? 1}.\n\n${tail}\n\nFix it and re-verify before finishing.`;
}

/**
 * The retry loop's bookkeeping, kept out of the fleet sweep so it can be tested with a fake resume.
 * `arm` records a run's budget when it starts; `consider` runs at the finish edge AFTER the
 * verification resolved and returns true when it sent the run back — the caller then skips the
 * notification and the archive for that intermediate finish. A run that ended on a question is
 * never retried (the operator's answer is the next turn), and the counter is what the digest and
 * the outcome card report as `retries`.
 */
export function makeVerifyRetrier(io: { resume: (box: string, message: string) => Promise<void>; log?: (msg: string) => void }) {
  const budgets = new Map<string, { max: number; used: number }>();
  return {
    arm(box: string, max: number): void {
      budgets.set(box, { max: autoRetryOf(max), used: 0 });
    },
    /** How many times this run was sent back so far (0 when never armed). */
    retriesOf(box: string): number {
      return budgets.get(box)?.used ?? 0;
    },
    forget(box: string): void {
      budgets.delete(box);
    },
    async consider(box: string, result: VerifyResult | undefined, runState: string): Promise<boolean> {
      const b = budgets.get(box);
      if (!b || !result || result.pass || runState === "waiting" || b.used >= b.max) return false;
      b.used += 1;
      try {
        await io.resume(box, verifyRetryMessage(result));
        return true;
      } catch (e) {
        b.used -= 1;
        io.log?.(`[verify] retry resume on ${box} failed: ${String((e as Error).message ?? e).slice(0, 200)}`);
        return false;
      }
    },
  };
}
