import type { BoxRole, BoxView, RunState } from "./api";
import { displayState } from "./lifecycle";

export const POLL_MS = 3000;

export function roleLabel(role: BoxRole): string {
  return role === "pool-free" ? "warm pool" : role === "pool-claimed" ? "claimed" : "session";
}

/** The microVM is up. */
export function isUp(v: BoxView): boolean {
  return /^running$/i.test(v.boxStatus ?? "");
}

/** Idle-stopped but intact: rootfs and Claude session survive; `resume` restarts it. */
export function isSleeping(v: BoxView): boolean {
  return /^stopped$/i.test(v.boxStatus ?? "");
}

/**
 * What the dashboard lists: every running box, plus sleeping boxes that carried a run (a warm-pool
 * box that died without ever being claimed is dead capacity, not a machine anyone cares about).
 */
export function isVisible(v: BoxView): boolean {
  return isUp(v) || (isSleeping(v) && v.role !== "pool-free");
}

/** Threads are ordered by who needs attention, not by name. */
export function threadSort(a: BoxView, b: BoxView): number {
  const rank = (v: BoxView) => {
    if (v.runState === "waiting") return 0;
    const s = displayState(v);
    return s === "running" ? 1 : s === "done" ? 2 : s === "sleeping" ? 3 : 4;
  };
  const roleRank: Record<BoxRole, number> = { session: 0, "pool-claimed": 0, "pool-free": 1 };
  return rank(a) - rank(b) || roleRank[a.role] - roleRank[b.role] || a.name.localeCompare(b.name);
}

/** Machine names are long and generated; the tail is the identifying part. */
export function shortName(name: string): string {
  const m = name.match(/^pool-\d+-(.+)$/);
  return m ? m[1] : name;
}

/**
 * A stable, memorable display name for a machine: a Docker/Heroku-style `adjective-noun` slug derived
 * DETERMINISTICALLY from the real box name, so the same box always yields the same pair with no state.
 * Purely a display alias; `box.name` remains the key for every API call.
 */
const NAME_ADJECTIVES = [
  "amber", "brisk", "cobalt", "dusk", "ember", "fern", "glint", "hazel", "iris", "jade",
  "lunar", "mint", "nova", "onyx", "pine", "quartz", "rust", "sage", "teal", "vapor",
  "wren", "zephyr", "clay", "frost", "opal", "slate", "coral", "drift", "flint", "moss",
];
const NAME_NOUNS = [
  "otter", "falcon", "cedar", "harbor", "lark", "maple", "quokka", "raven", "sparrow", "tundra",
  "willow", "badger", "comet", "delta", "eagle", "finch", "grove", "heron", "ibis", "koi",
  "lynx", "marsh", "newt", "orbit", "puffin", "reef", "swift", "thorn", "vale", "yak",
];

function hashName(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function friendlyName(name: string): string {
  const h = hashName(name);
  const adj = NAME_ADJECTIVES[h % NAME_ADJECTIVES.length];
  const noun = NAME_NOUNS[(h >>> 8) % NAME_NOUNS.length];
  return `${adj}-${noun}`;
}

/** First sentence-ish of a task, for the thread list. */
export function threadTitle(v: BoxView): string {
  if (v.title?.trim()) return v.title.trim();
  const t = (v.task ?? "").trim();
  if (!t) return v.role === "pool-free" ? "No task yet" : "Untitled run";
  const firstLine = t.split("\n")[0];
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
}

export function stateNoun(s: RunState): string {
  return s === "waiting" ? "needs you" : s;
}

/**
 * A clean exit is just "done"; a non-zero (or unknown) exit keeps the code as a real failure signal.
 * 254 is the controller's reserved "run interrupted" code: the sandbox stopped mid-run (idle reaper,
 * host restart) and the status probe healed the stale run marker — the session is intact and resumable.
 */
export function doneLabel(exitCode?: number): string {
  if (exitCode === 254) return "interrupted";
  return exitCode === 0 ? "done" : `exit ${exitCode ?? "?"}`;
}

export function isFailedExit(exitCode?: number): boolean {
  return exitCode != null && exitCode !== 0;
}

/** "just now", "4m ago", "3h ago", "2d ago" — for last-activity stamps. */
export function fmtAgo(unixSec: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.floor(nowMs / 1000) - unixSec);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
