import type { AuditEventRow } from "@/lib/api";

/**
 * The audit trail, narrated. The server stores facts (method + path + status); this module turns
 * them into the sentences the Activity page and the Hub teaser show. Kept pure so both surfaces
 * read one vocabulary.
 */

/**
 * The raw audit row (method + path) turned into a human verb. `session` slots into the sentence
 * where it reads naturally; unknown paths fall back to "METHOD /path" verbatim.
 */
export function describeEvent(e: Pick<AuditEventRow, "method" | "path" | "session" | "action">): { verb: string; session: string | null } {
  const p = e.path.replace(/\/+$/, "");
  const s = e.session;
  // [verb, whether it reads as "<verb> <session>"]
  const table: Record<string, [string, boolean]> = {
    "POST /delegate.json": ["Started a machine", false],
    "POST /teardown.json": ["Destroyed", true],
    "POST /resume.json": ["Sent a message to", true],
    "POST /ask.json": ["Asked the co-pilot about", true],
    "POST /wake.json": ["Woke", true],
    "POST /sleep.json": ["Put to sleep:", true],
    "POST /keep.json": ["Pinned or released", true],
    "POST /rename.json": ["Renamed", true],
    "POST /revert.json": ["Reverted", true],
    "POST /memory.json": ["Resized memory of", true],
    "POST /disk.json": ["Grew the disk of", true],
    "PUT /file.json": ["Wrote a file in", true],
    "POST /pr/merge.json": ["Merged a PR", false],
    "POST /pr/approve.json": ["Approved a PR", false],
    "POST /pr/comment.json": ["Commented on a PR", false],
    "POST /pr/review.json": ["Reviewed a PR", false],
    "POST /pr/state.json": ["Changed a PR's state", false],
    "POST /repos/attach.json": ["Attached a repository to", true],
    "POST /api-keys.json": ["Created an API key", false],
    "DELETE /api-keys.json": ["Revoked an API key", false],
    "DELETE /sessions.json": ["Signed out a device", false],
    "DELETE /devices.json": ["Signed out a device", false],
    "POST /account.json": ["Updated the profile", false],
    "POST /notify.json": ["Changed notification settings", false],
    "POST /accounts.json": ["Connected a GitHub account", false],
    "DELETE /accounts.json": ["Disconnected a GitHub account", false],
    "POST /skills.json": ["Changed a skill", false],
    "POST /mcp-servers.json": ["Changed MCP servers", false],
    "POST /auth/logout": ["Signed out", false],
    "POST /auth/login": ["Signed in", false],
  };
  const key = `${e.method} ${p}`;
  if (key === "POST /git.json") return { verb: e.action ? `Git ${e.action} on` : "Git action on", session: s };
  const hit = table[key];
  if (!hit) return { verb: `${e.method} ${p}`, session: null };
  return { verb: hit[0], session: hit[1] ? s : null };
}

export type Kind = "machines" | "code" | "account";
/** Which lane an event belongs to — drives the filter chips and the dot colour. */
export function eventKind(e: Pick<AuditEventRow, "path" | "session">): Kind {
  const p = e.path;
  if (/^\/(pr|git|repos)\b/.test(p)) return "code";
  if (e.session || /^\/(delegate|teardown|resume|ask|wake|sleep|keep|rename|revert|memory|disk|file)\.json/.test(p)) return "machines";
  return "account";
}

export type ActivityFilter = "all" | Kind | "failed";
export const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "machines", label: "Machines" },
  { value: "code", label: "Code" },
  { value: "account", label: "Account" },
  { value: "failed", label: "Failed" },
];

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
function dayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
/** "Today" / "Yesterday" / "Sep 3" — the timeline's day headers. Epoch milliseconds. */
export function dayLabel(ms: number) {
  const k = dayKey(ms);
  if (k === dayKey(Date.now())) return "Today";
  if (k === dayKey(Date.now() - 86400_000)) return "Yesterday";
  return day.format(ms);
}
