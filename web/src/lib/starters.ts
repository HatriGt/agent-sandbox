/**
 * Composer starters: one-click briefs for the tasks people actually delegate. Pure data + the
 * compose-merge rule, extracted from Hub.tsx so both are testable from the server suite; the Hub
 * maps these to chips and owns the icons (React nodes don't belong in a lib the tests import).
 *
 * "Plan first, then build" and "TDD a feature" encode the two workflow patterns that route a run
 * through the ask-and-stop gate deliberately — the plan-approval pause IS the product's magic
 * moment, so a starter that reaches it deterministically is an activation feature, not copy.
 */

export interface StarterDef {
  label: string;
  task: string;
  needsRepo?: boolean;
}

export const STARTERS: StarterDef[] = [
  {
    label: "Explain a codebase",
    task: "Read this repository and write a concise architecture overview: the entry points, the main modules and how they depend on each other, and anything surprising. Do not change any files.",
    needsRepo: true,
  },
  {
    label: "Fix a bug, open a PR",
    task: "Find and fix the following bug, add a regression test, and open a pull request:\n\n",
    needsRepo: true,
  },
  {
    label: "Run the tests",
    task: "Install dependencies, run the full test suite, and report exactly what fails with the command and the key error lines. Do not fix anything yet — stop and tell me what you found.",
    needsRepo: true,
  },
  {
    label: "Review a diff",
    task: "Review the changes on the current branch against main. Report correctness bugs first, then anything that could be simpler. Do not change files.",
    needsRepo: true,
  },
  {
    label: "Review a PR",
    task: "Review the following pull request. Check out the PR branch, read the full diff, and leave a review on GitHub: comment on the specific lines for any correctness bug, risky change, or clear improvement. If nothing needs a change, approve the PR instead. Do not merge.\n\nPR: ",
    needsRepo: true,
  },
  {
    label: "Plan first, then build",
    task: "Plan before you build. Explore the repository, then write a short implementation plan: the files you will touch, the approach, and any risks or open decisions. Ask me to approve the plan and do not change or edit any files until I answer. Once approved, implement it, run the tests, and open a pull request.\n\nTask: ",
    needsRepo: true,
  },
  {
    label: "TDD a feature",
    task: "Build the following test-first. Write the tests before any implementation, run them, and confirm they fail for the right reason. Then implement the smallest code that makes them pass, run the full suite, and open a pull request that shows both the tests and the implementation.\n\nFeature: ",
    needsRepo: true,
  },
  {
    label: "Research, no repo",
    task: "Write a thorough, well-sourced report on the following, into /workspace/report.md:\n\n",
  },
];

/**
 * What the composer should hold after a starter click: an empty composer (or one holding exactly
 * another starter's untouched text) is replaced; anything the user typed is kept, with the starter
 * appended under it as the "how" for their "what".
 */
export function mergeStarterText(current: string, starterTask: string): string {
  const t = current.trim();
  if (!t || STARTERS.some((x) => t === x.task.trim())) return starterTask;
  return `${t}\n\n${starterTask}`;
}
