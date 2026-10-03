import { test } from "node:test";
import assert from "node:assert/strict";
import { threadSchedule, type ScheduleTrigger } from "../src/thread-schedule.js";

const t = (o: Partial<ScheduleTrigger> & { id: string }): ScheduleTrigger => ({
  name: o.id,
  kind: "schedule",
  spec: {} as ScheduleTrigger["spec"],
  taskTemplate: "do it",
  enabled: true,
  proposed: false,
  nextFire: 1000,
  when: "daily",
  ...o,
});

test("threadSchedule: proposals, created, repeats, after; others ignored", () => {
  const items = threadSchedule("b1", { kind: "trigger", triggerId: "P", name: "p", source: "schedule" } as never, [
    t({ id: "mine", sourceBox: "b1", nextFire: 50 }),
    t({ id: "prop", sourceBox: "b1", proposed: true, enabled: false }),
    t({ id: "dismissed", sourceBox: "b1", enabled: false }),
    t({ id: "P", nextFire: 10 }),
    t({ id: "chain", kind: "chain", spec: { afterTrigger: "P" } as ScheduleTrigger["spec"] }),
    t({ id: "other", sourceBox: "b2" }),
  ]);
  assert.deepEqual(
    items.map((i) => [i.id, i.relation, i.nextFire]),
    [
      ["prop", "proposed", null],
      ["mine", "created", 50],
      ["P", "repeats", 10],
      ["chain", "after", 1000],
    ]
  );
});

test("threadSchedule: a thread started by hand sees only its own", () => {
  assert.deepEqual(threadSchedule("b1", undefined, [t({ id: "P" })]), []);
});
