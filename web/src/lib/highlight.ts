/**
 * Tiny, dependency-free tokenizers for the two output shapes the thread shows on the dark trace
 * ground: JSON (MCP results) and terminal text (shell output). Pure functions returning token
 * streams so the coloring is unit-testable; the components map token kinds to theme classes.
 * Not a general highlighter — just enough color to make structure scannable.
 */

export type JsonToken = { kind: "key" | "string" | "number" | "bool" | "null" | "punct" | "ws"; text: string };

const JSON_RE =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],:])|(\s+)|(.)/g;

/** Tokenize pretty-printed JSON. Keys are strings followed by a colon. */
export function tokenizeJson(text: string): JsonToken[] {
  const out: JsonToken[] = [];
  for (const m of text.matchAll(JSON_RE)) {
    if (m[1] !== undefined) {
      out.push({ kind: m[2] ? "key" : "string", text: m[1] });
      if (m[2]) out.push({ kind: "punct", text: m[2] });
    } else if (m[3] !== undefined) out.push({ kind: "number", text: m[3] });
    else if (m[4] !== undefined) out.push({ kind: "bool", text: m[4] });
    else if (m[5] !== undefined) out.push({ kind: "null", text: m[5] });
    else if (m[6] !== undefined) out.push({ kind: "punct", text: m[6] });
    else if (m[7] !== undefined) out.push({ kind: "ws", text: m[7] });
    else out.push({ kind: "punct", text: m[8] });
  }
  return out;
}

export type TermLineKind = "error" | "warn" | "ok" | "add" | "del" | "path" | "plain";

/** Error/warning line counts for a collapsed panel's label — the fold says what it hides. */
export function outputStats(text: string): { errors: number; warns: number } {
  let errors = 0;
  let warns = 0;
  for (const l of text.split("\n")) {
    const k = termLineKind(l);
    if (k === "error") errors++;
    else if (k === "warn") warns++;
  }
  return { errors, warns };
}

/**
 * Classify one terminal output line by its most probable meaning. Diff markers win over word
 * matches (a `- warning fixed` line is a deletion, not a warning).
 */
export function termLineKind(line: string): TermLineKind {
  if (/^\+(?!\+\+)/.test(line)) return "add";
  if (/^-(?!--)/.test(line)) return "del";
  if (/\b(error|fatal|exception|failed|failure|traceback|ENOENT|EACCES|panic)\b/i.test(line)) return "error";
  if (/\b(warn|warning|deprecated)\b/i.test(line)) return "warn";
  if (/\b(pass|passed|success|succeeded|✓|ok\b)/i.test(line) && !/\bnot ok\b/i.test(line)) return "ok";
  if (/^(\s*at\s+|\s*File ")|^[\w./~-]+\.(ts|tsx|js|jsx|py|go|rs|java|json|yml|yaml|css|md):\d+/.test(line)) return "path";
  return "plain";
}
