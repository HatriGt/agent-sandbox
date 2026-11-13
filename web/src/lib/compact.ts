/**
 * `/compact` in the composer: a command to Claude Code, not words for the agent. Sent as its own
 * turn (the server queues it behind a running turn and delivers it alone — src/inbox.ts), it
 * summarizes the conversation so far and the session continues from the summary. Text after the
 * command steers the summary ("/compact keep the API decisions").
 */
export const COMPACT_COMMAND = {
  name: "compact",
  description: "Summarize the conversation so far to free up context",
};

export function isCompactCommand(text: string): boolean {
  return /^\/compact(?:\s|$)/.test(text.trim());
}

/** The focus instructions after `/compact`, if any. */
export function compactInstructions(text: string): string {
  return text.trim().replace(/^\/compact\s*/, "").trim();
}
