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
 * Memory-first, optionally durable: pass a Db and every mutation is mirrored to `inbox_messages`,
 * and construction hydrates the queues so a controller restart resumes with the mail intact
 * (hydrated messages are simply queued again — the delivery loop picks them up, no double-send).
 * Persistence is best-effort: any sqlite failure logs to stderr and the inbox continues in memory
 * (the old behavior). Pure enough to test with injected read/resume.
 */
import type { WatchSnapshot } from "./monitor.js";
import type { Db } from "./db.js";

export interface QueuedMessage {
  id: string;
  text: string;
  at: number;
}

export class Inbox {
  private readonly queues = new Map<string, QueuedMessage[]>();
  private seq = 0;
  private readonly db?: Db;

  constructor(db?: Db) {
    this.db = db;
    if (!db) return;
    try {
      const rows = db
        .prepare(`SELECT box, msg_id, text, created_at FROM inbox_messages ORDER BY id`)
        .all() as { box: string; msg_id: string; text: string; created_at: number }[];
      for (const r of rows) {
        const list = this.queues.get(r.box) ?? [];
        list.push({ id: r.msg_id, text: r.text, at: r.created_at });
        this.queues.set(r.box, list);
        const n = /^q(\d+)$/.exec(r.msg_id);
        if (n) this.seq = Math.max(this.seq, Number(n[1]));
      }
    } catch (e) {
      process.stderr.write(`[inbox] hydrate from db failed, starting empty: ${(e as Error).message}\n`);
    }
  }

  private persist(fn: (db: Db) => void): void {
    if (!this.db) return;
    try {
      fn(this.db);
    } catch (e) {
      process.stderr.write(`[inbox] persistence failed (continuing in memory): ${(e as Error).message}\n`);
    }
  }

  enqueue(session: string, text: string, now = Date.now()): QueuedMessage {
    const m: QueuedMessage = { id: `q${++this.seq}`, text, at: now };
    const list = this.queues.get(session) ?? [];
    list.push(m);
    this.queues.set(session, list);
    this.persist((db) =>
      db
        .prepare(`INSERT INTO inbox_messages (box, msg_id, text, created_at) VALUES (?, ?, ?, ?)`)
        .run(session, m.id, m.text, m.at),
    );
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
    this.persist((db) => db.prepare(`DELETE FROM inbox_messages WHERE box = ? AND msg_id = ?`).run(session, id));
    return true;
  }

  /** Take everything queued for a box (for delivery), leaving the queue empty. */
  drain(session: string): QueuedMessage[] {
    const list = this.queues.get(session) ?? [];
    this.queues.delete(session);
    if (list.length) this.persist((db) => db.prepare(`DELETE FROM inbox_messages WHERE box = ?`).run(session));
    return list;
  }

  clear(session: string): void {
    this.queues.delete(session);
    this.persist((db) => db.prepare(`DELETE FROM inbox_messages WHERE box = ?`).run(session));
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
