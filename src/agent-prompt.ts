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
  /** The repo's learned/detected setup block (src/setup-profile.ts setupPromptHint). */
  setupHint?: string;
}

/**
 * The harness rules block for the agent's SYSTEM prompt (src/harness.ts rulesPreamble is the
 * body; this frames it). It rides beside the standing policy — never inside the task — so the
 * operator's message stays exactly what they typed. The controller hands it to the box as
 * $AGENT_RULES; the run wrapper (msb.ts agentSh) stores it on the FIRST turn and appends it to
 * $AGENT_SYS_PROMPT on EVERY turn, so the rules hold for the whole thread and reach each driver
 * through the one prompt mechanism it already has (claude --append-system-prompt; codex, opencode
 * and omp prefix $AGENT_SYS_PROMPT to their first prompt). Empty input → empty output.
 */
export function harnessPromptHint(rules: string | undefined): string {
  const body = rules?.trim();
  if (!body) return "";
  return `The operator attached a harness to this run. Its rules apply to every turn of this thread, on top of the task:\n${body}`;
}

export function reposPromptHint(repos: RepoLayout[]): string {
  const setup = repos.map((r) => r.setupHint).filter(Boolean).join(" ");
  const layout = layoutHint(repos);
  return setup ? `${layout} ${setup}` : layout;
}

function layoutHint(repos: RepoLayout[]): string {
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
