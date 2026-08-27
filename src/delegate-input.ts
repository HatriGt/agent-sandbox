/**
 * Phase 1 / Step 3 — delegate input validation with ask-if-missing.
 *
 * Pure. Given the (possibly partial) delegate args, return either a ready plan or a plain-text
 * question telling the caller exactly what to provide and to re-call. No throwing for missing
 * args — missing info is a conversation, not a crash (see docs/remote-mcp-plan.md, Phase 1).
 *
 *  - source "local": each repo is a filesystem path (Mac/stdio rsync flow).
 *  - source "git":   each repo is owner/name or a GitHub URL (remote/HTTP clone-on-VPS flow).
 *
 * Multi-repo (B): a task can span several repos in the same IDE window (multi-root workspace).
 * The agent supplies `repos: [{repo, ref?}, ...]`; each lands in /workspace/<name> in ONE box and
 * gets its own PR. A single `repo` string is still accepted and normalized into a one-element list,
 * so existing single-repo callers are unchanged.
 */

export type DelegateSource = "local" | "git";

/** One repo to bring into the box, as given by the caller. */
export interface RepoInput {
  repo: string;
  ref?: string;
}

export interface DelegateInput {
  source: DelegateSource;
  /** Single-repo shorthand (back-compat). Merged into `repos` when provided. */
  repo?: string;
  /** Multi-repo list. Each entry becomes /workspace/<name>. */
  repos?: RepoInput[];
  task?: string;
  /** Single-repo ref shorthand; applies to `repo`. */
  ref?: string;
}

/** A validated repo with a unique in-box directory name derived from the repo. */
export interface RepoRef {
  repo: string;
  ref?: string;
  /** Unique subdir under /workspace (basename for paths, name segment for owner/name). */
  name: string;
}

/** An image (or other small file) the operator attached to the task; staged into the box before the agent starts. */
export interface Attachment {
  /** Path relative to /workspace, e.g. `.attachments/20260827-1-shot.png`. */
  path: string;
  /** Base64 payload (data-URL prefix allowed). */
  base64: string;
}

export interface DelegatePlan {
  source: DelegateSource;
  repos: RepoRef[];
  task: string;
  attachments?: Attachment[];
  /** Back-compat accessor: the first repo's identifier. */
  repo: string;
  /** Back-compat accessor: the first repo's ref. */
  ref?: string;
}

export type DelegateValidation =
  | { ok: true; plan: DelegatePlan; question?: undefined }
  | { ok: false; plan?: undefined; question: string };

function blank(s: string | undefined): boolean {
  return !s || s.trim() === "";
}

/** Derive a directory name from a repo id: basename of a path, or the name segment of owner/name. */
export function repoDirName(repo: string): string {
  const s = repo.trim().replace(/\.git$/i, "").replace(/[\/]+$/, "");
  const last = s.split("/").filter(Boolean).pop() ?? "repo";
  // Keep it filesystem-safe.
  return last.replace(/[^A-Za-z0-9._-]/g, "-") || "repo";
}

/** Make each name unique (teamA/api + teamB/api -> api, api-2). */
function uniquifyNames(refs: Array<Omit<RepoRef, "name"> & { name: string }>): RepoRef[] {
  const seen = new Map<string, number>();
  return refs.map((r) => {
    const n = seen.get(r.name) ?? 0;
    seen.set(r.name, n + 1);
    return n === 0 ? r : { ...r, name: `${r.name}-${n + 1}` };
  });
}

export function validateDelegateInput(input: DelegateInput): DelegateValidation {
  // Merge the single-repo shorthand into the repos list.
  const raw: RepoInput[] =
    input.repos && input.repos.length > 0
      ? input.repos
      : !blank(input.repo)
      ? [{ repo: input.repo!, ref: input.ref }]
      : [];

  const missing: string[] = [];

  // A repo is OPTIONAL: a sandbox can run a task with no repo at all ("write a report about X").
  // We only complain about repos that were PROVIDED but are blank inside an explicit repos[] list —
  // that's a caller mistake, not "no repo". A blank single `repo` shorthand just means "no repo".
  const blankInReposList = (input.repos ?? []).some((r) => blank(r.repo));
  if (blankInReposList) {
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

  // Drop any blank single-repo shorthand: it means task-only.
  const usable = raw.filter((r) => !blank(r.repo));
  const refs = uniquifyNames(
    usable.map((r) => ({
      repo: r.repo.trim(),
      ref: blank(r.ref) ? undefined : r.ref!.trim(),
      name: repoDirName(r.repo),
    }))
  );

  return {
    ok: true,
    plan: {
      source: input.source,
      repos: refs,
      task: input.task!.trim(),
      // Back-compat accessor: first repo, or "" in task-only mode.
      repo: refs[0]?.repo ?? "",
      ref: refs[0]?.ref,
    },
  };
}
