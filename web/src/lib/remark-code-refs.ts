import type { InlineCode, Link, Nodes, Parents, PhrasingContent, Root, RootContent, Text } from "mdast";
import { findCodeRefs, leadingLineHint, parseCodeRef, refLabel, trailingLineHint } from "./code-refs";

// Text under these is already a link, code, or raw markup: never a prose ref.
const SKIP = new Set(["link", "linkReference", "inlineCode", "code", "html"]);
const isParent = (n: Nodes): n is Parents => "children" in n;

/**
 * Splits mdast `text` nodes around findCodeRefs hits into text + `link` nodes (url = refLabel(ref),
 * `data-prose-ref` on the element) so the markdown `a` override renders them through CodeRefLink. A
 * line phrase whose path is an adjacent inline-code sibling ("lines 3-5 of `x.ts`", "`x.ts` line 7")
 * annotates that `inlineCode` with data-line / data-end-line instead. One manual walk, no plugin deps.
 */
export function remarkCodeRefs(): (tree: Root) => void {
  return (tree) => walk(tree);
}

function walk(node: Parents): void {
  const kids = node.children;
  const out: RootContent[] = [];
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child.type === "text") {
      hintSibling(child.value, kids[i - 1], kids[i + 1]);
      out.push(...split(child));
      continue;
    }
    if (isParent(child) && !SKIP.has(child.type)) walk(child);
    out.push(child);
  }
  node.children = out as typeof node.children;
}

function hintSibling(text: string, prev: RootContent | undefined, next: RootContent | undefined): void {
  const before = trailingLineHint(text);
  if (before && next?.type === "inlineCode") annotate(next, before);
  const after = leadingLineHint(text);
  if (after && prev?.type === "inlineCode") annotate(prev, after);
}

function annotate(code: InlineCode, hint: { line: number; endLine?: number }): void {
  if (!parseCodeRef(code.value)) return;
  const data = (code.data ??= {});
  data.hProperties = { ...data.hProperties, "data-line": String(hint.line), ...(hint.endLine && { "data-end-line": String(hint.endLine) }) };
}

function split(node: Text): PhrasingContent[] {
  const refs = findCodeRefs(node.value);
  if (!refs.length) return [node];
  const out: PhrasingContent[] = [];
  let at = 0;
  for (const { start, end, ref } of refs) {
    if (start > at) out.push({ type: "text", value: node.value.slice(at, start) });
    const link: Link = {
      type: "link",
      url: refLabel(ref),
      children: [{ type: "text", value: node.value.slice(start, end) }],
      data: { hProperties: { "data-prose-ref": "" } },
    };
    out.push(link);
    at = end;
  }
  if (at < node.value.length) out.push({ type: "text", value: node.value.slice(at) });
  return out;
}
