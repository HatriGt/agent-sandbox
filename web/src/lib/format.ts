import type { BoxRole, BoxView, RunState } from "./api";

export const POLL_MS = 3000;

/** Role in the operator's words, not the wire's. */
export function roleLabel(role: BoxRole): string {
  return role === "pool-free" ? "warm pool" : role === "pool-claimed" ? "session · pool" : "session";
}

/** A box only counts as "up" when msb says it is running; a stopped box can do nothing. */
export function isUp(v: BoxView): boolean {
  return /^running$/i.test(v.boxStatus ?? "");
}

export function stateLabel(v: Pick<BoxView, "runState" | "exitCode">): string {
  if (v.runState === "done") return `done${v.exitCode != null ? ` · exit ${v.exitCode}` : ""}`;
  if (v.runState === "waiting") return "needs an answer";
  return v.runState;
}

export function stateVariant(s: RunState): "live" | "attention" | "info" | "muted" {
  return s === "running" ? "live" : s === "waiting" ? "attention" : s === "done" ? "info" : "muted";
}

/**
 * Sort for triage: anything blocked on a human first, then working boxes, then the rest. The list
 * answers "does anything need me?" before it answers "what exists?".
 */
export function triageSort(a: BoxView, b: BoxView): number {
  const rank = (v: BoxView) => (v.runState === "waiting" ? 0 : v.runState === "running" ? 1 : 2);
  const roleRank: Record<BoxRole, number> = { session: 0, "pool-claimed": 1, "pool-free": 2 };
  return rank(a) - rank(b) || roleRank[a.role] - roleRank[b.role] || a.name.localeCompare(b.name);
}

/** Box names are long and machine-generated; the tail is the part that actually differs. */
export function shortName(name: string): string {
  const m = name.match(/^pool-\d+-(.+)$/);
  return m ? m[1] : name;
}

// Escape/control characters are written as explicit \u escapes: a literal ESC byte in source is
// invisible to every reviewer and does not survive a copy-paste.
const ESC = "\u001b";
const BEL = "\u0007";
const ANSI_RE = new RegExp(
  [
    ESC + "\\[[0-9;?]*[ -/]*[@-~]", // CSI: colours, cursor moves
    ESC + "\\][^" + BEL + "]*(?:" + BEL + "|" + ESC + "\\\\)", // OSC
    ESC + "[=>PX^_].*?(?:" + ESC + "\\\\|" + BEL + ")", // other escapes
  ].join("|"),
  "g"
);
// Stray control characters, keeping tab (\u0009), newline (\u000a) and carriage return (\u000d).
const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** Strip escape sequences and carriage-return spinner rewrites so the log reads as plain text. */
export function cleanLog(raw: string): string {
  return String(raw ?? "")
    .replace(ANSI_RE, "")
    .replace(/[^\n]*\r(?!\n)/g, "") // CR overwrites: keep only the final segment of the line
    .replace(CTRL_RE, "")
    .replace(/\n{3,}/g, "\n\n");
}

export type LogTone = "err" | "warn" | "ok" | "cmd" | "tool" | "question" | "plain";

/** Classify a log line so the terminal can colour it. */
export function logTone(line: string): LogTone {
  const t = line.trim();
  if (!t) return "plain";
  if (/^→\s|^\s+Tool:/.test(t)) return "tool";
  if (/error|fail(ed|ure)?|exception|traceback|fatal|✗|✘|\bENO|denied|rejected/i.test(t)) return "err";
  if (/warn(ing)?|deprecat|retired|⚠/i.test(t)) return "warn";
  if (/success|✓|✔|completed|created|passed|✅|committed|pushed|opened pr/i.test(t)) return "ok";
  if (/^[$>#❯]\s|^\s*(npm|git|gh|node|claude|sh|bash|cd|export|curl|yarn|pnpm)\b/.test(t)) return "cmd";
  if (/^\s*(❓|QUESTION[: ]|USER-INPUT)/i.test(t)) return "question";
  return "plain";
}
