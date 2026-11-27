import { test } from "node:test";
import assert from "node:assert/strict";
import { briefOf, deriveFacts, normalizeFacts } from "../src/trigger-facts.ts";

// The six rows that were live on 2026-11-27, as the Autopilot grid received them.
test("deriveFacts spreads a chat-made merge across the columns", () => {
  const f = deriveFacts({
    kind: "schedule",
    name: "Merge PR #290 to Production",
    summary: "Merges PR #290 (SPC-2406 baseline rate) into the Production branch after 6:30 PM Dubai time, once its checks are green",
    taskTemplate:
      "Merge pull request atom-insurance/atom-ui-spacerdb#290 (branch bugfix/SPC-2406-baseline-rate-prod) into its base Production branch. First confirm it is still open, mergeable (mergeable_state clean) and not a draft via `gh api repos/atom-insurance/atom-ui-spacerdb/pulls/290`. Then merge it with `gh pr merge 290 --merge` (or the repo's standard merge method). Do not force anything; if checks are failing or there are merge conflicts, do not merge — report back on the PR instead.",
  });
  assert.deepEqual(f, { action: "Merge", target: "PR #290", into: "Production", only: "checks green · still open · mergeable · not draft · no conflicts", how: "merge commit" });
});

test("deriveFacts reads the old form (the name is the task's first sentence) too", () => {
  const f = deriveFacts({
    kind: "schedule",
    name: "Force merge PR #2910 in atom-insurance/elseco-deal-service into Production",
    taskTemplate:
      "Force merge PR #2910 in atom-insurance/elseco-deal-service into Production. Run `gh pr merge 2910 --repo atom-insurance/elseco-deal-service --merge --admin`; --admin bypasses branch protection and missing reviews. First confirm the PR is still open and mergeable. If it has merge conflicts or is already closed, don't merge; report its state instead. After merging, report the merge commit SHA.",
  });
  assert.equal(f.action, "Force-merge");
  assert.equal(f.target, "PR #2910");
  assert.equal(f.into, "Production");
  assert.equal(f.only, "still open · mergeable · no conflicts");
  assert.equal(f.how, "admin override · merge commit");

  const three = deriveFacts({
    kind: "schedule",
    name: "Force-merge 3 production PRs at 12:45 PM Dubai time; the user explicitly authori",
    taskTemplate:
      "Force-merge 3 production PRs at 12:45 PM Dubai time; the user explicitly authorized this and said not to ask again. Run each with `gh pr merge <n> -R <repo> --admin` plus the merge method the repo allows (prefer merge commit, keep the branch): atom-insurance/atom-ui-spacerdb#282, atom-insurance/elseco-riskdb-services#164, atom-insurance/elseco-deal-service#2889.",
  });
  assert.equal(three.target, "PRs #282, #164, #2889");
  assert.equal(three.only, "pre-authorised");
  assert.equal(three.how, "admin override · merge commit · keep branch");
});

test("deriveFacts: a plain report, a CI check and a templated rule", () => {
  const report = deriveFacts({ kind: "schedule", name: "Report the current UTC time again by running `date -u`", taskTemplate: "Report the current UTC time again by running `date -u`. State the new time." });
  assert.deepEqual(report, { action: "Report", target: "current UTC time", how: "date -u" });

  const ci = deriveFacts({
    kind: "schedule",
    name: "Failing CI on main",
    taskTemplate: "Check CI on the default branch: run `gh run list --branch main --status failure --limit 5`. If a run failed, open its logs (`gh run view <id> --log-failed`), find the cause.",
  });
  assert.deepEqual(ci, { action: "Check", target: "CI", how: "gh run list" });

  const rule = deriveFacts({ kind: "watch", name: "Deal Reviewer", taskTemplate: 'Review PR #{{pr.number}} "{{pr.title}}" in {{repo.full_name}}. Check out the PR branch and leave a review on GitHub.' });
  assert.deepEqual(rule, { action: "Review", target: "each PR" });

  // A title whose verb differs from the summary's: the title wins (the agent chose it).
  const rb = deriveFacts({ kind: "schedule", name: "Roll back the deal service", summary: "Redeploys the previous MTA archive to the QA space if the smoke check still fails", taskTemplate: "If the smoke check still fails, redeploy the previous MTA archive." });
  assert.equal(rb.action, "Roll back");
  assert.equal(rb.target, "deal service");
  assert.equal(rb.into, undefined);

  // Four or more numbers collapse to a count; a title with no verb at all stays empty.
  assert.equal(deriveFacts({ kind: "schedule", name: "Merge PRs #1, #2, #3 and #4", taskTemplate: "Merge PRs #1, #2, #3 and #4 into main." }).target, "4 PRs");
  assert.deepEqual(deriveFacts({ kind: "webhook", name: "Sentry", taskTemplate: "{{alert.title}}: look at it." }), {});
});

test("normalizeFacts cleans the given set and briefOf lets it win field by field", () => {
  assert.equal(normalizeFacts(undefined), undefined);
  assert.equal(normalizeFacts({ target: "  ", into: "" }), undefined);
  assert.deepEqual(normalizeFacts({ action: "merges", target: " PR  #9 ", into: "main", only: "x".repeat(200), how: "squash", extra: "dropped" }), {
    action: "Merge",
    target: "PR #9",
    into: "main",
    only: "x".repeat(120),
    how: "squash",
  });
  const b = briefOf({ kind: "schedule", name: "Merge PR #290 to Production", taskTemplate: "Merge PR #290 into Production with `gh pr merge 290 --squash` once checks are green.", facts: { target: "the SPC-2406 fix", how: "squash, then tag" } });
  assert.deepEqual(b, { action: "Merge", target: "the SPC-2406 fix", into: "Production", only: "checks green", how: "squash, then tag" });
});
