/**
 * Make a mid-stream markdown slice safe to render.
 *
 * The reveal animation shows `text.slice(0, n)`, so it regularly cuts through the middle of a
 * markdown construct. Two of those cuts are visibly wrong rather than merely incomplete:
 *
 *  · a HALF-TYPED FENCE. Revealing "```" one character at a time means the slice spends several
 *    frames ending in "`" / "``" / "```bas" — which the lexer reads as a paragraph containing
 *    backticks. The next frames turn it into a code block. The block therefore flips from prose to
 *    a code panel as it arrives, which is the flicker/reflow the reveal exists to avoid.
 *  · an UNCLOSED FENCE. Once the opening fence lands, everything after it is code until a closing
 *    fence arrives. That renders correctly, but the panel has no end, so the layout below it jumps
 *    when the close finally shows up.
 *
 * Both are fixed by rendering the slice as the *stable* document it is on its way to becoming: hide
 * a fence marker that is still being typed, and virtually close a fence that is genuinely open. The
 * revealed text itself is untouched — this only affects what is handed to the markdown renderer.
 */

/** A complete fence line: three-or-more backticks/tildes, optionally followed by an info string. */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
/** A line that could still GROW into a fence: one or two markers, nothing else typed yet. */
const PARTIAL_FENCE_RE = /^\s{0,3}(`{1,2}|~{1,2})$/;

/** Appended to an open fence's language by stabilizeMarkdown; markdown.tsx strips it. */
export const OPEN_FENCE_SUFFIX = "__open";

/** `chart__open` → { language: "chart", open: true }; a bare open fence → plaintext. */
export function splitOpenFence(language: string): { language: string; open: boolean } {
  if (!language.endsWith(OPEN_FENCE_SUFFIX)) return { language, open: false };
  return { language: language.slice(0, -OPEN_FENCE_SUFFIX.length) || "plaintext", open: true };
}

export function stabilizeMarkdown(revealed: string): string {
  const lines = revealed.split("\n");

  // A trailing line that is still growing into a fence marker is not yet meaningful markdown; drop
  // it for this frame. It reappears as a real fence the moment the third backtick arrives, so the
  // block is only ever rendered in one of its two settled forms — never as stray backticks.
  const lastLine = lines[lines.length - 1];
  if (lines.length > 1 && PARTIAL_FENCE_RE.test(lastLine)) lines.pop();

  // Track fence state across the slice. Only a fence of the SAME marker character and at least the
  // same length closes an open one, matching CommonMark — otherwise a "```" inside a "~~~" block
  // would be mistaken for its close.
  let open: { marker: string; len: number; at: number } | null = null;
  lines.forEach((line, at) => {
    const m = line.match(FENCE_RE);
    if (!m) return;
    const marker = m[1][0];
    const len = m[1].length;
    if (!open) {
      // An opening fence may carry an info string; a closing one may not.
      open = { marker, len, at };
    } else if (marker === open.marker && len >= open.len && !m[2].trim()) {
      open = null;
    }
  });

  // Virtually close a fence that is still open, so the code panel has an end and the content after
  // it does not reflow when the real closing fence arrives. The info string is tagged
  // `<lang>__open` so the visualizer router knows the block is still arriving (OPEN_FENCE_SUFFIX):
  // it draws what has landed so far instead of showing code that later swaps into a chart.
  if (open) {
    const o = open as { marker: string; len: number; at: number };
    const m = lines[o.at].match(FENCE_RE)!;
    const lang = m[2].trim().split(/\s+/)[0] ?? "";
    if (/^\w*$/.test(lang)) lines[o.at] = lines[o.at].replace(/(`{3,}|~{3,}).*$/, `$1${lang}${OPEN_FENCE_SUFFIX}`);
    lines.push(o.marker.repeat(o.len));
  } else {
    holdPartialTable(lines);
    holdPartialCodeSpan(lines);
  }

  return lines.join("\n");
}

/**
 * An inline code span being typed — "quota at `:5" — shows its opening backtick as a literal until
 * the closing one lands, then snaps into a code chip. Hold the half-span back: the frame renders up
 * to the backtick, and the chip appears whole when it closes.
 */
function holdPartialCodeSpan(lines: string[]): void {
  const i = lines.length - 1;
  if (i < 0) return;
  const line = lines[i];
  const ticks = (line.match(/`/g) ?? []).length;
  if (ticks % 2 === 0) return;
  lines[i] = line.slice(0, line.lastIndexOf("`")).replace(/\s+$/, "");
}

/** `| a | b | --- |` or `|:--|--:|` — the row that turns a pipe line above it into a table header. */
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * A GFM table is not a table until its delimiter row lands: for the frames between the header row
 * and `| --- |`, the lexer sees a paragraph of pipes ("| Scenario | Before | After |") which then
 * snaps into a table — the same prose-then-panel flicker as a fence. Hold back a trailing pipe row
 * (or two) that has no delimiter yet; it renders as a table on the frame the delimiter completes.
 */
function holdPartialTable(lines: string[]): void {
  let end = lines.length;
  // Ignore a trailing line still being typed if it is empty.
  while (end > 0 && lines[end - 1].trim() === "") end--;
  let start = end;
  while (start > 0 && /^\s*\|/.test(lines[start - 1]) && lines[start - 1].trim() !== "") start--;
  const run = lines.slice(start, end);
  if (!run.length || run.length > 2) return;
  // Only a header row so far (or header + a delimiter still being typed): a table cannot render yet.
  if (run.length === 1 || !TABLE_DELIM_RE.test(run[1])) lines.splice(start, lines.length - start);
}
