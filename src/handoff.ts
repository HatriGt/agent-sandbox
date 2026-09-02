/**
 * Dependent delegations — fleet as a team (docs/features-2026-09.md §4).
 *
 * Multi-step workflows (implement → test against it → review it adversarially) want N isolated
 * agents with a CLEAN context each; until now the operator hand-carried patches between boxes.
 * `delegate({after: <session>, carry})` chains a child off a finished parent:
 *
 *   parent box ──(git add -A -N; git diff origin/<ref> --binary)──▶ patch
 *   child box  ──(fresh clone of the same repo@ref + that patch)──▶ continues the work
 *
 * This is the exact pipeline the `patch` argument already runs (applyPatchInStaging); the handoff
 * only automates producing the diff from the parent instead of the caller's machine. The child gets
 * the parent's WORK but none of its conversation — a fresh context is the point (an adversarial
 * reviewer that never saw the implementation reasoning is the killer use).
 *
 * v1 scheduling is immediate-on-done: a running parent is a question back to the caller, not a
 * queue. The calling agent (or the operator) is the scheduler; the controller stays stateless.
 */
import { shellQuote } from "./exec.js";

/** What the controller learned by inspecting the parent box (IO gathered in deps, pure logic here). */
export interface ParentInspection {
  exists: boolean;
  runState: "running" | "waiting" | "done" | "idle";
  exitCode?: number;
  /** Repos under the parent's /workspace with their origin owner/name and (when known) delegated ref. */
  repos: Array<{ name: string; repo: string; ref?: string }>;
}

export interface HandoffInput {
  task: string;
  /** Explicit child repo (owner/name) — must be one the parent has; default: inherit all. */
  repo?: string;
  carry?: "patch" | "none";
}

export interface HandoffRepoPlan {
  repo: string;
  ref?: string;
  /** True: extract the parent's uncommitted diff for this repo and ship it as the child's patch. */
  carry: boolean;
  /** The parent's /workspace dir for this repo (where the diff is produced). */
  dir: string;
}

export type HandoffValidation =
  | { ok: true; plan: { task: string; repos: HandoffRepoPlan[]; parentFailed: boolean } }
  | { ok: false; question: string };

/** Decide what the child inherits. Pure — the parent inspection is gathered by the caller. */
export function handoffPlan(parent: ParentInspection, input: HandoffInput): HandoffValidation {
  if (!parent.exists) {
    return { ok: false, question: "after: no sandbox exists for that session — it was torn down or the id is mistyped. The parent must still exist so its work can be carried." };
  }
  if (parent.runState === "running") {
    return {
      ok: false,
      question:
        "after: the parent is still running. Re-call when it reaches run:done, or pass wait:true to block until it does.",
    };
  }
  if (parent.runState === "waiting") {
    return {
      ok: false,
      question:
        "after: the parent is waiting on a question — answer it with resume() first; a handoff would carry half-decided work.",
    };
  }
  const carry = input.carry ?? "patch";
  const wanted = input.repo
    ? parent.repos.filter((r) => r.repo.toLowerCase() === input.repo!.trim().toLowerCase())
    : parent.repos;
  if (input.repo && wanted.length === 0) {
    return { ok: false, question: `after: the parent has no checkout of ${input.repo}. Its repos: ${parent.repos.map((r) => r.repo).join(", ") || "(none)"}.` };
  }
  if (carry === "patch" && parent.repos.length === 0) {
    return {
      ok: false,
      question:
        "after: the parent is a task-only box (no repos), so there is no working tree to carry. Pass carry:\"none\" to chain on the task alone.",
    };
  }
  return {
    ok: true,
    plan: {
      task: input.task,
      repos: wanted.map((r) => ({ repo: r.repo, ref: r.ref, carry: carry === "patch", dir: r.name })),
      parentFailed: (parent.exitCode ?? 0) !== 0,
    },
  };
}

/**
 * The in-parent shell that produces the carry diff for one repo. Diffs against the ref the child
 * will clone (`origin/<ref>`; with no explicit ref, the upstream tracking ref of the checkout —
 * both sides then agree on the base). `-N` includes new files; `--binary` survives assets. The
 * driver is done, so reading its tree races nothing.
 */
export function buildCarryDiffSh(dir: string, ref: string | undefined): string {
  const base = ref ? shellQuote(`origin/${ref}`) : `"$(git rev-parse --abbrev-ref '@{upstream}')"`;
  return `cd ${shellQuote(`/workspace/${dir}`)} && git add -A -N && git diff ${base} --binary`;
}
