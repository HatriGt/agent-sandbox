/**
 * Restore blank-line boundaries that streamed agent output drops.
 *
 * GFM detects a table or heading only when a blank line separates it from surrounding prose. Claude
 * often streams "…the disk usage:\n| a | b |\n…\n## Summary\nDone." with single newlines, so `marked`
 * swallows the table into a paragraph (`| overlay | 3.9G | … | ## Summary` as one blob) — the exact
 * bug the user hit. Rather than `remark-breaks` (which turns every newline into a hard break and
 * destroys these boundaries), we insert the missing blank lines around headings, tables, and fenced
 * code so the renderer sees valid block structure. Fenced regions pass through untouched so code
 * content is never rewritten.
 *
 * Pure and dependency-free so the server's `node:test` suite can cover it directly.
 */

const HEADING_RE = /^\s{0,3}#{1,6}\s/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const FENCE_RE = /^\s*(?:```|~~~)/;

export function normalizeBlocks(markdown: string): string {
  const lines = String(markdown ?? "").split("\n");
  const out: string[] = [];
  let inFence = false;
  const blank = (l: string | undefined) => l === undefined || l.trim() === "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      // A fence needs a blank line before it to open a code block after prose.
      if (!inFence && out.length > 0 && !blank(out[out.length - 1])) out.push("");
      out.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const prev = out[out.length - 1];
    const next = lines[i + 1];
    const isHeading = HEADING_RE.test(line);
    const isTableRow = TABLE_ROW_RE.test(line);

    if (isHeading && out.length > 0 && !blank(prev)) out.push("");
    if (isTableRow && out.length > 0 && !blank(prev) && !TABLE_ROW_RE.test(prev)) out.push("");

    out.push(line);

    if (isHeading && !blank(next)) out.push("");
    if (isTableRow && !blank(next) && !TABLE_ROW_RE.test(next)) out.push("");
  }
  return out.join("\n");
}
