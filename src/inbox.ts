/**
 * Inbox — follow-ups sent while the agent is mid-turn.
 *
 * A running Claude session cannot safely take a second `claude -c` (it would race the turn already in
 * flight), so the old dashboard simply refused to send. That is the wrong shape for a chat: the
 * operator types what they want, and the SYSTEM should hold it until it can be delivered. The inbox
 * queues messages per box; a small delivery loop watches each box with queued mail and resumes it the
 * moment its run reaches `done`. A box that pauses on a QUESTION is not auto-fed (the queued text was
 * written before the question existed) — the UI offers "send as the answer" instead.
 *
 * In-memory: the queue is short-lived by nature and the UI shows it, so a controller restart losing
 * it is visible, not silent. Pure enough to test with injected read/resume.
 */
import type { WatchSnapshot } from "./monitor.js";

export interface QueuedMessage {
  id: string;
  text: string;
  at: number;
}

export class Inbox {
  private readonly queues = new Map<string, QueuedMessage[]>();
  private seq = 0;

  enqueue(session: string, text: string, now = Date.now()): QueuedMessage {
    const m: QueuedMessage = { id: `q${++this.seq}`, text, at: now };
    const list = this.queues.get(session) ?? [];
    list.push(m);
    this.queues.set(session, list);
    return m;
  }

  list(session: string): QueuedMessage[] {
    return [...(this.queues.get(session) ?? [])];
  }

  remove(session: string, id: string): boolean {
    const list = this.queues.get(session);
    if (!list) return false;
    const next = list.filter((m) => m.id !== id);
    if (next.length === list.length) return false;
    if (next.length) this.queues.set(session, next);
    else this.queues.delete(session);
    return true;
  }

  /** Take everything queued for a box (for delivery), leaving the queue empty. */
  drain(session: string): QueuedMessage[] {
    const list = this.queues.get(session) ?? [];
    this.queues.delete(session);
    return list;
  }

  clear(session: string): void {
    this.queues.delete(session);
  }

  sessions(): string[] {
    return [...this.queues.keys()];
  }
}

/** Join queued messages into one follow-up for `claude -c`, in order, separated clearly. */
export function joinQueued(messages: QueuedMessage[]): string {
  return messages.map((m) => m.text.trim()).filter(Boolean).join("\n\n");
}

/**
 * The delivery loop. Every tick, for each box with mail: read its state; when the run is `done` (or
 * idle — nothing running), drain and resume. `waiting` is left alone by design. A box that is gone
 * (`missing`) loses its queue — there is nothing to deliver to.
 */
export function startInboxDelivery(opts: {
  inbox: Inbox;
  read: (session: string) => Promise<WatchSnapshot>;
  resume: (session: string, message: string) => Promise<unknown>;
  intervalMs?: number;
  log?: (msg: string) => void;
}): () => void {
  const interval = opts.intervalMs ?? 3000;
  const log = opts.log ?? (() => {});
  const delivering = new Set<string>();
  const tick = async () => {
    for (const session of opts.inbox.sessions()) {
      if (delivering.has(session)) continue;
      delivering.add(session);
      try {
        const snap = await opts.read(session);
        if (snap.boxStatus === "missing") {
          opts.inbox.clear(session);
          continue;
        }
        if (snap.runState === "done" || snap.runState === "idle") {
          const batch = opts.inbox.drain(session);
          if (!batch.length) continue;
          log(`[inbox] delivering ${batch.length} queued message(s) to ${session}`);
          try {
            await opts.resume(session, joinQueued(batch));
          } catch (e) {
            // Put them back so the operator can see and retry; never lose typed text silently.
            for (const m of batch) opts.inbox.enqueue(session, m.text, m.at);
            log(`[inbox] delivery to ${session} failed: ${(e as Error).message}`);
          }
        }
      } catch {
        // transient read failure; try next tick
      } finally {
        delivering.delete(session);
      }
    }
  };
  const t = setInterval(() => void tick(), interval);
  return () => clearInterval(t);
}
