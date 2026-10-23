import { ensureSyntaxTree, language, syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/**
 * Go-to-symbol's model: the declarations in a document, read off CodeMirror's syntax tree. Pure, no
 * React, no view — a `Text` and a tree in, a flat list out. `from`/`to` span the name, `range` the
 * whole declaration (body included) so a preview can band every line and the caret can be placed in
 * its symbol. `depth` nests a method under its class and a local under its function (headings nest
 * by level), and `containerName` names that enclosing declaration, as VS Code's detail column does.
 */
export type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "variable" | "property" | "heading" | "key" | "selector";
export type CodeSymbol = { name: string; kind: SymbolKind; line: number; endLine: number; from: number; to: number; range: Span; depth: number; containerName?: string };

type Span = { from: number; to: number };
type Rule = {
  kind: SymbolKind | ((node: SyntaxNode) => SymbolKind);
  /** Where the symbol's name sits; one declaration can bind several (`const a = 1, b = 2`). */
  names: (node: SyntaxNode, doc: Text) => Span[];
  label?: (text: string) => string;
  /** Headings nest by level, not by tree depth, and contain nothing. */
  depth?: (node: SyntaxNode) => number;
};
type Table = Record<string, Rule>;

const MAX_SYMBOLS = 2000;

const child = (type: string) => (node: SyntaxNode): Span[] => {
  const c = node.getChild(type);
  return c ? [c] : [];
};
const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/s, "$2");
const trimmed = (doc: Text, from: number, to: number): Span => {
  const text = doc.sliceString(from, to);
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  return { from: from + lead, to: to - trail };
};

/** Every binding a declaration introduces, through object and array destructuring. */
function bindings(node: SyntaxNode): Span[] {
  const out: Span[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "VariableDefinition") out.push(c);
    else if (c.name === "ObjectPattern" || c.name === "ArrayPattern" || c.name === "PatternProperty") out.push(...bindings(c));
  }
  // A shorthand `{ a }` binds through its PropertyName; there is no VariableDefinition under it.
  if (node.name === "PatternProperty" && out.length === 0) {
    const key = node.getChild("PropertyName");
    if (key) out.push(key);
  }
  return out;
}

const heading = (level: number, setext: boolean): Rule => ({
  kind: "heading",
  depth: () => level - 1,
  names: (node, doc) => {
    const marks = node.getChildren("HeaderMark");
    const from = setext ? node.from : (marks[0]?.to ?? node.from);
    const to = setext ? (marks[0]?.from ?? node.to) : (marks[1]?.from ?? node.to);
    return [trimmed(doc, from, to)];
  },
});

const javascript: Table = {
  FunctionDeclaration: { kind: "function", names: child("VariableDefinition") },
  ClassDeclaration: { kind: "class", names: child("VariableDefinition") },
  MethodDeclaration: { kind: "method", names: child("PropertyDefinition") },
  PropertyDeclaration: { kind: "property", names: child("PropertyDefinition") },
  InterfaceDeclaration: { kind: "interface", names: child("TypeDefinition") },
  TypeAliasDeclaration: { kind: "type", names: child("TypeDefinition") },
  EnumDeclaration: { kind: "enum", names: child("TypeDefinition") },
  PropertyType: { kind: "property", names: child("PropertyDefinition") },
  MethodType: { kind: "method", names: child("PropertyDefinition") },
  VariableDeclaration: { kind: (n) => (n.getChild("ArrowFunction") || n.getChild("FunctionExpression") ? "function" : "variable"), names: bindings },
};

const insideClass = (node: SyntaxNode): boolean => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.name === "ClassDefinition") return true;
    if (p.name === "FunctionDefinition") return false;
  }
  return false;
};

// @codemirror/lang-javascript names each dialect's language separately.
const TABLES: Record<string, Table> = {
  javascript,
  typescript: javascript,
  jsx: javascript,
  tsx: javascript,
  python: {
    FunctionDefinition: { kind: (n) => (insideClass(n) ? "method" : "function"), names: child("VariableName") },
    ClassDefinition: { kind: "class", names: child("VariableName") },
  },
  markdown: {
    ATXHeading1: heading(1, false),
    ATXHeading2: heading(2, false),
    ATXHeading3: heading(3, false),
    ATXHeading4: heading(4, false),
    ATXHeading5: heading(5, false),
    ATXHeading6: heading(6, false),
    SetextHeading1: heading(1, true),
    SetextHeading2: heading(2, true),
  },
  json: { Property: { kind: "key", names: child("PropertyName"), label: unquote } },
  yaml: { Pair: { kind: "key", names: child("Key"), label: unquote } },
  css: {
    RuleSet: { kind: "selector", names: (n, doc) => [trimmed(doc, n.from, n.getChild("Block")?.from ?? n.to)], label: (s) => s.replace(/\s+/g, " ") },
  },
};

/** Grammars without a table (shell, html) and documents with no declarations both yield []. */
export function symbolsIn(state: EditorState): CodeSymbol[] {
  const table = TABLES[state.facet(language)?.name ?? ""];
  if (!table) return [];
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const doc = state.doc;
  const out: CodeSymbol[] = [];
  // One frame per visited node: the name it opened as a container, or null.
  const opened: (string | null)[] = [];
  const containers: string[] = [];
  tree.iterate({
    enter: (ref) => {
      const rule = table[ref.name];
      let first: string | null = null;
      if (rule && out.length < MAX_SYMBOLS) {
        const node = ref.node;
        const kind = typeof rule.kind === "function" ? rule.kind(node) : rule.kind;
        const depth = rule.depth ? rule.depth(node) : containers.length;
        const range = { from: ref.from, to: ref.to };
        const endLine = doc.lineAt(ref.to).number;
        for (const span of rule.names(node, doc)) {
          const raw = doc.sliceString(span.from, span.to);
          const name = rule.label ? rule.label(raw) : raw;
          if (!name) continue;
          const sym: CodeSymbol = { name, kind, line: doc.lineAt(span.from).number, endLine, from: span.from, to: span.to, range, depth };
          if (containers.length && !rule.depth) sym.containerName = containers[containers.length - 1];
          out.push(sym);
          first ??= name;
        }
      }
      const opens = first !== null && !rule?.depth ? first : null;
      opened.push(opens);
      if (opens !== null) containers.push(opens);
    },
    leave: () => {
      if (opened.pop() !== null) containers.pop();
    },
  });
  return out;
}

/** The innermost symbol whose declaration contains `pos`, as an index into `symbols`, or -1. */
export function symbolAt(symbols: CodeSymbol[], pos: number): number {
  // Document order puts a member after its container, so the last hit is the innermost.
  let hit = -1;
  symbols.forEach((s, i) => {
    if (s.range.from <= pos && pos <= s.range.to) hit = i;
  });
  return hit;
}

/** A symbol that survived the filter, with the name's matched character offsets for highlighting. */
export type SymbolMatch = { symbol: CodeSymbol; positions: number[] };

/**
 * Filter for the "@" query: prefix beats substring beats subsequence, ties keep document order. An
 * empty query is the whole outline in document order with nothing highlighted.
 */
export function matchSymbols(symbols: CodeSymbol[], query: string): SymbolMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return symbols.map((symbol) => ({ symbol, positions: [] }));
  const run = (at: number) => Array.from(needle, (_, k) => at + k);
  const score = (name: string): [number, number[]] | null => {
    const n = name.toLowerCase();
    if (n.startsWith(needle)) return [0, run(0)];
    const at = n.indexOf(needle);
    if (at >= 0) return [1, run(at)];
    const positions: number[] = [];
    for (let i = 0; i < n.length && positions.length < needle.length; i++) if (n[i] === needle[positions.length]) positions.push(i);
    return positions.length === needle.length ? [2, positions] : null;
  };
  return symbols
    .map((symbol, i) => [score(symbol.name), i, symbol] as const)
    .filter((m): m is readonly [[number, number[]], number, CodeSymbol] => m[0] !== null)
    .sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1])
    .map(([[, positions], , symbol]) => ({ symbol, positions }));
}

/** VS Code's "@:" categories: the separator label and the order the groups appear in. */
export const CATEGORY: Record<SymbolKind, { label: string; order: number }> = {
  class: { label: "classes", order: 0 },
  interface: { label: "interfaces", order: 1 },
  function: { label: "functions", order: 2 },
  method: { label: "methods", order: 3 },
  variable: { label: "variables", order: 4 },
  property: { label: "properties", order: 5 },
  enum: { label: "enums", order: 6 },
  type: { label: "types", order: 7 },
  heading: { label: "headings", order: 8 },
  key: { label: "keys", order: 9 },
  selector: { label: "selectors", order: 10 },
};

export type SymbolGroup = { kind: SymbolKind; label: string; items: SymbolMatch[] };

/** The "@:" view: matches bucketed by kind in CATEGORY order, each bucket keeping the matches' order. */
export function groupSymbols(matches: SymbolMatch[]): SymbolGroup[] {
  const buckets = new Map<SymbolKind, SymbolMatch[]>();
  for (const m of matches) {
    const list = buckets.get(m.symbol.kind);
    if (list) list.push(m);
    else buckets.set(m.symbol.kind, [m]);
  }
  return [...buckets]
    .sort(([a], [b]) => CATEGORY[a].order - CATEGORY[b].order)
    .map(([kind, items]) => ({ kind, label: `${CATEGORY[kind].label} (${items.length})`, items }));
}
