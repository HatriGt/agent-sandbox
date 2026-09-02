/**
 * MCP calls in the thread. The wire name `mcp__hana-qa__execute_sql` is claude's namespacing, not a
 * label a human should read; and MCP results are almost always JSON — rows from a database, issues
 * from a tracker — which a plain <pre> turns into a one-line blob. This module is the pure half of
 * the MCP card: name parsing, a stable per-server accent, and result analysis (table / key-value /
 * pretty JSON) so the UI can render *data*, not string dumps.
 */

export interface McpCall {
  server: string;
  /** Wire tool segment, e.g. "execute_sql". */
  tool: string;
  /** Humanized: "execute sql". */
  label: string;
}

/** Parse claude's MCP tool namespacing. Anything else is a local tool → null. */
export function parseMcpName(name: string): McpCall | null {
  const m = name.match(/^mcp__([\w.-]+)__([\w.-]+)$/);
  if (!m) return null;
  return { server: m[1], tool: m[2], label: m[2].replace(/[_-]+/g, " ").toLowerCase() };
}

/* ───────────────────────────── result analysis ───────────────────────────── */

export type McpResultView =
  | { kind: "table"; columns: string[]; rows: string[][]; total: number }
  | { kind: "kv"; entries: [string, string][] }
  | { kind: "json"; pretty: string }
  | { kind: "text"; text: string }
  | { kind: "empty" };

const MAX_COLS = 6;
export const TABLE_PREVIEW_ROWS = 8;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** A flat-ish array of objects → table columns ordered by first appearance, capped at MAX_COLS. */
function toTable(arr: Record<string, unknown>[]): Extract<McpResultView, { kind: "table" }> {
  const columns: string[] = [];
  for (const row of arr) {
    for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k);
    if (columns.length >= MAX_COLS) break;
  }
  const cols = columns.slice(0, MAX_COLS);
  return { kind: "table", columns: cols, rows: arr.map((r) => cols.map((c) => cell(r[c]))), total: arr.length };
}

/**
 * Classify a raw result string. MCP servers often wrap payloads as
 * `{"content":[{"type":"text","text":"…json…"}]}` — unwrap one level of that before judging shape.
 */
export function analyzeResult(raw: string | undefined): McpResultView {
  const text = (raw ?? "").trim();
  if (!text) return { kind: "empty" };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { kind: "text", text };
  }
  // Unwrap the MCP content envelope when the inner text is itself JSON.
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const content = (v as Record<string, unknown>).content;
    if (Array.isArray(content) && content.length === 1) {
      const inner = content[0] as Record<string, unknown>;
      if (inner?.type === "text" && typeof inner.text === "string") {
        try {
          v = JSON.parse(inner.text);
        } catch {
          return { kind: "text", text: inner.text as string };
        }
      }
    }
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return { kind: "empty" };
    if (v.every((r) => r && typeof r === "object" && !Array.isArray(r))) return toTable(v as Record<string, unknown>[]);
    return { kind: "json", pretty: JSON.stringify(v, null, 2) };
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > 0 && entries.length <= 12 && entries.every(([, val]) => val === null || typeof val !== "object")) {
      return { kind: "kv", entries: entries.map(([k, val]) => [k, cell(val)]) };
    }
    return { kind: "json", pretty: JSON.stringify(v, null, 2) };
  }
  return { kind: "text", text: cell(v) };
}

/** Collapsed one-liner derived from the SHAPE of the result, not its first line. */
export function mcpSummary(view: McpResultView): string {
  switch (view.kind) {
    case "table":
      return `${view.total} ${view.total === 1 ? "row" : "rows"}`;
    case "kv":
      return `${view.entries.length} ${view.entries.length === 1 ? "field" : "fields"}`;
    case "json": {
      const lines = view.pretty.split("\n").length;
      return `JSON · ${lines} lines`;
    }
    case "text": {
      const first = view.text.split("\n").find((l) => l.trim())?.trim() ?? "";
      return first.length > 80 ? `${first.slice(0, 79)}…` : first;
    }
    case "empty":
      return "no data";
  }
}

