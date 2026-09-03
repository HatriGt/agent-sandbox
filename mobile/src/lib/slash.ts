/**
 * `/` skill token detection for the composer. A slash opens the skill menu when it starts a token —
 * beginning of the message or right after whitespace — and the caret is still inside that token.
 * Mid-word slashes (a/b), URLs (https://…) and paths typed after a word boundary still match only
 * until the skill list has no hit, at which point the menu simply isn't shown, so typing
 * `/workspace/...` just types.
 */
export interface SlashState {
  /** Index of the `/` that opened the token, in the textarea value. */
  start: number;
  /** The skill-name query: the token after the slash, up to the first whitespace. */
  query: string;
}

/** Active `/query` token containing the caret, starting the message or a word, or null. */
export function slashAt(value: string, caret: number): SlashState | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("/");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null; // mid-word or URL slash
  const typed = before.slice(at + 1);
  if (/[\s/]/.test(typed)) return null; // token already ended, or a path segment
  // The full token may continue past the caret; the query is what's typed so far.
  return { start: at, query: typed };
}

/**
 * Remove the `/token` at `start` from the value (the picked skill becomes a chip instead).
 * Also eats one following space so the join reads naturally.
 */
export function stripSlashToken(value: string, start: number): { value: string; caret: number } {
  const ws = value.slice(start).search(/\s/);
  const end = ws === -1 ? value.length : start + ws;
  const after = value.slice(end).replace(/^ /, "");
  const before = value.slice(0, start);
  return { value: before + after, caret: before.length };
}

/** A hand-typed complete `/name ` token (start of message or after whitespace), or null. */
export function typedSkillToken(value: string): { name: string; start: number; length: number } | null {
  const m = /(^|\s)\/([a-z0-9][a-z0-9-]*)(\s)/.exec(value);
  if (!m) return null;
  const start = m.index + m[1].length;
  return { name: m[2], start, length: 1 + m[2].length + m[3].length };
}
