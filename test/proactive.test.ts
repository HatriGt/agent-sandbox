/**
 * Phase 4 — proactive agents: quiet runs, agent-authored automations, and the notification gate.
 *   - quiet marker detection (present / absent / not when a question is pending / not after a PR)
 *   - parseAutomate: valid and invalid crons, several per log, duplicates collapse
 *   - store round-trip of the quiet / proposed columns; enabling a proposal approves it
 *   - the finish edge: a quiet run marks its ledger row quiet and is not notified; a quiet-trigger
 *     run that reports is notified like any other finish
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import { QUIET_MARK, hasQuietMark, isQuietRun, normalizeTrigger, parseAutomate, quietPreamble } from "../src/triggers.ts";
import { createTrigger, getTrigger, getTriggerById, listDeliveries, quietCounts, setEnabled, updateTrigger } from "../src/trigger-store.ts";
import { makeDispatcher } from "../src/trigger-dispatch.ts";
import { detectTransitions, shouldNotify, type BoxRunView } from "../src/notify.ts";
import type { RunDigest } from "../src/digest.ts";

const box = makeSecretBox(crypto.randomBytes(32));

const digest = (over: Partial<RunDigest> = {}): RunDigest =>
  ({
    box: "b",
    task: "t",
    state: "done",
    startedAt: 1,
    endedAt: 2,
    steps: 1,
    plan: [],
    files: [],
    failedCommands: [],
    questions: [],
    headline: "done",
    ...over,
  }) as RunDigest;

test("quiet marker: detected at the end of the log, not when a question is pending or a PR was opened", () => {
  const quietLog = "ran gh run list\nnothing failed\n" + QUIET_MARK + "\nChecked CI on main: 5 green runs.\n";
  assert.ok(hasQuietMark(quietLog));
  assert.ok(isQuietRun(quietLog));
  assert.ok(!isQuietRun("ran gh run list\nbuild failed on main — investigating\n"), "no marker → a report");
  assert.ok(!isQuietRun(quietLog, { question: "Should I revert the commit?" }), "a pending question is never quiet");
  assert.ok(!isQuietRun(quietLog + "Opened https://github.com/o/r/pull/42\n"), "a PR opened is something to show");
  assert.ok(!isQuietRun(quietLog, { prOpened: true }));
  // A mention far back in a long log (the agent quoting its instructions) is not a sign-off.
  assert.ok(!hasQuietMark(QUIET_MARK + "\n" + "x".repeat(5000)));
  assert.match(quietPreamble("Check CI on main\nmore"), /Investigate Check CI on main\./);
  assert.ok(quietPreamble("Check CI").includes(QUIET_MARK));
});

test("parseAutomate: valid crons only, several per log, duplicates collapse, cap at three", () => {
  const log = [
    "Done. <!-- automate: */30 * * * * | Check CI on main and report failures -->",
    "<!-- automate: not a cron | Never created -->",
    "<!-- automate: 0 9 * * 1-5 | Re-run the weekly report -->",
    "<!-- automate: */30 * * * * | check ci on main and report failures -->", // duplicate (case-insensitive)
    "<!-- automate: 0 9 * * 1-5 |  -->", // empty task
    "<!-- automate: @hourly | Poll https://x.example/health -->",
    "<!-- automate: 5 * * * * | A fourth one past the cap -->",
  ].join("\n");
  const out = parseAutomate(log).map(({ cron, task }) => ({ cron, task }));
  assert.deepEqual(out, [
    { cron: "*/30 * * * *", task: "Check CI on main and report failures" },
    { cron: "0 9 * * 1-5", task: "Re-run the weekly report" },
    { cron: "0 * * * *", task: "Poll https://x.example/health" },
  ]);
  assert.deepEqual(parseAutomate("no proposals here"), []);
  assert.deepEqual(parseAutomate("<!-- automate: 61 * * * * | bad minute -->"), []);
});

test("store: quiet and proposed round-trip; enabling a proposal approves it", () => {
  const db = openMemoryDb();
  const n = normalizeTrigger({ name: "CI watch", kind: "schedule", taskTemplate: "Check CI", spec: { cron: "*/30 * * * *" }, quiet: true });
  assert.ok(n.ok);
  if (!n.ok) return;
  assert.equal(n.trigger.quiet, true);
  const { row } = createTrigger(db, box, "u1", n.trigger);
  assert.equal(row.quiet, true);
  assert.equal(row.proposed, false);
  assert.equal(row.enabled, true);
  // Update flips quiet off and back.
  const off = updateTrigger(db, "u1", row.id, { ...n.trigger, quiet: false })!;
  assert.equal(off.quiet, false);
  assert.equal(updateTrigger(db, "u1", row.id, n.trigger)!.quiet, true);
  // Default when the body says nothing: not quiet.
  const plain = normalizeTrigger({ name: "P", kind: "schedule", taskTemplate: "t", spec: { cron: "0 * * * *" } });
  assert.ok(plain.ok && plain.trigger.quiet === false);

  // A proposal is created paused whatever the input says, flagged proposed, and has no next fire.
  const p = createTrigger(db, box, "u1", { ...n.trigger, enabled: true }, Date.now(), { proposed: true }).row;
  assert.equal(p.proposed, true);
  assert.equal(p.enabled, false);
  assert.equal(p.nextFire, null);
  assert.equal(getTrigger(db, "u2", p.id), undefined, "owner-scoped");
  // Enable = approve: proposed clears, the schedule gets a next fire.
  const approved = setEnabled(db, "u1", p.id, true)!;
  assert.equal(approved.proposed, false);
  assert.equal(approved.enabled, true);
  assert.ok(approved.nextFire && approved.nextFire > 0);
  // Pausing an approved one later does not make it a proposal again.
  assert.equal(setEnabled(db, "u1", p.id, false)!.proposed, false);
});

test("finish edge: a quiet run marks its ledger row quiet and is not notified; a report from a quiet trigger is", async () => {
  const db = openMemoryDb();
  const n = normalizeTrigger({ name: "CI watch", kind: "schedule", taskTemplate: "Check CI on main", spec: { cron: "*/30 * * * *" }, quiet: true });
  assert.ok(n.ok);
  if (!n.ok) return;
  const { row } = createTrigger(db, box, "u1", n.trigger);
  const tasks: string[] = [];
  let i = 0;
  const d = makeDispatcher({
    db,
    log: () => {},
    startRun: async (input) => {
      tasks.push(input.task);
      return { ok: true, box: `box-${++i}` };
    },
  });

  // Fire 1: the quiet preamble rides along; the run signs off quiet.
  const r1 = await d.fire(getTriggerById(db, row.id)!, { manual: true });
  assert.equal(r1.outcome, "started");
  assert.ok(tasks[0].includes("This is a scheduled check. Investigate Check CI on main."));
  assert.ok(tasks[0].includes(QUIET_MARK));
  assert.ok(d.quietTriggerOf("box-1"), "an in-flight fire of a quiet trigger is recognised by box");
  assert.equal(d.quietTriggerOf("box-nope"), undefined);

  const log1 = "checked 5 runs, all green\n" + QUIET_MARK + "\nChecked CI on main.\n";
  const prev: BoxRunView[] = [{ name: "box-1", runState: "running" }];
  const next: BoxRunView[] = [{ name: "box-1", runState: "done", exitCode: 0 }];
  const [ev1] = detectTransitions(prev, next);
  assert.equal(ev1.kind, "done");
  const quiet1 = !!d.quietTriggerOf("box-1") && isQuietRun(log1);
  assert.equal(quiet1, true);
  assert.equal(shouldNotify(ev1, { quiet: quiet1 }), false, "a quiet finish sends nothing");
  await d.onRunFinished("box-1", digest({ box: "box-1" }), undefined, 1, { quiet: quiet1 });
  assert.equal(d.quietTriggerOf("box-1"), undefined, "the slot is freed");

  // Fire 2: same trigger, but the run found something and wrote no marker.
  const r2 = await d.fire(getTriggerById(db, row.id)!, { manual: true });
  assert.equal(r2.outcome, "started");
  const log2 = "run 812 failed: TypeError in build step — details below\n";
  const [ev2] = detectTransitions([{ name: "box-2", runState: "running" }], [{ name: "box-2", runState: "done", exitCode: 0 }]);
  const quiet2 = !!d.quietTriggerOf("box-2") && isQuietRun(log2);
  assert.equal(quiet2, false);
  assert.equal(shouldNotify(ev2, { quiet: quiet2 }), true, "a report notifies like any finish");
  await d.onRunFinished("box-2", digest({ box: "box-2" }), undefined, 2, { quiet: quiet2 });

  // Failures and questions are never muted, whatever the run wrote.
  assert.equal(shouldNotify({ box: "x", kind: "failed", exitCode: 1 }, { quiet: true }), true);
  assert.equal(shouldNotify({ box: "x", kind: "waiting", question: "?" }, { quiet: true }), true);

  // The ledger: one quiet check, one report; the deliveries list marks the quiet one.
  assert.deepEqual(quietCounts(db, row.id), { checked: 1, reports: 1 });
  const deliveries = listDeliveries(db, "u1", row.id);
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries.find((x) => x.box === "box-1")?.quiet, true);
  assert.equal(deliveries.find((x) => x.box === "box-2")?.quiet, undefined);

  // A non-quiet trigger never carries the preamble and is never recognised as quiet.
  const loud = normalizeTrigger({ name: "Loud", kind: "schedule", taskTemplate: "Report", spec: { cron: "0 * * * *" } });
  assert.ok(loud.ok);
  if (!loud.ok) return;
  const l = createTrigger(db, box, "u1", loud.trigger).row;
  await d.fire(l, { manual: true });
  assert.ok(!tasks[2].includes("scheduled check"));
  assert.equal(d.quietTriggerOf("box-3"), undefined);
});
