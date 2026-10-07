import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.js";
import { makeSecretBox } from "../src/secretbox.js";
import { advanceNextFire, createTrigger, getTrigger, markFired, markSkipped, promoteTrigger } from "../src/trigger-store.js";
import { scheduleCategory, scheduleStatus, threadSchedule, type ScheduleTrigger } from "../src/thread-schedule.js";
import { automateNeedsApproval, parseAutomate } from "../src/triggers.js";

const t = (o: Partial<ScheduleTrigger> & { id: string }): ScheduleTrigger => ({
  name: o.id,
  kind: "schedule",
  spec: { cron: "0 9 * * *" } as ScheduleTrigger["spec"],
  taskTemplate: "do it",
  enabled: true,
  proposed: false,
  nextFire: 1000,
  when: "daily",
  ...o,
});

test("threadSchedule: proposals, created (live and paused), repeats, after; others ignored", () => {
  const items = threadSchedule("b1", { kind: "trigger", triggerId: "P", name: "p", source: "schedule" } as never, [
    t({ id: "mine", sourceBox: "b1", nextFire: 50 }),
    t({ id: "prop", sourceBox: "b1", proposed: true, enabled: false, taskTemplate: "deploy the app" }),
    t({ id: "paused", sourceBox: "b1", enabled: false }),
    t({ id: "P", nextFire: 10 }),
    t({ id: "chain", kind: "chain", spec: { afterTrigger: "P" } as ScheduleTrigger["spec"] }),
    t({ id: "other", sourceBox: "b2" }),
  ]);
  assert.deepEqual(
    items.map((i) => [i.id, i.relation, i.nextFire]),
    [
      ["prop", "proposed", null],
      ["mine", "created", 50],
      ["paused", "created", null],
      ["P", "repeats", 10],
      ["chain", "after", 1000],
    ]
  );
  assert.match(items[0].why ?? "", /critical/);
  assert.equal(items[0].category, "deploy");
});

test("threadSchedule: a thread started by hand sees only its own", () => {
  assert.deepEqual(threadSchedule("b1", undefined, [t({ id: "P" })]), []);
});

test("automate: routine schedules start on their own; critical, frequent or flagged ones ask", () => {
  assert.equal(automateNeedsApproval("0 9 * * *", "Check whether CI on main is green and summarize failures"), undefined);
  assert.ok(automateNeedsApproval("0 9 * * *", "Deploy the staging build to production"));
  assert.ok(automateNeedsApproval("*/2 * * * *", "Poll the status page"));
  const [p] = parseAutomate("<!-- automate?: 0 9 * * 1 | Rebuild the weekly report -->");
  assert.equal(p.asked, true);
  assert.ok(automateNeedsApproval(p.cron, p.task, p.asked));
  assert.equal(scheduleCategory("Re-run the flaky tests"), "ci");
  assert.equal(scheduleCategory("Follow up on the vendor reply"), "follow-up");
});

test("schedule markers: a time runs once, a cron repeats; automate must repeat", () => {
  const now = Date.parse("2026-10-02T10:00:00Z");
  const ps = parseAutomate(
    [
      "<!-- schedule?: 2026-10-02T14:00Z | Merge PR #12 once CI is green -->",
      "<!-- schedule: in 2h | Check whether the flaky test passed -->",
      "<!-- schedule: 0 9 * * 1 | Remind me about the vendor reply -->",
      "<!-- schedule: 2020-01-01T00:00Z | long past -->",
    ].join("\n"),
    now
  );
  assert.deepEqual(
    ps.map((p) => [p.scope, p.at ?? p.cron, !!p.asked]),
    [
      ["scheduled", Date.parse("2026-10-02T14:00:00Z"), true],
      ["scheduled", now + 2 * 3600_000, false],
      ["scheduled", "0 9 * * 1", false],
    ]
  );
  const auto = parseAutomate("<!-- automate: in 1h | not a standing rule -->\n<!-- automate: 0 7 * * * | Summarize overnight CI failures -->", now);
  assert.deepEqual(auto.map((p) => [p.scope, p.cron]), [["automation", "0 7 * * *"]]);
  assert.ok(automateNeedsApproval("", "Merge PR #12"));
  assert.equal(automateNeedsApproval("", "Check whether the flaky test passed"), undefined);
});

test("scheduleStatus: a one-time run goes waiting → running → done; a repeat pauses", () => {
  const once = { enabled: true, proposed: false, spec: { at: 5 } as ScheduleTrigger["spec"], lastFired: null, lastResult: null };
  assert.equal(scheduleStatus(once), "waiting");
  assert.equal(scheduleStatus({ ...once, lastFired: 6, lastResult: { at: 6, outcome: "started", box: "b" } }), "running");
  assert.equal(scheduleStatus({ ...once, lastFired: 6, lastResult: { at: 6, outcome: "started", box: "b", finished: { state: "done" } } }), "done");
  assert.equal(scheduleStatus({ ...once, enabled: false }), "cancelled");
  assert.equal(scheduleStatus({ ...once, enabled: false, proposed: true }), "needs-ok");
  assert.equal(scheduleStatus({ ...once, spec: { cron: "0 9 * * *" } as ScheduleTrigger["spec"], enabled: false }), "paused");
});

test("store: a one-time schedule is due once, retries when busy, and never refires", () => {
  const db = openMemoryDb();
  const sb = makeSecretBox(crypto.randomBytes(32));
  const at = Date.now() + 60_000;
  const input = { name: "merge", kind: "schedule" as const, spec: { at }, taskTemplate: "Merge PR #1", enabled: true, prComment: false, quiet: false };
  const { row } = createTrigger(db, sb, "o", input, Date.now(), { sourceBox: "b1", scope: "scheduled" });
  assert.equal(row.scope, "scheduled");
  assert.equal(row.nextFire, at);
  advanceNextFire(db, row.id, at);
  assert.equal(getTrigger(db, "o", row.id)!.nextFire, null);
  markSkipped(db, row.id, { at, outcome: "skipped", reason: "storm cap" }, at);
  assert.equal(getTrigger(db, "o", row.id)!.nextFire, at + 60_000);
  markFired(db, row.id, { at: at + 60_000, outcome: "started", box: "b2" }, at + 60_000);
  assert.equal(getTrigger(db, "o", row.id)!.nextFire, null);
  assert.equal(promoteTrigger(db, "o", row.id), undefined);
});
