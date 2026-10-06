/**
 * Our parsed `Sequence` (lib/viz-extra.ts) → mermaid `sequenceDiagram` text, so the ```sequence
 * fence is drawn by mermaid. Pure; covered by test/viz-mermaid.test.ts.
 */
import type { Sequence, SequenceItem } from "./viz-extra";

/** Characters that end a mermaid statement or start a comment/entity are dropped; length is capped. */
export function mermaidLabel(text: string, max = 80): string {
  const clean = text.replace(/[;#:\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

const KEYWORD = /^(loop|alt|else|opt|par|and|critical|break|rect)$/i;

/**
 * Participants are declared with stable ids (`p0`, `p1`, …) and an alias, so actor names with
 * spaces, dashes or `->` never confuse mermaid's arrow grammar. Block items (pushed by the parser
 * after their contents, ranges over item indices) open before their first item and close after
 * their last. The parser keeps only the label, so a bare `opt`/`alt`/`else` keeps its keyword and
 * any labelled section is drawn as a `loop` frame carrying the label.
 */
export function sequenceToMermaid(seq: Sequence): string {
  const out = ["sequenceDiagram"];
  seq.actors.forEach((a, i) => out.push(`  participant p${i} as ${mermaidLabel(a, 40) || `actor ${i + 1}`}`));
  const blocks = seq.items.filter((it): it is Extract<SequenceItem, { kind: "block" }> => it.kind === "block");
  const open: number[] = [];
  const pad = () => "  ".repeat(open.length + 1);
  seq.items.forEach((it, k) => {
    // Outermost (longest) first so nesting closes in the right order.
    for (const b of blocks.filter((b) => b.start === k).sort((x, y) => y.end - x.end)) {
      const word = b.label.trim().toLowerCase();
      const head = word === "opt" ? "opt" : word === "alt" || word === "else" ? "alt" : "loop";
      out.push(`${pad()}${head} ${KEYWORD.test(word) ? "" : mermaidLabel(b.label)}`.trimEnd());
      open.push(b.end);
    }
    if (it.kind === "msg") out.push(`${pad()}p${it.from}${it.reply ? "-->>" : "->>"}p${it.to}: ${mermaidLabel(it.text) || "…"}`);
    else if (it.kind === "note") out.push(`${pad()}Note over p${it.actor}: ${mermaidLabel(it.text) || "…"}`);
    while (open.length && open[open.length - 1] <= k) {
      open.pop();
      out.push(`${pad()}end`);
    }
  });
  return out.join("\n");
}
