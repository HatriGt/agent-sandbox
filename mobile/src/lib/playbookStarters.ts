// Playbook starters — copied from web/src/components/PlaybooksPage.tsx (EXAMPLE + STARTERS).
export const EXAMPLE = `name: ship-feature
description: implement, prove it with tests, then review your own diff
steps:
  - title: Implement
    prompt: |
      {{task}}
      Write tests alongside the code.
  - command: npm test
    retry: 2
    feedback: Never weaken or delete a test to make it pass.
  - title: Review
    prompt: Review the full diff as a strict reviewer and fix anything you would reject.
  - command: npm run lint
`;

export const STARTERS: { name: string; line: string; yaml: string }[] = [
  { name: "Ship a feature", line: "Implement → test → self-review → lint", yaml: EXAMPLE },
  {
    name: "Fix a bug",
    line: "Reproduce with a failing test first, then fix until it passes",
    yaml: `name: fix-bug
description: reproduce with a failing test, then fix
steps:
  - title: Reproduce
    prompt: |
      {{task}}
      Before changing any code, add a test that fails because of this bug. Stop there.
  - title: Fix
    prompt: Now fix the bug so the new test passes. Keep the change minimal.
  - command: npm test
    retry: 3
    feedback: Fix the code, not the test.
`,
  },
  {
    name: "Keep CI green",
    line: "Make the change, then typecheck and test with retries",
    yaml: `name: ci-green
description: change, then typecheck and test until green
steps:
  - prompt: "{{task}}"
  - command: npx tsc --noEmit
    retry: 2
  - command: npm test
    retry: 2
`,
  },
  {
    name: "Plan, then build",
    line: "Write a plan to PLAN.md, then implement it step by step",
    yaml: `name: plan-then-build
description: write a plan first, then follow it
steps:
  - title: Plan
    prompt: |
      {{task}}
      Do not write code yet. Write a short step-by-step plan to PLAN.md.
  - command: test -s PLAN.md
  - title: Build
    prompt: Implement PLAN.md step by step, then delete PLAN.md.
`,
  },
];
