import { parseProgress, type ProgressRow } from "./viz-extra";

/**
 * Phase 4 — render automatically, no special syntax. Pure gates shared by the trace (tool output)
 * and the prose renderer (lists, small tables). Unit-tested in test/viz-tool-output.test.ts.
 */

export const TOOL_OUTPUT_MAX_LINES = 200;
export const TOOL_OUTPUT_MAX_BYTES = 20_000;

/**
 * Which visualizer language a finished tool's printed output should go through: "json" for a
 * whole-output JSON document, "" (bare, sniffed by lib/viz-auto.ts) for everything else, or null
 * when it must stay raw — empty, still live, or too big to be worth drawing.
 */
export function toolOutputLanguage(text: string | undefined | null, { live = false }: { live?: boolean } = {}): "json" | "" | null {
  if (live || !text) return null;
  const t = text.replace(/\s+$/, "");
  if (!t.trim() || t.length > TOOL_OUTPUT_MAX_BYTES) return null;
  if (t.split("\n").length > TOOL_OUTPUT_MAX_LINES) return null;
  const s = t.trim();
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      const v: unknown = JSON.parse(s);
      if (v && typeof v === "object") return "json";
    } catch {
      /* not JSON — let the sniffer try */
    }
  }
  return "";
}

/** A list whose every item (≥2) is `label: NN%` or `label: a/b` → progress rows; else null. */
export function progressFromItems(items: string[] | null): ProgressRow[] | null {
  if (!items || items.length < 2) return null;
  const lines = items.map((t) => t.replace(/\*\*|__|`/g, "").trim());
  if (lines.some((l) => !l || l.includes("\n"))) return null;
  return parseProgress(lines.join("\n"));
}

const NUMERIC = /^[-+]?[$€£]?\s?\d[\d,_]*(?:\.\d+)?\s?(?:%|[kKmMbB]|ms|s|x|×)?$/;

/**
 * Whether a GFM table's body (cell texts) earns the rich DataTable: three or more rows always; two
 * rows only when some column is numeric throughout (there is something to sort); fewer stays prose.
 */
export function tableWorthRich(body: string[][]): boolean {
  if (body.length >= 3) return true;
  if (body.length < 2) return false;
  const cols = Math.max(...body.map((r) => r.length));
  for (let c = 0; c < cols; c++) if (body.every((r) => NUMERIC.test((r[c] ?? "").trim()))) return true;
  return false;
}
