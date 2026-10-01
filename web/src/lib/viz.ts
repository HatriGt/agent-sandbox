/**
 * Pure parsers behind the output visualizers (docs/output-visualizers.md).
 *
 * Every function returns `null` for input it does not confidently understand — the markdown layer
 * treats null as "render the plain code block instead". A malformed fence must NEVER throw past
 * these functions: a visualizer that crashes the transcript is worse than no visualizer.
 */
import * as React from "react";

/** Flatten a react-markdown node tree to its visible text (for sorting/CSV of table cells). */
export function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

/**
 * Numeric reading of a cell for sort order and magnitude bars. Accepts the shapes agents actually
 * emit: `1,234`, `12.5%`, `3.4 MB`, `$1.2k`, `-7ms`, `~90`. Returns null for prose.
 */
export function cellNumber(text: string): number | null {
  const t = text.trim().replace(/^[~≈<>]=?\s*/, "");
  const m = t.match(/^[$€£]?(-?\d[\d,]*(?:\.\d+)?)\s*(%|[kKmMgG]?[bB]?|ms|s|min|h|x|×)?$/);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k" || unit === "kb") n *= 1e3;
  else if (unit === "m" || unit === "mb") n *= 1e6;
  else if (unit === "g" || unit === "gb") n *= 1e9;
  return n;
}

// ---------------------------------------------------------------- chart fence

export interface ChartSeries {
  name: string;
  data: number[];
}
export interface ChartSpec {
  type: "bar" | "line" | "area" | "donut" | "sparkline" | "scatter";
  title?: string;
  labels: string[];
  series: ChartSeries[];
  /** Optional unit suffix rendered after values (e.g. "ms", "%"). */
  unit?: string;
  /** Bars only: stack series instead of grouping them. */
  stacked?: boolean;
}

const CHART_TYPES: Record<string, ChartSpec["type"]> = {
  bar: "bar", bars: "bar", column: "bar", columns: "bar", histogram: "bar",
  line: "line", lines: "line", area: "area",
  donut: "donut", doughnut: "donut", pie: "donut",
  sparkline: "sparkline", spark: "sparkline", scatter: "scatter",
};

/** A data value as agents write it: 12, "12", "1,234", "12%", "3.4 MB". */
function chartNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return cellNumber(v) ?? NaN;
  return NaN;
}

const firstArray = (o: Record<string, unknown>, keys: string[]): unknown[] | undefined => {
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[];
  return undefined;
};

/**
 * ```chart fence: JSON, either the full {type, labels, series:[{name,data}]} shape or the
 * shorthand {type, labels, values} for a single series. Bounded (≤ 60 categories, ≤ 8 series —
 * the palette's fixed order ends at 8; more must be folded upstream, never cycled).
 *
 * Agents drift from the spec, so the common spellings are accepted too: `x`/`categories` for
 * labels, `y`/`data` for values, `kind` for type, `pie` for donut, a {name: data} series map,
 * point lists ([{label, value}]), and numeric strings. Mismatched lengths are still rejected —
 * padding would invent data.
 */
export function parseChartSpec(src: string): ChartSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const typeRaw = o.type ?? o.kind ?? o.chart;
  const type = CHART_TYPES[String(typeRaw ?? "bar").toLowerCase().trim()];
  if (!type) return null;
  const title = typeof o.title === "string" ? o.title : undefined;
  let labels = firstArray(o, ["labels", "x", "categories", "xLabels", "xAxis", "keys"])?.map(String) ?? null;
  let series: ChartSeries[] = [];
  const toData = (arr: unknown[]): number[] | null => {
    const d = arr.map(chartNumber);
    return d.some((n) => !Number.isFinite(n)) ? null : d;
  };
  const flat = firstArray(o, ["values", "y", "data"]);
  if (flat && flat.length > 0 && flat.every((p) => typeof p === "object" && p !== null && !Array.isArray(p))) {
    // Point list: [{label, value}] / [{x, y}] / [{name, value}].
    const pts = flat as Record<string, unknown>[];
    const lab = pts.map((p) => p.label ?? p.name ?? p.x ?? p.key);
    const val = pts.map((p) => p.value ?? p.y ?? p.count);
    if (lab.some((l) => l == null) || val.some((v) => v == null)) return null;
    const data = toData(val);
    if (!data) return null;
    labels = lab.map(String);
    series = [{ name: title ?? "value", data }];
  } else if (flat) {
    const data = toData(flat);
    if (!data) return null;
    series = [{ name: title ?? "value", data }];
  } else if (Array.isArray(o.series)) {
    for (const s of o.series) {
      if (typeof s !== "object" || s === null) return null;
      const so = s as Record<string, unknown>;
      const arr = firstArray(so, ["data", "values", "y"]);
      if (!arr) return null;
      const data = toData(arr);
      if (!data) return null;
      series.push({ name: String(so.name ?? so.label ?? `series ${series.length + 1}`), data });
    }
  } else if (typeof o.series === "object" && o.series !== null) {
    for (const [name, arr] of Object.entries(o.series as Record<string, unknown>)) {
      if (!Array.isArray(arr)) return null;
      const data = toData(arr);
      if (!data) return null;
      series.push({ name, data });
    }
  } else return null;
  if (!labels || labels.length === 0 || labels.length > 60) return null;
  if (series.length === 0 || series.length > 8) return null;
  if (series.some((s) => s.data.length !== labels!.length)) return null;
  if ((type === "donut" || type === "sparkline") && series.length > 1) return null;
  if (type === "donut" && series[0].data.some((n) => n < 0)) return null;
  // Scatter puts every series pair side by side (all-pairs), where the palette validates only its
  // first three slots — cap it there rather than ship indistinguishable dots.
  if (type === "scatter" && series.length > 3) return null;
  const stacked = o.stacked === true && type === "bar";
  if (stacked && series.some((s) => s.data.some((n) => n < 0))) return null;
  return {
    type,
    title,
    labels,
    series,
    unit: typeof o.unit === "string" ? o.unit : undefined,
    stacked: stacked || undefined,
  };
}

// ---------------------------------------------------------------- stats fence

export interface Stat {
  label: string;
  value: string;
  /** Signed delta text, e.g. "+12%" / "-40ms"; sign decides the up/down glyph. */
  delta?: string;
  /** Whether the delta is good news. Default: up = good. `!` suffix flips it (e.g. latency). */
  deltaGood?: boolean;
  note?: string;
}

/**
 * ```stats fence: one stat per line — `Label: value`, optionally `| +12%` delta and `| note`.
 * A trailing `!` on the delta marks "down is good" metrics: `p95: 210ms | -40ms!`.
 */
export function parseStats(src: string): Stat[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 8) return null;
  const out: Stat[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) return null;
    const label = line.slice(0, idx).trim();
    const parts = line.slice(idx + 1).split("|").map((p) => p.trim());
    const value = parts[0];
    if (!label || !value) return null;
    const stat: Stat = { label, value };
    for (const extra of parts.slice(1)) {
      if (/^[+\-−]/.test(extra)) {
        const flip = extra.endsWith("!");
        const delta = flip ? extra.slice(0, -1).trim() : extra;
        stat.delta = delta;
        const up = delta.startsWith("+");
        stat.deltaGood = flip ? !up : up;
      } else if (extra) stat.note = extra;
    }
    out.push(stat);
  }
  return out;
}

// ---------------------------------------------------------------- tree fence

export interface TreeNode {
  name: string;
  /** Annotation after the name (size, count, comment). */
  note?: string;
  children: TreeNode[];
}

const TREE_GLYPHS = /[├└│]|\|--|`--/;

/** Does a plain fence look like an ASCII tree? (auto-upgrade heuristic) */
export function looksLikeTree(src: string): boolean {
  const lines = src.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;
  const glyphed = lines.filter((l) => TREE_GLYPHS.test(l)).length;
  return glyphed >= Math.max(2, lines.length * 0.5);
}

/**
 * Parse `tree`-style output (├── / └── / │, or plain 2-space indentation, or `a/b/c` paths — one
 * entry per line) into a nested structure. Depth comes from the glyph/indent width.
 */
export function parseTree(src: string): TreeNode[] | null {
  const lines = src.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0 || lines.length > 500) return null;

  // Path mode: every line is a slash path with no tree glyphs or leading spaces.
  if (lines.every((l) => !TREE_GLYPHS.test(l) && !/^\s/.test(l)) && lines.filter((l) => l.includes("/")).length >= 2) {
    const roots: TreeNode[] = [];
    for (const line of lines) {
      const [path, ...noteParts] = line.trim().split(/\s{2,}| — | # /);
      const segs = path.split("/").filter(Boolean);
      if (segs.length === 0) return null;
      let level = roots;
      let node: TreeNode | undefined;
      for (const seg of segs) {
        node = level.find((n) => n.name === seg || n.name === seg + "/");
        if (!node) {
          node = { name: seg, children: [] };
          level.push(node);
        }
        level = node.children;
      }
      if (node && noteParts.length) node.note = noteParts.join(" ").trim() || undefined;
    }
    return roots;
  }

  // Glyph / indent mode.
  interface Row {
    depth: number;
    name: string;
    note?: string;
  }
  const rows: Row[] = [];
  for (const raw of lines) {
    // Strip the tree drawing; each glyph column is 4 chars wide ("│   ", "├── ").
    const m = raw.match(/^((?:[│|]\s{0,3}|\s{2,4}|[├└`|][─-]{2}\s?)*)(.*)$/);
    if (!m) return null;
    const prefix = m[1];
    const rest = m[2].trim();
    if (!rest) continue;
    const hadBranch = /[├└`]|[|]--/.test(prefix);
    const depth = hadBranch ? Math.max(1, Math.round(prefix.length / 4)) : Math.round(prefix.length / 4);
    const noteMatch = rest.match(/^(\S+)\s{2,}(.+)$|^(.+?)\s+(?:—|#)\s+(.+)$/);
    const name = noteMatch ? (noteMatch[1] ?? noteMatch[3]).trim() : rest;
    const note = noteMatch ? (noteMatch[2] ?? noteMatch[4]).trim() : undefined;
    rows.push({ depth, name, note });
  }
  if (rows.length === 0) return null;
  const roots: TreeNode[] = [];
  const stack: { depth: number; node: TreeNode }[] = [];
  for (const r of rows) {
    const node: TreeNode = { name: r.name, note: r.note, children: [] };
    while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ depth: r.depth, node });
  }
  return roots.length ? roots : null;
}

// ---------------------------------------------------------------- flow fence

export interface FlowStep {
  name: string;
  /** ok | fail | active | plain — set by a trailing marker: ✓ / ✗ / … */
  state: "ok" | "fail" | "active" | "plain";
}

/** ```flow fence: each line is a chain `A -> B -> C`; steps may end with ✓ ✗ or … */
export function parseFlow(src: string): FlowStep[][] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 12) return null;
  const chains: FlowStep[][] = [];
  for (const line of lines) {
    const parts = line.split(/\s*(?:->|→|=>|⇒)\s*/).filter(Boolean);
    chains.push(
      parts.map((p) => {
        let state: FlowStep["state"] = "plain";
        let name = p;
        if (/[✓✔]$/.test(p)) (state = "ok"), (name = p.replace(/\s*[✓✔]$/, ""));
        else if (/[✗✘x]$/.test(p) && p.length > 2) (state = "fail"), (name = p.replace(/\s*[✗✘]$/, ""));
        else if (/(\.\.\.|…)$/.test(p)) (state = "active"), (name = p.replace(/\s*(\.\.\.|…)$/, ""));
        return { name: name.trim(), state };
      })
    );
  }
  // A flow must actually chain somewhere; all-single-step lines are just a list, not a pipeline.
  return chains.some((c) => c.length >= 2) ? chains : null;
}

// ---------------------------------------------------------------- csv / tsv fence

export interface ParsedTable {
  head: string[];
  rows: string[][];
}

/** ```csv / ```tsv fence → header + rows. Quoted CSV fields with embedded commas are handled. */
export function parseDelimited(src: string, delim: "," | "\t"): ParsedTable | null {
  const lines = src.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2 || lines.length > 1000) return null;
  const split = (line: string): string[] => {
    if (delim === "\t") return line.split("\t").map((s) => s.trim());
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") out.push(cur.trim()), (cur = "");
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]);
  if (head.length < 2) return null;
  const rows = lines.slice(1).map(split);
  if (rows.some((r) => r.length !== head.length)) return null;
  return { head, rows };
}

/** Escape one CSV field for the copy-as-CSV action. */
export function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------- fence tidy-up

/** Colon-separated line fences: `label: value` per line. */
const COLON_FENCES = new Set(["stats", "progress", "kv", "funnel", "badges", "score"]);

/**
 * Agents write line fences as markdown out of habit — `- ` bullets, `**bold**` labels, `=` or `|`
 * instead of `:`, `-->` arrows, task-list steps. Normalize those spellings to the documented shape
 * before parsing so the fence renders instead of falling back to code. Content is never added or
 * dropped; only the punctuation of each line changes.
 */
export function tidyFence(language: string, src: string): string {
  const lines = src.split("\n");
  const bullet = /^\s*(?:[-*•+])\s+(?!\[[ xX]\])/;
  const unbold = (l: string) => l.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => a ?? b);
  if (COLON_FENCES.has(language)) {
    return lines
      .map((l) => {
        let s = unbold(l.replace(bullet, ""));
        if (s.trim() && !s.includes(":")) s = s.replace(/\s*(?:=|\|)\s*/, ": ");
        return s;
      })
      .join("\n");
  }
  if (language === "timeline") {
    return lines
      .map((l) => {
        const s = unbold(l.replace(bullet, ""));
        return s.includes("|") ? s : s.replace(/^(\s*\S+(?:\s+(?:AM|PM|UTC|am|pm))?)\s+[-–—]\s+/, "$1 | ");
      })
      .join("\n");
  }
  if (language === "steps") {
    let n = 0;
    return lines
      .map((l) => {
        if (/^\s*\d+[.)]\s/.test(l)) return unbold(l);
        const m = l.match(/^\s*[-*•+]\s+(?:\[([ xX])\]\s+)?(.*)$/);
        if (!m) return l;
        n++;
        return `${n}. ${unbold(m[2])}${m[1] && m[1] !== " " ? " ✓" : ""}`;
      })
      .join("\n");
  }
  if (language === "flow") {
    return lines.map((l) => unbold(l.replace(bullet, "")).replace(/\s*(?:-{2,}>|—>|={2,}>|~>)\s*/g, " -> ")).join("\n");
  }
  return src;
}
