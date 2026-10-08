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
 * same rule covers the smaller constructs on the growing edge — a half-typed table, code span, link,
 * emphasis run, or a block marker with nothing after it yet (see the hold* helpers below). The
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
    holdEmptyMarker(lines);
    holdPartialInline(lines);
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
  // A closing fence ("```") is not a half-typed code span: stripping it would reopen the block.
  if (FENCE_RE.test(line)) return;
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
 * A lone trailing "|" — the left edge of a row not typed yet — is held too: rendered, it is a stray
 * bar (or an empty row) under the table.
 */
function holdPartialTable(lines: string[]): void {
  let end = lines.length;
  // Ignore a trailing line still being typed if it is empty.
  while (end > 0 && lines[end - 1].trim() === "") end--;
  if (end > 0 && lines[end - 1].trim() === "|") {
    lines.splice(end - 1);
    end = lines.length;
  }
  let start = end;
  while (start > 0 && /^\s*\|/.test(lines[start - 1]) && lines[start - 1].trim() !== "") start--;
  const run = lines.slice(start, end);
  if (!run.length || run.length > 2) return;
  // Only a header row so far (or header + a delimiter still being typed): a table cannot render yet.
  if (run.length === 1 || !TABLE_DELIM_RE.test(run[1])) lines.splice(start, lines.length - start);
}

/**
 * A block marker with nothing typed after it yet — "#", "## ", "- ", "1. ", "> ", "- [ ]" — is a
 * frame away from being a heading, a list item or a quote. Rendered as-is it shows a stray glyph
 * (or, for a lone "-", turns the paragraph above into a setext heading for one frame). Hold the line.
 */
const EMPTY_MARKER_RE = /^\s{0,3}(?:#{1,6}|[-*+]|\d{1,9}[.)]|>|(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]?\]?)\s*$/;

function holdEmptyMarker(lines: string[]): void {
  const i = lines.length - 1;
  if (i >= 0 && EMPTY_MARKER_RE.test(lines[i])) lines.pop();
}

/**
 * Inline syntax on the growing edge of the slice: the last line is settled with `closeInline`.
 * Fence lines and table rows are left alone (their pipes and backticks are structure, not markup).
 */
function holdPartialInline(lines: string[]): void {
  const i = lines.length - 1;
  if (i < 0) return;
  const line = lines[i];
  if (!line || FENCE_RE.test(line) || /^\s*\|/.test(line)) return;
  const next = closeInline(line);
  if (next !== line) lines[i] = next;
}

/** Blank out closed code spans (same length, so indices line up with the source line). */
function maskCodeSpans(line: string): string {
  return line.replace(/(`+)[^`]*?\1/g, (m) => " ".repeat(m.length));
}

const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/;

/**
 * One line → the same line with its open inline syntax settled. Decisions are made on a MASK of the
 * line in which code spans are blanked, so a `*` or `[` inside backticks is never read as markup.
 *
 *  · an unclosed link — "see [the docs", "[the docs](https://ex", "[the docs]" — renders its text
 *    plainly; the link appears whole when the URL closes. A half-typed image is held entirely.
 *  · an unclosed emphasis run — "**bold te", "*em", "_em", "~~gone" — is virtually closed, so the
 *    text is styled from its first frame and never flips from plain to bold when the close lands.
 *  · a delimiter run with nothing after it yet ("text **", "**") is held: it would render literally.
 *
 * Exported for the test file only.
 */
export function closeInline(line: string): string {
  let out = line;
  let mask = maskCodeSpans(out);

  // --- links ---------------------------------------------------------------------------------
  // `[text` (no `]` yet) · `[text](ur` (no `)` yet) · `[text]` at the very end (the `(` is next).
  // A task-list box ("- [ ]", "- [x]") is a list marker, not a link.
  const link = /(!?)\[([^[\]]*)(?:\]\(([^()]*)|\])?$/.exec(mask);
  if (link) {
    const at = link.index;
    const image = link[1] === "!";
    const closedText = link[0].endsWith("]") && link[3] === undefined;
    const text = link[2];
    const taskBox = closedText && /^[ xX]$/.test(text) && /^\s*(?:[-*+]|\d{1,9}[.)])\s+$/.test(mask.slice(0, at));
    if (!taskBox) {
      const plain = image ? "" : out.slice(at + 1, at + 1 + text.length);
      out = (out.slice(0, at) + plain).replace(/\s+$/, "");
      mask = maskCodeSpans(out);
    }
  }

  // --- emphasis ------------------------------------------------------------------------------
  // Walk delimiter runs left to right with a stack of openers (CommonMark flanking rules, simplified:
  // `_` never opens or closes inside a word, `*` may). Whatever is still open at the end is closed.
  const open: { run: string; at: number }[] = [];
  const re = /\*{1,3}|_{1,3}|~~/g;
  let m: RegExpExecArray | null;
  let dangling: number | null = null; // a run at the very end that neither opened nor closed
  while ((m = re.exec(mask))) {
    const run = m[0];
    const end = m.index + run.length;
    const before = m.index === 0 ? " " : mask[m.index - 1];
    const after = end >= mask.length ? " " : mask[end];
    const leftFlank = !SPACE.test(after) && (!PUNCT.test(after) || SPACE.test(before) || PUNCT.test(before));
    const rightFlank = !SPACE.test(before) && (!PUNCT.test(before) || SPACE.test(after) || PUNCT.test(after));
    const intraword = /\w/.test(before) && /\w/.test(after);
    const underscore = run[0] === "_";
    const canClose = rightFlank && !(underscore && intraword);
    const canOpen = leftFlank && !(underscore && intraword);
    const k = canClose ? open.map((o) => o.run).lastIndexOf(run) : -1;
    if (k >= 0) open.splice(k);
    else if (canOpen) open.push({ run, at: m.index });
    else if (end === mask.length) dangling = m.index;
  }
  if (dangling !== null) out = out.slice(0, dangling).replace(/\s+$/, "");
  if (open.length) {
    // Openers with nothing after them yet ("**", "text **_") are held; the rest are closed, innermost
    // first, after trailing whitespace (a closer after a space is not right-flanking).
    out = out.replace(/\s+$/, "");
    while (open.length && out.endsWith(open[open.length - 1].run) && open[open.length - 1].at + open[open.length - 1].run.length >= out.length) {
      out = out.slice(0, open[open.length - 1].at).replace(/\s+$/, "");
      open.pop();
    }
    for (let j = open.length - 1; j >= 0; j--) out += open[j].run;
  }
  return out;
}
