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
}

export function reposPromptHint(repos: RepoLayout[]): string {
  if (repos.length === 1) {
    return `The repository is checked out at /workspace/${repos[0].name}.`;
  }
  const list = repos.map((r) => `/workspace/${r.name}`).join(", ");
  return `These repositories are checked out, each in its own directory: ${list}.`;
}
