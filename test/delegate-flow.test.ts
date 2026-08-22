/**
 * runDelegateFlow — the HTTP composer's path to a real delegation. Mirrors handlers.test.ts's
 * delegate coverage against fakes, since this is the second caller of the same orchestration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDelegateFlow } from "../src/delegate-flow.ts";
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
