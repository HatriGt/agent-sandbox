/**
 * Tags inside a message: `/skill-name` and `@path/to/file`.
 *
 * A tag is plain text in the message, sitting where the person put it ("check this /review-pr, then
 * look at @src/app.ts"). The composer draws a tinted pill behind it and the thread bubble draws it as
 * a chip, but what is stored, sent and recalled is the text itself. That is what lets a message carry
 * several skills and several files, each in the sentence that talks about it.
 *
 * The two patterns are the ones the rest of the system already reads: the controller picks skills out
 * of a message with the `/name` rule (src/skill-match.ts), and `expandMentions` spells every `@path`
 * as an absolute path for the agent.
 */
export interface InlineToken {
  /** `quote` exists only in the composer: a `❝start of the passage…❞` stand-in for a quoted passage. */
  kind: "skill" | "file" | "quote";
  /** Index of the `/` or `@`. */
  start: number;
  /** One past the last character of the tag. */
  end: number;
  /** The skill name or the workspace path, without its sigil. */
  name: string;
}

const SKILL = /(^|\s)\/([a-z0-9][a-z0-9-]{0,49})(?=$|[\s.,:;!?)])/g;
const FILE = /(^|[\s(\[])@([^\s)\]]+)/g;

/**
 * Every tag in `text`, in order. A `/name` counts only when `skills` knows the name, so `/tmp` or
 * `/usr` in prose stays prose; pass null to skip skills (the list has not loaded).
 */
export function inlineTokens(text: string, skills: ReadonlySet<string> | null): InlineToken[] {
  const out: InlineToken[] = [];
  if (skills && skills.size) {
    for (const m of text.matchAll(SKILL)) {
      if (!skills.has(m[2])) continue;
      const start = m.index + m[1].length;
      out.push({ kind: "skill", start, end: start + 1 + m[2].length, name: m[2] });
    }
  }
  for (const m of text.matchAll(FILE)) {
    const start = m.index + m[1].length;
    // Sentence punctuation right after a path is the sentence's, not the path's.
    const name = m[2].replace(/[.,:;!?]+$/, "");
    if (!name) continue;
    out.push({ kind: "file", start, end: start + 1 + name.length, name });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A quoted passage's stand-in in the composer text: `❝The limiter now keeps six…❞`. */
export const QUOTE_TOKEN = /❝[^❝❞\n]{1,80}❞/g;

/** The quote stand-ins in a composer's text. */
export function quoteTokens(text: string): InlineToken[] {
  return [...text.matchAll(QUOTE_TOKEN)].map((m) => ({ kind: "quote" as const, start: m.index, end: m.index + m[0].length, name: m[0] }));
}

/**
 * Put `token` in place of `value[start, end)`, with a space on each side where the neighbours need
 * one. The caret lands after the tag and its space, ready for the next word.
 */
export function insertToken(value: string, start: number, end: number, token: string): { value: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/[\s(\[]$/.test(before) ? " " : "";
  const tail = /^\s/.test(after) ? "" : " ";
  const head = before + lead + token + tail;
  // Step over a space that was already there, so the caret is never left touching the tag.
  return { value: head + after, caret: head.length + (tail ? 0 : 1) };
}

/** Take a tag out, with the one space that followed it. */
export function removeToken(value: string, t: Pick<InlineToken, "start" | "end">): { value: string; caret: number } {
  const after = value.slice(t.end);
  return { value: value.slice(0, t.start) + (after.startsWith(" ") ? after.slice(1) : after), caret: t.start };
}

/** The tag whose last character sits just before the caret, if any. */
export function tokenEndingAt(tokens: InlineToken[], caret: number): InlineToken | null {
  return tokens.find((t) => t.end === caret) ?? null;
}

/** The message split into prose and tags, for drawing. */
export function splitTokens(text: string, tokens: InlineToken[]): ({ text: string } | { token: InlineToken; text: string })[] {
  const out: ({ text: string } | { token: InlineToken; text: string })[] = [];
  let at = 0;
  for (const t of tokens) {
    if (t.start < at) continue;
    if (t.start > at) out.push({ text: text.slice(at, t.start) });
    out.push({ token: t, text: text.slice(t.start, t.end) });
    at = t.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
