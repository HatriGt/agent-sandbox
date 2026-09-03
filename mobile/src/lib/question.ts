/**
 * Parse the agent's question file into a card: a one-line question, optional context, and options.
 *
 * The agent is instructed (msb.ts AGENT_SYS_PROMPT) to write:
 *
 *     <question in one sentence>
 *
 *     <optional context>
 *
 *     Options:
 *     - first option
 *     - second option
 *
 * Older sessions and models that drift write `(A) …`, `1) …`, `A.` or inline `[x] [y]` instead, so
 * the parser accepts those too. Anything unparseable is a free-text question with no options.
 * Pure — the server test suite covers it.
 */
export interface ParsedQuestion {
  title: string;
  context: string;
  options: string[];
}

const OPTION_LINE = /^\s*(?:[-*•]\s+|\(?[A-Za-z]\)\s+|[A-Za-z][.)]\s+|\d+[.)]\s+|\(\d+\)\s+)(.+?)\s*$/;
const OPTIONS_HEADER = /^\s*options?\s*:?\s*$/i;
/** "…please re-run with the credential. Options:" — a header glued to the end of a prose line. */
const OPTIONS_TAIL = /^(.*\S)\s+options?\s*:\s*$/i;
const CLOSING_LINE = /^\s*(which (one|option)? ?would you (like|prefer)\??|what would you like( to do)?\??|please (choose|pick|select)[^\n]*|let me know[^\n]*)\s*$/i;
const INLINE_BRACKET = /\[([^\]\n]{1,60})\]/g;

export function parseQuestion(raw: string): ParsedQuestion {
  const text = (raw ?? "").replace(/\r/g, "").trim();
  if (!text) return { title: "", context: "", options: [] };
  const lines = text.split("\n");

  // 1. Explicit "Options:" block wins — on its own line, or glued to the end of a prose line.
  let hdr = lines.findIndex((l) => OPTIONS_HEADER.test(l));
  let head = hdr >= 0 ? lines.slice(0, hdr) : null;
  if (hdr < 0) {
    hdr = lines.findIndex((l) => OPTIONS_TAIL.test(l));
    if (hdr >= 0) head = [...lines.slice(0, hdr), lines[hdr].match(OPTIONS_TAIL)![1]];
  }
  if (hdr >= 0 && head) {
    const options = lines
      .slice(hdr + 1)
      .filter((l) => !CLOSING_LINE.test(l))
      .map((l) => l.match(OPTION_LINE)?.[1] ?? (l.trim() ? l.trim() : null))
      .filter((s): s is string => !!s)
      .slice(0, 6);
    return { ...split(head), options: dedupe(options) };
  }

  // 2. A trailing run of enumerated lines ((A) … / 1) … / - …) at least two long, allowing one
  //    closing line ("Which would you like?") after them.
  let end = lines.length;
  while (end > 0 && (!lines[end - 1].trim() || CLOSING_LINE.test(lines[end - 1]))) end--;
  let start = end;
  while (start > 0 && OPTION_LINE.test(lines[start - 1]) && !isProseBullet(lines[start - 1])) start--;
  if (end - start >= 2) {
    const options = lines
      .slice(start, end)
      .map((l) => l.match(OPTION_LINE)![1].trim())
      .slice(0, 6);
    // "Which would you like?" after the list is a closing line, not context.
    return { ...split(lines.slice(0, start)), options: dedupe(options) };
  }

  // 3. Inline bracketed choices: "Should I [mock the clock] or [widen the tolerance]?"
  const bracketed = [...text.matchAll(INLINE_BRACKET)].map((m) => m[1].trim());
  if (bracketed.length >= 2) {
    return { ...split(lines), options: dedupe(bracketed).slice(0, 6) };
  }

  return { ...split(lines), options: [] };
}

/** First non-empty line is the title; the rest (minus a trailing "Which would you like?") is context. */
function split(lines: string[]): { title: string; context: string } {
  const nonEmpty = lines.map((l) => l.trimEnd());
  const i = nonEmpty.findIndex((l) => l.trim());
  if (i < 0) return { title: "", context: "" };
  const title = nonEmpty[i].trim().replace(/^question\s*:\s*/i, "");
  let rest = nonEmpty.slice(i + 1).join("\n").trim();
  rest = rest.replace(/\n?\s*(which (one|option)? ?would you (like|prefer)\??|what would you like( to do)?\??|please (choose|pick|select)[^\n]*)\s*$/i, "").trim();
  return { title, context: rest };
}

/** A long sentence starting with a dash is prose, not an option (options are short). */
function isProseBullet(line: string): boolean {
  const m = line.match(OPTION_LINE);
  return !!m && m[1].length > 90;
}

function dedupe(xs: string[]): string[] {
  return [
    ...new Set(
      xs
        .map((x) => x.replace(/[,;]?\s*\b(or|and)\s*$/i, "").replace(/[.;,]\s*$/, "").trim())
        .filter(Boolean)
    ),
  ];
}

/** The one-line headline for lists and notifications. */
export function questionHeadline(raw: string | undefined, max = 140): string {
  const t = parseQuestion(raw ?? "").title || (raw ?? "").trim().split("\n")[0] || "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
