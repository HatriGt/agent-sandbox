import type { StartedBy } from "./started-by.js";
import type { TriggerKind, TriggerSpec } from "./triggers.js";

/**
 * What is scheduled "as part of" one thread — the thread's schedule pill. Pure: the route feeds it
 * the owner's automations and how the thread started.
 *
 *   proposed  the agent proposed it in this thread; paused until the owner approves
 *   created   proposed here and approved: it runs on its own schedule
 *   repeats   the schedule that started this thread fires again
 *   after     a chain that runs when this thread's automation finishes
 *
 * Disabled automations are not "scheduled", except a pending proposal (it is waiting on you).
 */
export type ScheduleRelation = "proposed" | "created" | "repeats" | "after";

export interface ScheduleTrigger {
  id: string;
  name: string;
  kind: TriggerKind;
  spec: TriggerSpec;
  taskTemplate: string;
  enabled: boolean;
  proposed: boolean;
  nextFire: number | null;
  sourceBox?: string;
  when: string;
}

export interface ScheduleItem {
  id: string;
  name: string;
  relation: ScheduleRelation;
  when: string;
  nextFire: number | null;
  enabled: boolean;
  task: string;
}

const ORDER: Record<ScheduleRelation, number> = { proposed: 0, created: 1, repeats: 2, after: 3 };

export function threadSchedule(box: string, startedBy: StartedBy | undefined, triggers: ScheduleTrigger[]): ScheduleItem[] {
  const parentId = startedBy?.kind === "trigger" ? startedBy.triggerId : undefined;
  const out: ScheduleItem[] = [];
  const add = (t: ScheduleTrigger, relation: ScheduleRelation) =>
    out.push({ id: t.id, name: t.name, relation, when: t.when, nextFire: t.enabled ? t.nextFire : null, enabled: t.enabled, task: t.taskTemplate.slice(0, 280) });
  for (const t of triggers) {
    if (t.sourceBox === box) {
      if (t.proposed && !t.enabled) add(t, "proposed");
      else if (t.enabled) add(t, "created");
    } else if (parentId && t.enabled) {
      if (t.id === parentId && t.kind === "schedule") add(t, "repeats");
      else if (t.kind === "chain" && t.spec.afterTrigger === parentId) add(t, "after");
    }
  }
  // Waiting on you first, then soonest.
  return out.sort((a, b) => ORDER[a.relation] - ORDER[b.relation] || (a.nextFire ?? Infinity) - (b.nextFire ?? Infinity));
}
