/**
 * Repo-LAYOUT hint (pure). It states ONLY where each repo is checked out — nothing about the goal.
 * A task can be anything (analysis, root-cause, fix, refactor, run tests, open a PR, ...); the task
 * alone defines the outcome, exactly like local Claude Code. The hint must therefore carry ZERO
 * outcome language: no "commit", no "PR", no "if you make changes".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { harnessPromptHint, reposPromptHint } from "../src/agent-prompt.ts";
import { AGENT_SYS_PROMPT, agentEnvFlags, agentSh } from "../src/msb.ts";
import { rulesPreamble } from "../src/harness.ts";
import { driverFor } from "../src/drivers/index.ts";
import type { Config } from "../src/config.ts";

test("single repo: states only the location", () => {
  const h = reposPromptHint([{ name: "web" }]);
  assert.match(h, /\/workspace\/web/);
});

test("multi-repo: lists every location", () => {
  const h = reposPromptHint([{ name: "deal-service" }, { name: "claims-service" }]);
  assert.match(h, /\/workspace\/deal-service/);
  assert.match(h, /\/workspace\/claims-service/);
});

test("hint carries NO outcome language (goal comes only from the task)", () => {
  for (const repos of [[{ name: "web" }], [{ name: "a" }, { name: "b" }]]) {
    const h = reposPromptHint(repos);
    assert.doesNotMatch(h, /commit/i);
    assert.doesNotMatch(h, /pull request|\bPR\b/i);
    assert.doesNotMatch(h, /if you (make )?change|when changing/i);
    assert.doesNotMatch(h, /you must|you should/i);
  }
});

// --- the standing policy: planning must be DEFAULT behaviour ------------------------------------
// The plan is the caller's only view of progress mid-run, so it cannot depend on the task text
// asking for it. These lock the instruction's teeth in — an edit that softens them fails here.

test("the prompt makes planning unprompted and step-by-step", () => {
  const p = AGENT_SYS_PROMPT;
  // Told to plan without being asked, and to do it FIRST rather than as a closing summary.
  assert.match(p, /without being asked/i);
  assert.match(p, /TodoWrite/);
  assert.match(p, /BEFORE the work/i);
  assert.match(p, /never as a summary afterwards/i);
  // The discipline that makes the live checklist truthful.
  assert.match(p, /ONE step in_progress at a time/i);
  assert.match(p, /in_progress BEFORE you begin/i);
  assert.match(p, /rather than batched at the end/i);
  // And it must not leak the mechanism into the transcript.
  assert.match(p, /do not repeat the list in/i);
});

test("the prompt still forbids AI attribution and reading the controller's channel", () => {
  assert.match(AGENT_SYS_PROMPT, /Co-Authored-By: Claude/);
  assert.match(AGENT_SYS_PROMPT, /Never read or print \/workspace\/\.agent\./);
});

test("a patched repo warns the agent the dirty tree is intentional", () => {
  const hint = reposPromptHint([{ name: "api", patch: "diff...\n" }]);
  assert.match(hint, /\/workspace\/api/);
  assert.match(hint, /uncommitted changes/i);
  assert.match(hint, /Do not stash, reset, or discard/);
  // And a plain checkout gets no such warning — the agent should trust `git status` there.
  assert.doesNotMatch(reposPromptHint([{ name: "api" }]), /uncommitted/i);
});

test("harness rules ride in the SYSTEM prompt, framed for the whole thread; empty in -> empty out", () => {
  assert.equal(harnessPromptHint(undefined), "");
  assert.equal(harnessPromptHint("   "), "");
  const h = harnessPromptHint(rulesPreamble({ name: "Bug fixer", rules: { askBeforeGuess: true, planFirst: false, verifyOnDone: true }, rulesMd: "1. Reproduce first." }));
  assert.match(h, /harness/i);
  assert.match(h, /every turn/i);
  assert.match(h, /Harness rules \(Bug fixer\):/);
  assert.match(h, /ask a question and wait/);
  assert.match(h, /Reproduce first/);
});

test("the box env carries the task CLEAN and the rules as AGENT_RULES; the wrapper appends them to the system prompt every turn", () => {
  const cfg = { anthropicBaseUrl: "http://p", anthropicApiKey: "k", anthropicModel: "m", egressDomains: [] } as unknown as Config;
  const rules = rulesPreamble({ name: "Bug fixer", rules: { askBeforeGuess: true, planFirst: false, verifyOnDone: false } });
  for (const kind of ["claude", "codex", "opencode", "omp"] as const) {
    const env = agentEnvFlags(cfg, "fix the login bug", [{ name: "web" }], undefined, undefined, kind, rules);
    const of = (k: string) => env.find((v) => v.startsWith(`${k}=`))?.slice(k.length + 1);
    // The task is exactly what the operator typed — no preamble pasted on top of it.
    assert.equal(of("AGENT_TASK"), "fix the login bug");
    // The rules are their own variable, framed for the system prompt...
    assert.match(of("AGENT_RULES")!, /Harness rules \(Bug fixer\)/);
    assert.match(of("AGENT_RULES")!, /ask a question and wait/);
    // ...and the standing policy is untouched here (the wrapper composes them in the box).
    assert.doesNotMatch(of("AGENT_SYS_PROMPT")!, /Harness rules/);
    // No harness: no variable at all.
    assert.equal(agentEnvFlags(cfg, "t", undefined, undefined, undefined, kind).some((v) => v.startsWith("AGENT_RULES=")), false);

    // First turn: store the rules in the box (or clear a stale mark) and append them to the prompt.
    // (The wrapper is single-quoted for `bash -c`, so match on the unquoted fragments.)
    const first = agentSh("/workspace/web", false, kind);
    assert.ok(first.includes(`"$AGENT_RULES" > /workspace/.agent.rules; else rm -f /workspace/.agent.rules; fi`), kind);
    assert.ok(first.includes(`AGENT_SYS_PROMPT="$AGENT_SYS_PROMPT $(cat /workspace/.agent.rules)"; export AGENT_SYS_PROMPT`), kind);
    // Every later turn re-reads the stored copy but never rewrites it — the harness holds for the thread.
    const resume = agentSh("/workspace/web", true, kind);
    assert.ok(!resume.includes(`"$AGENT_RULES" > /workspace/.agent.rules`), kind);
    assert.ok(resume.includes(`AGENT_SYS_PROMPT="$AGENT_SYS_PROMPT $(cat /workspace/.agent.rules)"`), kind);
    // The append happens BEFORE the driver launch reads $AGENT_SYS_PROMPT.
    assert.ok(first.indexOf("export AGENT_SYS_PROMPT") < first.indexOf("set -o pipefail"));
  }
});

test("every driver's first-turn launch takes the policy from $AGENT_SYS_PROMPT, so harness rules reach codex/opencode/omp too", () => {
  for (const kind of ["claude", "codex", "opencode", "omp"] as const) {
    assert.match(driverFor(kind).launch({ resume: false }), /\$AGENT_SYS_PROMPT/, kind);
  }
});
