/**
 * Pure block-vs-inline classification for a markdown `code` node — extracted so the rule can be unit
 * tested without dragging React/JSX into the test runner.
 *
 * The prior heuristic (start.line === end.line → inline) misclassified fenced blocks: a one-line
 * fence read as inline, and any multi-line fence that reached the inline `<span>` path lost its
 * monospace + `white-space: pre`, collapsing code / JSON / ASCII art into a proportional-font blob.
 *
 * A node is a BLOCK when it carries a `language-*` class (remark always sets this on a ``` fence)
 * OR its text contains a newline (a fence with no language, e.g. plain ASCII art). Everything else —
 * genuine single-line `inline code` — stays inline.
 */
export function isCodeBlock(className: string | undefined, text: string): boolean {
  return /language-/.test(className ?? "") || text.includes("\n");
}
