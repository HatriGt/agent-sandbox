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
  /**
   * Set on code mode's own two tools (`mcp__code-mode__search` / `mcp__code-mode__run`, see
   * docs/plan-code-mode.md): "code-mode" is the in-box wrapper, not a server the operator configured,
   * so callers branch on this instead of presenting it as one.
   */
  codeMode?: "run" | "search";
}

/** The server name the code-mode wrapper is installed under (src/code-mode). */
export const CODE_MODE_SERVER = "code-mode";

/** Parse claude's MCP tool namespacing. Anything else is a local tool → null. */
export function parseMcpName(name: string): McpCall | null {
  const m = name.match(/^mcp__([\w.-]+)__([\w.-]+)$/);
  if (!m) return null;
  const call: McpCall = { server: m[1], tool: m[2], label: m[2].replace(/[_-]+/g, " ").toLowerCase() };
  if (m[1] === CODE_MODE_SERVER && (m[2] === "run" || m[2] === "search")) call.codeMode = m[2];
  return call;
}

/* ───────────────────────────── code mode ───────────────────────────── */

/** One MCP call a code-mode script made, from the summary lines of the `run` result. */
export interface CodeModeCall {
  /** The call's number in the session, the `n` of `recall(n)`. */
  n: number;
  /** Wire name, `mcp__tracker__list_issues`. */
  name: string;
  server: string;
  /** Humanized tool, "list issues". */
  tool: string;
  /** Result size in chars (the summary rounds: "41k" → 41000). 0 when failed/unfinished. */
  chars: number;
  /** Key/array shape of the result, never its values. */
  shape: string;
  /** The call threw; the error text. */
  failed?: string;
  /** No reply before the script ended. */
  unfinished?: boolean;
  /** Over the server's upstream cap: the script saw a cut copy. */
  cut?: boolean;
}

export interface CodeModeResult {
  /** The returned value (JSON text), or the `Error: …` / "returned nothing" line. */
  value: string;
  /** Whether `value` is the script's error rather than a returned value. */
  error: boolean;
  console: string;
  calls: CodeModeCall[];
  /** "--- 5 MCP calls: 50k chars in, 81 out ---" without the dashes. */
  totals?: string;
  /** The trailing `await recall(n) …` hint. */
  recall?: string;
  /**
   * The server's note under the value when the script returned object fields set to undefined
   * (a misspelt field name, usually): `(undefined, so left out of the value above: "comment_count" ×6; …)`.
   * Split off so `value` stays parseable JSON for the table/kv views.
   */
  hint?: string;
}

const SUMMARY_RE = /^--- (\d+) MCP calls?: (.+?) ---$/;
const HINT_RE = /^\(undefined, so left out of the value above: .*\)$/;
const CALL_RE = /^#(\d+) (mcp__[\w.-]+?__[\w.-]+?) (?:(failed): (.*)|(did not finish)|(\d+(?:\.\d+)?[kM]?)( \(over [^)]*: the script saw a cut copy\))?(?: (.*))?)$/;

/** "41k" → 41000, "2.4M" → 2400000, "312" → 312 (src/code-mode/box/result.ts size()). */
function parseSize(s: string): number {
  const n = parseFloat(s);
  return Math.round(s.endsWith("M") ? n * 1_000_000 : s.endsWith("k") ? n * 1000 : n);
}

/**
 * Split the text a code-mode `run` returns (src/code-mode/box/result.ts formatRun) into its parts:
 * value, then `--- console ---`, then `--- N MCP calls: … ---` and one line per call, then the recall
 * hint. Parses from the END so a returned value that itself contains a `---` line stays whole.
 * Text that is not in this shape comes back as the value, with no calls.
 */
export function parseCodeModeResult(text: string | undefined): CodeModeResult {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let recall: string | undefined;
  if (end > 0 && /^await recall\(n\)/.test(lines[end - 1])) recall = lines[--end];
  const calls: CodeModeCall[] = [];
  let totals: string | undefined;
  // Walk back over call lines; they only count if a summary header sits right above them.
  let i = end;
  while (i > 0 && CALL_RE.test(lines[i - 1])) i--;
  const head = i > 0 ? lines[i - 1].match(SUMMARY_RE) : null;
  if (head) {
    totals = `${head[1]} MCP call${head[1] === "1" ? "" : "s"}: ${head[2]}`;
    for (const l of lines.slice(i, end)) {
      const m = l.match(CALL_RE)!;
      const mcp = parseMcpName(m[2]);
      const call: CodeModeCall = {
        n: Number(m[1]),
        name: m[2],
        server: mcp?.server ?? "",
        tool: mcp?.label ?? m[2],
        chars: m[6] ? parseSize(m[6]) : 0,
        shape: m[8] ?? "",
      };
      if (m[3]) call.failed = m[4];
      if (m[5]) call.unfinished = true;
      if (m[7]) call.cut = true;
      calls.push(call);
    }
    end = i - 1;
  } else if (recall !== undefined) {
    // A recall hint with no summary above it is not ours; keep it as part of the value.
    end++;
    recall = undefined;
  }
  let consoleText = "";
  const ci = lines.slice(0, end).lastIndexOf("--- console ---");
  if (ci >= 0) {
    consoleText = lines.slice(ci + 1, end).join("\n");
    end = ci;
  }
  // The undefined-fields note sits on the line right after the value (src/code-mode/box/result.ts).
  let hint: string | undefined;
  while (end > 0 && !lines[end - 1].trim()) end--;
  if (end > 0 && HINT_RE.test(lines[end - 1])) hint = lines[--end];
  const value = lines.slice(0, end).join("\n").trim();
  const out: CodeModeResult = { value, error: /^Error: /.test(value), console: consoleText, calls };
  if (totals) out.totals = totals;
  if (recall) out.recall = recall;
  if (hint) out.hint = hint;
  return out;
}

/** The first non-empty line of a script, for headers and the collapsed row. */
export function scriptHeadline(code: string | undefined, max = 120): string {
  const first = (code ?? "").split("\n").find((l) => l.trim())?.trim() ?? "";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/**
 * A stable accent hue per server so hana-qa always looks like hana-qa across runs and machines —
 * identity by color, no configuration. The component fixes lightness/chroma for the dark ground.
 */
export function serverHue(server: string): number {
  let h = 0;
  for (let i = 0; i < server.length; i++) h = (h * 31 + server.charCodeAt(i)) >>> 0;
  return h % 360;
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


/** Servers a script names in its `call("mcp__server__tool", …)` literals, in first-use order. */
export function scriptServers(code: string | undefined): string[] {
  const out: string[] = [];
  for (const m of (code ?? "").matchAll(/mcp__([\w.-]+?)__[\w.-]+/g)) {
    if (m[1] !== CODE_MODE_SERVER && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * The MCP calls a run of tool events made: a direct call counts one, a code-mode `run` counts the
 * calls its summary lists, a code-mode `search` counts none (it only looks tools up).
 */
export function mcpCallCount(events: { name: string; result?: string }[]): number {
  let n = 0;
  for (const e of events) {
    const m = parseMcpName(e.name);
    if (!m) continue;
    if (m.codeMode === "run") n += parseCodeModeResult(e.result).calls.length;
    else if (!m.codeMode) n++;
  }
  return n;
}
