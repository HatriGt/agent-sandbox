/**
 * Phase 1 / Step 3 — delegate input validation with ask-if-missing.
 *
 * Pure. Given the (possibly partial) delegate args, return either a ready plan or a plain-text
 * question telling the caller exactly what to provide and to re-call. No throwing for missing
 * args — missing info is a conversation, not a crash (see docs/remote-mcp-plan.md, Phase 1).
 *
 *  - source "local": repo is a filesystem path (Mac/stdio rsync flow).
 *  - source "git":   repo is owner/name or a GitHub URL (remote/HTTP clone-on-VPS flow).
 */

export type DelegateSource = "local" | "git";

export interface DelegateInput {
  source: DelegateSource;
  repo?: string;
  task?: string;
  ref?: string;
}

export interface DelegatePlan {
  source: DelegateSource;
  repo: string;
  task: string;
  ref?: string;
}

export type DelegateValidation =
  | { ok: true; plan: DelegatePlan; question?: undefined }
  | { ok: false; plan?: undefined; question: string };

function blank(s: string | undefined): boolean {
  return !s || s.trim() === "";
}

export function validateDelegateInput(input: DelegateInput): DelegateValidation {
  const missing: string[] = [];

  if (blank(input.repo)) {
    missing.push(input.source === "local" ? "repo (absolute path)" : "repo (owner/name)");
  }
  if (blank(input.task)) {
    missing.push("task (what should the agent do)");
  }

  if (missing.length > 0) {
    const list = missing.join(", ");
    return {
      ok: false,
      question: `Need: ${list}. Please provide the missing value(s) and re-call delegate.`,
    };
  }

  return {
    ok: true,
    plan: {
      source: input.source,
      repo: input.repo!.trim(),
      task: input.task!.trim(),
      ref: blank(input.ref) ? undefined : input.ref!.trim(),
    },
  };
}
