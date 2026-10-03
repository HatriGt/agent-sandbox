import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleCategory, threadSchedule, type ScheduleTrigger } from "../src/thread-schedule.js";
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
