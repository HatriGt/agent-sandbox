import type { AuditEventRow } from "./api";

/** Mirrors web/src/lib/activity.ts `describeEvent` / `eventKind`: raw method+path → a human verb. */
const TABLE: Record<string, [string, boolean]> = {
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

export function describeEvent(e: Pick<AuditEventRow, "method" | "path" | "session" | "action">): { verb: string; session: string | null } {
  const p = e.path.replace(/\/+$/, "");
  const key = `${e.method} ${p}`;
  if (key === "POST /git.json") return { verb: e.action ? `Git ${e.action} on` : "Git action on", session: e.session };
  const hit = TABLE[key];
  if (!hit) return { verb: `${e.method} ${p}`, session: null };
  return { verb: hit[0], session: hit[1] ? e.session : null };
}

export type AuditKind = "machines" | "code" | "account";
/** Which lane an event belongs to — drives the filter and the dot colour. */
export function eventKind(e: Pick<AuditEventRow, "path" | "session">): AuditKind {
  if (/^\/(pr|git|repos)\b/.test(e.path)) return "code";
  if (e.session || /^\/(delegate|teardown|resume|ask|wake|sleep|keep|rename|revert|memory|disk|file)\.json/.test(e.path)) return "machines";
  return "account";
}
