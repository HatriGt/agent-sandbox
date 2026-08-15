/**
 * In-memory registry of delegated sessions. Maps a stable session id to its box name and
 * metadata so status/resume/teardown can find the box. The MCP process is long-lived, so
 * in-memory is enough for Phase 2; persistence can come later if we need restart survival.
 */
export interface Session {
  id: string;
  box: string;
  repo: string;
  task: string;
  /** Remote staging dir on the VPS holding this session's synced tree. */
  staging: string;
  createdAt: number;
}

const sessions = new Map<string, Session>();

/** Generate a session id + matching box name from a timestamp + short random suffix. */
export function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `delegate-${Date.now()}-${rand}`;
}

export function put(s: Session): void {
  sessions.set(s.id, s);
}

export function get(id: string): Session | undefined {
  return sessions.get(id);
}

export function remove(id: string): void {
  sessions.delete(id);
}
