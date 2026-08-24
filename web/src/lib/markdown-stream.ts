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
  let open: { marker: string; len: number } | null = null;
  for (const line of lines) {
    const m = line.match(FENCE_RE);
    if (!m) continue;
    const marker = m[1][0];
    const len = m[1].length;
    if (!open) {
      // An opening fence may carry an info string; a closing one may not.
      open = { marker, len };
    } else if (marker === open.marker && len >= open.len && !m[2].trim()) {
      open = null;
    }
  }

  // Virtually close a fence that is still open, so the code panel has an end and the content after
  // it does not reflow when the real closing fence arrives.
  if (open) lines.push(open.marker.repeat(open.len));

  return lines.join("\n");
}
