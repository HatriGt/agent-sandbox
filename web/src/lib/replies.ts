/**
 * Optimistic reply echoes vs the durable log.
 *
 * A sent message is echoed immediately (a server round-trip before anything appears reads as a
 * broken chat) and the durable ⟦you⟧ line in the log replaces it once it lands. The subtlety: the
 * log arrives as a bounded TAIL, so an old ⟦you⟧ line eventually scrolls out of the window. An echo
 * must therefore be retired the FIRST time its persisted copy is seen — never resurrected later
 * when the tail no longer contains it, or a message from hours ago reappears as if just sent.
 */
export function splitReplies(
  replies: string[],
  persisted: ReadonlySet<string>,
  settled: ReadonlySet<string>
): { pending: string[]; nowSettled: string[] } {
  const pending: string[] = [];
  const nowSettled: string[] = [];
  for (const r of replies) {
    const key = r.trim();
    if (settled.has(key)) continue; // seen persisted before — retired for good
    if (persisted.has(key)) nowSettled.push(r);
    else pending.push(r);
  }
  return { pending, nowSettled };
}
