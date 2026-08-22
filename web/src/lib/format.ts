import type { BoxRole, BoxView, RunState } from "./api";

export const POLL_MS = 3000;

export function roleLabel(role: BoxRole): string {
  return role === "pool-free" ? "warm pool" : role === "pool-claimed" ? "claimed" : "session";
}

/** Only a running box can be doing anything; a stopped one is history. */
export function isUp(v: BoxView): boolean {
  return /^running$/i.test(v.boxStatus ?? "");
}

/** Threads are ordered by who needs attention, not by name. */
export function threadSort(a: BoxView, b: BoxView): number {
  const rank = (v: BoxView) => (v.runState === "waiting" ? 0 : v.runState === "running" ? 1 : 2);
  const roleRank: Record<BoxRole, number> = { session: 0, "pool-claimed": 0, "pool-free": 1 };
  return rank(a) - rank(b) || roleRank[a.role] - roleRank[b.role] || a.name.localeCompare(b.name);
}

/** Machine names are long and generated; the tail is the identifying part. */
export function shortName(name: string): string {
  const m = name.match(/^pool-\d+-(.+)$/);
  return m ? m[1] : name;
}

/** First sentence-ish of a task, for the thread list. */
export function threadTitle(v: BoxView): string {
  const t = (v.task ?? "").trim();
  if (!t) return v.role === "pool-free" ? "Idle machine" : "Untitled run";
  const firstLine = t.split("\n")[0];
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
}

export function stateNoun(s: RunState): string {
  return s === "waiting" ? "needs you" : s;
}
