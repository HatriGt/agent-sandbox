import { ensureSyntaxTree, language, syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/**
 * Go-to-symbol's model: the declarations in a document, read off CodeMirror's syntax tree. Pure, no
 * React, no view — a `Text` and a tree in, a flat list out. `depth` nests a method under its class
 * and a local under its function (headings nest by level), so the list can indent like an outline.
 */
export type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "variable" | "property" | "heading" | "key" | "selector";
export type CodeSymbol = { name: string; kind: SymbolKind; line: number; from: number; to: number; depth: number };

type Span = { from: number; to: number };
type Rule = {
  kind: SymbolKind | ((node: SyntaxNode) => SymbolKind);
  /** Where the symbol's name sits; one declaration can bind several (`const a = 1, b = 2`). */
  names: (node: SyntaxNode, doc: Text) => Span[];
  label?: (text: string) => string;
  /** Headings nest by level, not by tree depth. */
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
  const opened: boolean[] = [];
  let depth = 0;
  tree.iterate({
    enter: (ref) => {
      const rule = table[ref.name];
      let emitted = false;
      if (rule && out.length < MAX_SYMBOLS) {
        const node = ref.node;
        const kind = typeof rule.kind === "function" ? rule.kind(node) : rule.kind;
        const d = rule.depth ? rule.depth(node) : depth;
        for (const span of rule.names(node, doc)) {
          const raw = doc.sliceString(span.from, span.to);
          const name = rule.label ? rule.label(raw) : raw;
          if (!name) continue;
          out.push({ name, kind, line: doc.lineAt(span.from).number, from: span.from, to: span.to, depth: d });
          emitted = true;
        }
      }
      opened.push(emitted && !rule?.depth);
      if (emitted && !rule?.depth) depth++;
    },
    leave: () => {
      if (opened.pop()) depth--;
    },
  });
  return out;
}

/**
 * Filter for the "@" query: prefix beats substring beats subsequence, ties keep document order. An
 * empty query is the whole outline in document order.
 */
export function matchSymbols(symbols: CodeSymbol[], query: string): CodeSymbol[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return symbols;
  const score = (name: string): number => {
    const n = name.toLowerCase();
    if (n.startsWith(needle)) return 0;
    if (n.includes(needle)) return 1;
    let i = 0;
    for (const ch of n) if (ch === needle[i] && ++i === needle.length) return 2;
    return 9;
  };
  return symbols
    .map((s, i) => [score(s.name), i, s] as const)
    .filter(([sc]) => sc < 9)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([, , s]) => s);
}
