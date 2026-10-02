/**
 * The workflow engine: drives src/workflow.ts runs from the finish edge of the fleet sweep, the way
 * the verify retrier does (src/verify.ts makeVerifyRetrier). The controller hands it `resume` (the
 * same quiet resume lane every follow-up uses) and `check` (the verify command lane); it owns the
 * per-box run table, in memory like boxVerify — a restart drops a mid-flight workflow visibly (the
 * fleet card simply stops showing a step), never silently continues on stale state.
 *
 * `onFinish` returns true when it consumed the finish — sent the box another turn — so the caller
 * skips that intermediate finish's notification and archive: the operator hears once, when the
 * workflow ends. Checks chain in-process (a passing check followed by another check runs at once)
 * until an agent step or the end.
 */
import type { VerifyResult } from "./verify.js";
import { advance, startRun, viewOf, type WorkflowDef, type WorkflowRun, type WorkflowView } from "./workflow.js";

export interface WorkflowEngineIo {
  resume(box: string, message: string): Promise<void>;
  check(box: string, command: string): Promise<VerifyResult>;
  log?(msg: string): void;
}

export function makeWorkflowEngine(io: WorkflowEngineIo) {
  const runs = new Map<string, WorkflowRun>();
  const inflight = new Set<string>();
  const log = (m: string) => io.log?.(m);

  return {
    /** Register the run the delegation just started. */
    arm(box: string, w: WorkflowDef, task: string, cursor: number): void {
      runs.set(box, startRun(w, task, cursor));
    },
    has(box: string): boolean {
      return runs.has(box);
    },
    /** The fleet-card view (undefined when the box runs no workflow). Ended runs stay readable until forget(). */
    viewOf(box: string): WorkflowView | undefined {
      const r = runs.get(box);
      return r ? viewOf(r) : undefined;
    },
    forget(box: string): void {
      runs.delete(box);
    },
    /**
     * A finish edge for `box`. True = consumed (another turn was sent, or a check is running and will
     * send one); false = not a workflow box, or the workflow just ENDED on this finish — the caller
     * then treats the finish as the run's own.
     */
    async onFinish(box: string, runState: "done" | "failed" | "waiting", exitCode?: number): Promise<boolean> {
      const run = runs.get(box);
      if (!run || run.state !== "running" || inflight.has(box)) return false;
      let step = advance(run, { kind: "finish", runState, exitCode });
      runs.set(box, step.run);
      // A question pauses the workflow; the operator's answer is the next turn and its finish returns here.
      if (step.action.type === "hold") return false;
      inflight.add(box);
      try {
        // Chain checks synchronously; stop at a resume (the next finish edge continues) or an end.
        for (;;) {
          const a = step.action;
          if (a.type === "end") return false;
          if (a.type === "hold") return false;
          if (a.type === "resume") {
            try {
              await io.resume(box, a.message);
              return true;
            } catch (e) {
              log(`[workflow] resume on ${box} failed: ${String((e as Error).message ?? e).slice(0, 200)}`);
              // The step could not be delivered: end the workflow as failed rather than leave it armed
              // for a finish that will never come.
              const failed: WorkflowRun = { ...step.run, state: "failed", failure: "could not send the next step" };
              runs.set(box, failed);
              return false;
            }
          }
          let result: VerifyResult;
          try {
            result = await io.check(box, a.command);
          } catch (e) {
            result = { mode: "command", pass: false, command: a.command, code: 1, detail: `could not run: ${String((e as Error).message ?? e).slice(0, 200)}` };
          }
          step = advance(step.run, { kind: "checked", result });
          runs.set(box, step.run);
        }
      } finally {
        inflight.delete(box);
      }
    },
  };
}

export type WorkflowEngine = ReturnType<typeof makeWorkflowEngine>;
