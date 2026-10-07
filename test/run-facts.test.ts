import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import { createTrigger, getTriggerById, listDeliveries } from "../src/trigger-store.ts";
import { matchGithub, normalizeTrigger } from "../src/triggers.ts";
import { makeDispatcher, type StartRunInput } from "../src/trigger-dispatch.ts";
import { reviewFacts, subjectFacts } from "../src/run-facts.ts";
import type { RunDigest } from "../src/digest.ts";
import type { TraceEvent } from "../src/trace.ts";

const say = (text: string): TraceEvent => ({ kind: "say", text });

test("reviewFacts: the last verdict line wins; findings tally by severity; blocking counts high or 'blocking'", () => {
  const r = reviewFacts([
    say("Looking..."),
    say("```findings\nhigh | src/a.ts:3 | null deref\nlow | src/b.ts | nit: rename\nmedium | src/c.ts | blocking: missing auth check\n```\n\nVerdict: needs work — fix the null deref."),
  ]);
  assert.deepEqual(r, { verdict: "needs-work", findings: { high: 1, medium: 1, low: 1, info: 0 }, blocking: 2 });
});

test("reviewFacts: a severity table approves; a fix-it reply with neither is null; an approval inside a fence does not count", () => {
  const table = reviewFacts([say("| Severity | Where | What |\n|---|---|---|\n| Low | x.ts | style |\n\nLGTM, approve.")]);
  assert.deepEqual(table, { verdict: "approve", findings: { high: 0, medium: 0, low: 1, info: 0 }, blocking: 0 });
  assert.equal(reviewFacts([say("Renamed foo to bar and pushed.")]), null);
  assert.equal(reviewFacts([say("```sh\necho approve\n```\nPushed the fix.")]), null);
  assert.equal(reviewFacts([]), null);
});

test("subjectFacts: PR title/author/url from the payload, falling back to a built url; alerts from the preset stamp", () => {
  const pr = subjectFacts({ pull_request: { number: 7, title: "Add thing", html_url: "https://github.com/o/r/pull/7", user: { login: "ann" } } }, { kind: "pr", number: 7 }, "o/r", "pull_request");
  assert.deepEqual(pr, { event: "pull_request", subject: { kind: "pr", number: 7, repo: "o/r", url: "https://github.com/o/r/pull/7", title: "Add thing", author: "ann" } });
  const bare = subjectFacts({ issue: { number: 3 } }, { kind: "issue", number: 3 }, "o/r");
  assert.equal(bare.subject?.url, "https://github.com/o/r/issues/3");
  const alert = subjectFacts({ asb_alert: { source: "Sentry", title: "TypeError", severity: "error", url: "https://s/1" } }, undefined, undefined);
  assert.deepEqual(alert, { alert: { source: "Sentry", title: "TypeError", severity: "error", url: "https://s/1" } });
  assert.deepEqual(subjectFacts({}, undefined, undefined), {});
});

test("delivery log: subject stamped at fire, result + receipt link merged at finish", async () => {
  const db = openMemoryDb();
  const box = makeSecretBox(Buffer.alloc(32, 1));
  const n = normalizeTrigger({ name: "Review", kind: "github", repo: "o/r", taskTemplate: "Review PR #{{pr.number}}", spec: { event: "pr_opened" } });
  assert.ok(n.ok);
  if (!n.ok) return;
  const { row } = createTrigger(db, box, "u1", n.trigger);
  const calls: StartRunInput[] = [];
  const d = makeDispatcher({
    db,
    log: () => {},
    startRun: async (input) => (calls.push(input), { ok: true, box: "box-1" }),
    postComment: async () => "https://github.com/o/r/pull/7#issuecomment-99",
  });
  const payload = { action: "opened", pull_request: { number: 7, title: "Add thing", html_url: "https://github.com/o/r/pull/7", user: { login: "ann" }, head: { repo: { full_name: "o/r" }, ref: "f" } }, repository: { full_name: "o/r" } };
  const match = matchGithub(n.trigger.spec, ["o/r"], "pull_request", payload);
  assert.ok(match.match);
  if (!match.match) return;
  await d.fire(row, { payload, event: "pull_request", match });
  const fired = listDeliveries(db, "u1", row.id)[0];
  assert.equal(fired.facts?.subject?.title, "Add thing");
  assert.equal(fired.facts?.state, undefined, "nothing finished yet");

  const digest: RunDigest = {
    box: "box-1", task: "t", state: "done", plan: [], files: [], failedCommands: [], blocked: [], questions: [], headline: "reviewed",
    outcome: { v: 1, state: "done", header: { startedBy: null, label: null, link: null }, result: { prs: [], diff: { files: 0, additions: 0, deletions: 0 } }, trust: { tests: null, exitCode: 0, verified: null, testedWith: null, prOnly: true, questions: 0, openQuestions: 0, blocked: 0 }, cost: { durationMs: 1200, tokens: null, usd: null, model: null } },
  };
  await d.onRunFinished("box-1", digest, calls[0].startedBy, 5, { events: [say("```findings\nhigh | a.ts | bug\n```\nNeeds work.")] });
  const done = listDeliveries(db, "u1", row.id)[0];
  assert.equal(done.id, fired.id, "same row");
  assert.equal(done.facts?.subject?.author, "ann", "fire-time facts survive the merge");
  assert.equal(done.facts?.archiveId, 5);
  assert.deepEqual(done.facts?.review, { verdict: "needs-work", findings: { high: 1, medium: 0, low: 0, info: 0 }, blocking: 1 });
  assert.equal(done.facts?.receiptUrl, "https://github.com/o/r/pull/7#issuecomment-99");
  assert.equal(done.facts?.durationMs, 1200);
  assert.ok(getTriggerById(db, row.id));
});
