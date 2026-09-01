/**
 * Pure builder for the repo-LAYOUT hint appended to the agent's system prompt.
 *
 * It states ONLY where each repo is checked out. Nothing about the goal. A task can be anything —
 * analysis, root-cause, bug fix, refactor, running tests, opening a PR — and the TASK alone defines
 * the outcome, exactly like local Claude Code. So this hint carries zero outcome language: no
 * "commit", no "PR", no "if you make changes". The sandbox is just Claude Code in a box with the
 * repos present; the task drives everything else.
 *
 * Kept pure so it's unit-tested and injected as env data (never the command line).
 */
export interface RepoLayout {
  name: string;
  /** Set when a caller diff was applied over the checkout (uncommitted work from their machine). */
  patch?: string;
}

export function reposPromptHint(repos: RepoLayout[]): string {
  const base =
    repos.length === 1
      ? `The repository is checked out at /workspace/${repos[0].name}.`
      : `These repositories are checked out, each in its own directory: ${repos
          .map((r) => `/workspace/${r.name}`)
          .join(", ")}.`;
  const patched = repos.filter((r) => r.patch).map((r) => `/workspace/${r.name}`);
  if (patched.length === 0) return base;
  // Without this line the agent tends to "clean up" a dirty tree (stash/checkout .), destroying
  // the very changes the operator shipped. State the fact, not what to do with it — the task decides.
  return (
    `${base} The working tree in ${patched.join(", ")} contains uncommitted changes shipped from ` +
    `the operator's machine — they are intentional, part of work in progress, and exist in no ` +
    `commit anywhere. Do not stash, reset, or discard them.`
  );
}
