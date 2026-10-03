import type { StartedBy } from "./started-by.js";
import { automateNeedsApproval, type TriggerKind, type TriggerSpec } from "./triggers.js";

/**
 * What is scheduled "as part of" one thread — the thread's schedule pill. Pure: the route feeds it
 * the owner's automations and how the thread started.
 *
 *   proposed  the agent scheduled it here but it is critical; paused until the owner approves
 *   created   scheduled from this thread: it runs on its own schedule
 *   repeats   the schedule that started this thread fires again
 *   after     a chain that runs when this thread's automation finishes
 *
 * Paused ones are listed too (enabled: false, no next run) so they can be resumed from the thread.
 */
export type ScheduleRelation = "proposed" | "created" | "repeats" | "after";

/** What kind of work a scheduled task is, for the pill's table. Read off the task text. */
export type ScheduleCategory = "ci" | "deploy" | "monitor" | "report" | "follow-up" | "maintenance" | "task";

export interface ScheduleTrigger {
  id: string;
  name: string;
  kind: TriggerKind;
  spec: TriggerSpec;
  taskTemplate: string;
  enabled: boolean;
  proposed: boolean;
  nextFire: number | null;
  lastFired?: number | null;
  lastResult?: { at: number; outcome: string; box?: string; reason?: string } | null;
  repo?: string;
  sourceBox?: string;
  when: string;
}

export interface ScheduleItem {
  id: string;
  name: string;
  relation: ScheduleRelation;
  category: ScheduleCategory;
  when: string;
  cron?: string;
  nextFire: number | null;
  lastFired: number | null;
  lastOutcome?: string;
  lastBox?: string;
  repo?: string;
  enabled: boolean;
  task: string;
  /** Why a pending one waits for the owner. */
  why?: string;
}

const ORDER: Record<ScheduleRelation, number> = { proposed: 0, created: 1, repeats: 2, after: 3 };

const CATEGORIES: [ScheduleCategory, RegExp][] = [
  ["deploy", /\b(deploy\w*|release|publish|rollout|roll out|ship)\b/i],
  ["ci", /\b(ci|build|tests?|pipeline|workflow run|checks?|lint|pull request|pr)\b/i],
  ["monitor", /\b(monitor|watch|poll|uptime|health|alert|status|latency|errors?|logs?)\b/i],
  ["report", /\b(report|summar\w*|digest|metrics|analytics|stats)\b/i],
  ["maintenance", /\b(clean\w*|prune|backup|rotate|upgrade|update dep\w*|bump|renew|vacuum)\b/i],
  ["follow-up", /\b(follow[- ]?up|remind\w*|check (back|again|in)|revisit|later)\b/i],
];

export function scheduleCategory(task: string): ScheduleCategory {
  return CATEGORIES.find(([, re]) => re.test(task))?.[0] ?? "task";
}

export function threadSchedule(box: string, startedBy: StartedBy | undefined, triggers: ScheduleTrigger[]): ScheduleItem[] {
  const parentId = startedBy?.kind === "trigger" ? startedBy.triggerId : undefined;
  const out: ScheduleItem[] = [];
  const add = (t: ScheduleTrigger, relation: ScheduleRelation) =>
    out.push({
      id: t.id,
      name: t.name,
      relation,
      category: scheduleCategory(`${t.name} ${t.taskTemplate}`),
      when: t.when,
      ...(t.spec.cron ? { cron: t.spec.cron } : {}),
      nextFire: t.enabled ? t.nextFire : null,
      lastFired: t.lastFired ?? null,
      ...(t.lastResult ? { lastOutcome: t.lastResult.outcome, ...(t.lastResult.box ? { lastBox: t.lastResult.box } : {}) } : {}),
      ...(t.repo ? { repo: t.repo } : {}),
      enabled: t.enabled,
      task: t.taskTemplate.slice(0, 2000),
      ...(relation === "proposed" ? { why: automateNeedsApproval(t.spec.cron ?? "", t.taskTemplate) ?? "The agent asked for your OK" } : {}),
    });
  for (const t of triggers) {
    // Paused ones stay listed (dimmed) so the pill can resume them; dismissing deletes.
    if (t.sourceBox === box) add(t, t.proposed && !t.enabled ? "proposed" : "created");
    else if (parentId) {
      if (t.id === parentId && t.kind === "schedule") add(t, "repeats");
      else if (t.kind === "chain" && t.spec.afterTrigger === parentId) add(t, "after");
    }
  }
  // Waiting on you first, then soonest.
  return out.sort((a, b) => ORDER[a.relation] - ORDER[b.relation] || Number(b.enabled) - Number(a.enabled) || (a.nextFire ?? Infinity) - (b.nextFire ?? Infinity));
}
