// @-mention token detection + expansion, ported from web MentionMenu.tsx.
export interface MentionState {
  start: number;
  query: string;
}

/** Find an active `@query` token ending at the caret, or null. */
export function mentionAt(value: string, caret: number): MentionState | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/[\s(\[]/.test(before[at - 1])) return null; // an email or mid-word @
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/** Expand `@path` mentions into an explicit footnote so the agent reads the right files. */
export function expandMentions(text: string): string {
  const paths = [...new Set([...text.matchAll(/(?:^|[\s(\[])@([^\s)\]]+)/g)].map((m) => m[1]))];
  if (!paths.length) return text;
  return `${text}\n\nReferenced files (under /workspace): ${paths.map((p) => `/workspace/${p}`).join(", ")}`;
}
