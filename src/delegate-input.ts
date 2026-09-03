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

/**
 * A caller-supplied diff has to stay small enough to travel through the MCP transport and the JSON
 * body parser. 8 MB covers any sane feature-in-progress; a diff bigger than that is usually a
 * generated-file or vendored-deps mistake the caller should exclude. Enforced here in pure
 * validation — BEFORE GitHub access resolution — so an oversized payload is rejected cheaply
 * instead of first spending live GitHub probes on it.
 */
export const MAX_PATCH_BYTES = 8 * 1024 * 1024;

/** One repo to bring into the box, as given by the caller. */
export interface RepoInput {
  repo: string;
  ref?: string;
  /** git only: a `git diff` from the caller's machine, applied on top of the fresh checkout. */
  patch?: string;
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
  /** Single-repo patch shorthand; applies to `repo`. */
  patch?: string;
  /** Model alias for this run (validated against the catalog upstream in http/handlers). */
  model?: string;
}

/** A validated repo with a unique in-box directory name derived from the repo. */
export interface RepoRef {
  repo: string;
  ref?: string;
  /** git only: a caller-supplied diff applied on top of the fresh checkout before the box starts. */
  patch?: string;
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
  /** Model alias for message 1 (already allowlist-validated by the route/handler). */
  model?: string;
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

/**
 * Derive a directory name from a repo id: basename of a path, or the name segment of owner/name.
 *
 * The result becomes a real directory name in three places — the per-repo staging dir on the VPS,
 * /workspace/<name> in the box, and the path attach_repo `rm -rf`s on cleanup — so it must never be
 * a path component with meaning. The charset filter keeps `.`, which on its own let a repo id of
 * `owner/..` produce the literal name "..": every one of those paths then resolved to its PARENT.
 * A dot-only result is therefore replaced, not sanitised character by character.
 */
export function repoDirName(repo: string): string {
  const s = repo.trim().replace(/\.git$/i, "").replace(/[\/]+$/, "");
  const last = s.split("/").filter(Boolean).pop() ?? "repo";
  // Keep it filesystem-safe.
  const name = last.replace(/[^A-Za-z0-9._-]/g, "-");
  return /^\.+$/.test(name) ? "repo" : name || "repo";
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
      ? [{ repo: input.repo!, ref: input.ref, patch: input.patch }]
      : [];

  // A patch rides on top of a fresh git checkout. On source "local" the whole working tree is
  // already shipped — a patch there means the caller misunderstood the model, so say so rather
  // than silently ignoring it (or worse, double-applying changes the tree already has).
  const hasPatch = !blank(input.patch) || raw.some((r) => !blank(r.patch));
  if (hasPatch && input.source === "local") {
    return {
      ok: false,
      question:
        "patch only applies to source:\"git\" — with source:\"local\" your whole working tree " +
        "(including uncommitted changes) is shipped as-is, so there is nothing to apply a patch to. " +
        "Drop the patch, or switch to source:\"git\" with repo owner/name + ref.",
    };
  }
  if (hasPatch && raw.every((r) => blank(r.repo))) {
    return {
      ok: false,
      question:
        "patch needs a repo to apply to. Re-call delegate with repo (owner/name) and ref alongside the patch.",
    };
  }
  const tooBig = [input.patch, ...raw.map((r) => r.patch)].some(
    (p) => p && Buffer.byteLength(p, "utf8") > MAX_PATCH_BYTES
  );
  if (tooBig) {
    return {
      ok: false,
      question:
        `patch too large (> ${MAX_PATCH_BYTES / 1024 / 1024} MB). Exclude generated/vendored files ` +
        `from the diff, or push the work to a branch and delegate that ref instead.`,
    };
  }

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
      // Never trim a patch: leading/trailing whitespace can be significant diff content.
      patch: blank(r.patch) ? undefined : r.patch,
      name: repoDirName(r.repo),
    }))
  );

  return {
    ok: true,
    plan: {
      source: input.source,
      repos: refs,
      task: input.task!.trim(),
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
      // Back-compat accessor: first repo, or "" in task-only mode.
      repo: refs[0]?.repo ?? "",
      ref: refs[0]?.ref,
    },
  };
}
