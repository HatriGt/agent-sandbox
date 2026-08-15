/**
 * Session id generation. The id doubles as the microVM box name and, combined with
 * VPS_STAGING_DIR, fully determines the staging path — so status/resume/teardown need no
 * shared in-memory state and survive MCP process respawns.
 */

/** Generate a session id (also used as the box name): timestamp + short random suffix. */
export function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `delegate-${Date.now()}-${rand}`;
}
