/**
 * Optimistic reply echoes vs the durable log.
 *
 * A sent message is echoed immediately (a server round-trip before anything appears reads as a
 * broken chat) and the durable ⟦you⟧ line in the log replaces it once it lands. Three things make
 * "has my echo landed?" harder than a text lookup, and each one was a visible bug:
 *
 *  - The same words are sent twice ("continue", "continue"). A lookup by text retires the second
 *    echo against the FIRST message's line, so the second send showed nothing at all.
 *  - The log arrives as a bounded TAIL, so an old line eventually scrolls out of the window. An
 *    echo must be retired the first time its line is seen and never come back.
 *  - The log copy is not byte-identical to what was typed: the controller wedges a zero-width
 *    space in front of sentinel characters, and line endings are normalised.
 *
 * So an echo remembers WHEN it was sent, on the log's own clock (the newest stamp in the log at
 * that moment — never the browser clock, which can be minutes off the server's), and it is matched
 * only by a line that arrived after that. Matching consumes lines one for one, in order.
 */
export interface PendingReply {
  id: string;
  /** Exactly what was delivered to the agent; the thread renders it the same way as the log line. */
  text: string;
  /** Newest stamp in the log when this was sent. A line at or before it is an older message. */
  after?: number;
  /** How many lines with this same text the log already held (the fallback for unstamped logs). */
  seen: number;
  /** Browser time of the send; only ever compared with the browser clock. */
  sentAt: number;
}

/** A ⟦you⟧ line from the log, in log order. */
export interface SentLine {
  text: string;
  at?: number;
}

/** After this long, a new line that matches no echo's text is taken as the oldest echo's copy:
 *  a transformed message must not leave a duplicate bubble behind for the life of the tab. */
export const ADOPT_AFTER_MS = 20_000;

/** The text as the log would carry it: defang marks dropped, line endings and edges normalised. */
export function replyKey(text: string): string {
  return text.replace(/​/g, "").replace(/\r\n?/g, "\n").trim();
}

let counter = 0;
/** Record an echo against the log as it stands right now. */
export function stampReply(text: string, lines: readonly SentLine[], lastAt: number | undefined, nowMs = Date.now()): PendingReply {
  const key = replyKey(text);
  return {
    id: `${nowMs.toString(36)}-${(counter++).toString(36)}`,
    text,
    ...(lastAt !== undefined ? { after: lastAt } : {}),
    seen: lines.filter((l) => replyKey(l.text) === key).length,
    sentAt: nowMs,
  };
}

export interface ReplyMatch {
  /** Echoes still waiting for their line. */
  pending: PendingReply[];
  /** Echoes whose line has landed, with the index (into `lines`) of the line that replaced each. */
  settled: { id: string; line: number }[];
}

export function matchReplies(replies: readonly PendingReply[], lines: readonly SentLine[], nowMs = Date.now()): ReplyMatch {
  if (!replies.length) return { pending: [], settled: [] };
  const keys = lines.map((l) => replyKey(l.text));
  // Which occurrence of its text each line is (1-based): the unstamped fallback's notion of "new".
  const ordinal: number[] = [];
  const counts = new Map<string, number>();
  keys.forEach((k, i) => {
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    ordinal[i] = n;
  });
  const used = new Set<number>();
  const isNewFor = (r: PendingReply, i: number, sameText: boolean) => {
    const at = lines[i].at;
    if (at !== undefined && r.after !== undefined) return at > r.after;
    // No clock on one side: only a same-text line can be judged, by counting past what was there.
    return sameText && ordinal[i] > r.seen;
  };
  const settled: { id: string; line: number }[] = [];
  const waiting: PendingReply[] = [];
  for (const r of replies) {
    const key = replyKey(r.text);
    let hit = -1;
    for (let i = 0; i < lines.length && hit < 0; i++) if (!used.has(i) && keys[i] === key && isNewFor(r, i, true)) hit = i;
    if (hit >= 0) {
      used.add(hit);
      settled.push({ id: r.id, line: hit });
    } else waiting.push(r);
  }
  // Second pass: an echo nothing matched for a while adopts the first new line nobody claimed.
  const pending: PendingReply[] = [];
  for (const r of waiting) {
    let hit = -1;
    if (nowMs - r.sentAt >= ADOPT_AFTER_MS) {
      for (let i = 0; i < lines.length && hit < 0; i++) if (!used.has(i) && isNewFor(r, i, false)) hit = i;
    }
    if (hit >= 0) {
      used.add(hit);
      settled.push({ id: r.id, line: hit });
    } else pending.push(r);
  }
  return { pending, settled };
}
