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

/**
 * A stable, memorable display name for a machine.
 *
 * The real box name (`pool-1787747538458-0onjhe`) is a server-owned identifier — immutable and used
 * for every API call — but its random tail ("0onjhe") is unreadable and forgettable, so people can't
 * refer to "the one working on the migration" by name. We derive a Docker/Heroku-style `adjective-noun`
 * slug DETERMINISTICALLY from the full name: the same box always yields the same pair, no state needed,
 * and it survives reloads. This is purely a display alias; `box.name` remains the key for actions.
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

/** A tiny stable string hash (FNV-1a) so a box name always maps to the same slug. */
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
  const t = (v.task ?? "").trim();
  if (!t) return v.role === "pool-free" ? "Idle machine" : "Untitled run";
  const firstLine = t.split("\n")[0];
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
}

export function stateNoun(s: RunState): string {
  return s === "waiting" ? "needs you" : s;
}

/**
 * Label for a finished run. A clean exit (code 0) is just "done" — showing "exit 0" reads like an
 * error to anyone who isn't a shell user. A non-zero (or unknown) exit keeps the code as a real
 * failure signal; the caller styles that case distinctly (red).
 */
export function doneLabel(exitCode?: number): string {
  return exitCode === 0 ? "done" : `exit ${exitCode ?? "?"}`;
}

/** Whether a finished run should be styled as a failure (non-zero exit). */
export function isFailedExit(exitCode?: number): boolean {
  return exitCode != null && exitCode !== 0;
}
