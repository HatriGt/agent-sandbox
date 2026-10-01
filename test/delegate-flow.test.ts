/**
 * runDelegateFlow — the HTTP composer's path to a real delegation. Mirrors handlers.test.ts's
 * delegate coverage against fakes, since this is the second caller of the same orchestration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDelegateFlow } from "../src/delegate-flow.ts";
import { applyHarness, normalizeHarness } from "../src/harness.ts";
import { harnessPromptHint } from "../src/agent-prompt.ts";
import type { Config } from "../src/config.ts";

const cfg = { maxBoxes: 5 } as unknown as Config;
const okAccess = async () => ({ ok: true as const, ownerTokens: {}, primaryToken: undefined });

test("missing task -> a question, runDelegation never called", async () => {
  let called = false;
  const r = await runDelegateFlow(cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
    runDelegation: async () => {
      called = true;
      return { box: "x", warm: false, output: "" };
    },
  } as any, { source: "git", repo: "o/n" });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

test("valid input -> runs the delegation and returns the box", async () => {
  const r = await runDelegateFlow(cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, plan: any) => ({ box: "box-1", warm: true, output: `did: ${plan.task}` }),
  } as any, { source: "git", repo: "o/n", task: "write tests" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.box, "box-1");
    assert.equal(r.warm, true);
    assert.match(r.output, /write tests/);
  }
});

test("git source with unresolved access -> a question, never delegates", async () => {
  let called = false;
  const r = await runDelegateFlow(cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: async () => ({ ok: false as const, question: "which account?" }),
    runDelegation: async () => {
      called = true;
      return { box: "x", warm: false, output: "" };
    },
  } as any, { source: "git", repo: "o/n", task: "t" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.question, /which account/);
  assert.equal(called, false);
});

test("at capacity -> refused before touching the box count again", async () => {
  const r = await runDelegateFlow(cfg, {
    countBoxes: async () => 5,
    resolveGitAccess: okAccess,
    runDelegation: async () => ({ box: "x", warm: false, output: "" }),
  } as any, { source: "git", repo: "o/n", task: "t" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.question, /Refused/);
});

test("detach: the flag reaches runDelegation so a browser delegate returns at launch, not at the first boundary", async () => {
  // The dashboard only needs the box name — the thread attaches via SSE. Blocking the HTTP response
  // on driveInteractive's wait window (50s) was most of the observed 72s time-to-first-byte.
  let seenDetach: boolean | undefined;
  const r = await runDelegateFlow(cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, _plan: any, _domains: any, _creds: any, interact: any) => {
      seenDetach = interact?.detach;
      return { box: "box-d", warm: true, output: "run:started" };
    },
  } as any, { source: "git", repo: "o/n", task: "t", detach: true });
  assert.equal(r.ok, true);
  assert.equal(seenDetach, true);
});

test("task-only (no repo) is a valid plan", async () => {
  let seenRepos: any = null;
  const r = await runDelegateFlow(cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, plan: any) => {
      seenRepos = plan.repos;
      return { box: "task-box", warm: false, output: "REPORT_OK" };
    },
  } as any, { source: "git", task: "write a report" });
  assert.equal(r.ok, true);
  assert.deepEqual(seenRepos, []);
});

test("harness end to end: applyHarness output reaches the plan — task untouched, rules beside it, egress/skills/driver/verify set", async () => {
  // The composer route folds a saved harness into the body (src/harness.ts) and hands the pieces
  // to this flow; this pins the contract between the two so a harness demonstrably does something.
  const h = normalizeHarness({
    name: "Bug fixer",
    driver: "codex",
    egress: ["api.example.com"],
    skills: ["triage"],
    rules: { askBeforeGuess: true, planFirst: false, verifyOnDone: true },
    rulesMd: "1. Reproduce the bug first.",
    verifyCommand: "npm test",
  });
  const folded = applyHarness(h, { task: "fix the login bug" });
  assert.equal(folded.body.task, "fix the login bug");
  let seen: any;
  let seenDomains: string[] | undefined;
  const r = await runDelegateFlow(cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, plan: any, allowDomains?: string[]) => {
      seen = plan;
      seenDomains = allowDomains;
      return { box: "box-h", warm: false, output: "" };
    },
  } as any, {
    source: "git",
    repo: "o/n",
    task: folded.body.task as string,
    agent: folded.body.agent as string,
    // A harness-pinned codex/opencode carries the "supervised: partial" acknowledgement itself.
    allowPartialSupervision: folded.body.allowPartialSupervision === true,
    allowDomains: folded.body.allowDomains as string[],
    skills: folded.body.skills as string[],
    verify: { mode: "command", command: (folded.body.verify as { command: string }).command } as any,
    rules: folded.rules,
  });
  assert.equal(r.ok, true);
  // The operator's message is the task — nothing pasted on top of it.
  assert.equal(seen.task, "fix the login bug");
  // The rules travel separately, bound for the system prompt (msb.ts agentEnvFlags AGENT_RULES).
  assert.match(seen.rules, /^Harness rules \(Bug fixer\):/);
  assert.match(seen.rules, /Reproduce the bug first/);
  assert.match(harnessPromptHint(seen.rules), /every turn/);
  // Driver, egress and skills are effective on the plan the box is started from.
  assert.equal(seen.agent, "codex");
  assert.deepEqual(seenDomains, ["api.example.com"]);
  assert.deepEqual(seen.skills, ["triage"]);
  // Verify-on-done became a real verify clause (the route stores it and runs it on the done edge).
  assert.deepEqual(folded.body.verify, { command: "npm test" });
  assert.deepEqual(folded.applied.sort(), ["driver", "egress", "rules", "skills", "verify"]);
  // No harness → no rules on the plan at all.
  let plain: any;
  await runDelegateFlow(cfg, {
    countBoxes: async () => 0,
    resolveGitAccess: okAccess,
    runDelegation: async (_cfg: any, plan: any) => {
      plain = plan;
      return { box: "b", warm: false, output: "" };
    },
  } as any, { source: "git", repo: "o/n", task: "t" });
  assert.equal(plain.rules, undefined);
});
