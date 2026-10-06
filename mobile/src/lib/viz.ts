/**
 * Pure parsers behind the mobile output visualizers — ported from web/src/lib/viz.ts,
 * viz-extra.ts, viz-auto.ts and viz-tool-output.ts (platform-neutral functions only).
 *
 * Contract (same as web): every parser returns `null` for input it does not confidently
 * understand, is bounded in input size, and never throws. The markdown layer treats null as
 * "render the plain code block instead".
 *
 * The second-wave parsers (viz-extra.ts), bare-fence sniffers (viz-auto.ts), mermaid helpers
 * (viz-mermaid.ts) and code refs (code-refs.ts) are verbatim copies of their web counterparts.
 */

import {
  calloutKind,
  parseAnnotate,
  parseBadges,
  parseCommits,
  parseCompare,
  parseDag,
  parseDeps,
  parseDiffstat,
  parseFindings,
  parseFunnel,
  parseHeatmap,
  parseHttp,
  parseKeys,
  parseKv,
  parseLayers,
  parseLog,
  parsePalette,
  parseProgress,
  parseScores,
  parseSequence,
  parseSpans,
  parseSteps,
  parseTests,
  parseTimeline,
  type Annotated,
  type Badge,
  type CalloutKind,
  type Commit,
  type CompareOption,
  type Dag,
  type DepUpdate,
  type DiffStat,
  type Finding,
  type Heatmap,
  type HttpCall,
  type Layer,
  type LogLine,
  type ProgressRow,
  type Score,
  type Sequence,
  type Span,
  type Step,
  type Swatch,
  type TestReport,
  type TimelineEvent,
} from "./viz-extra";
import { sniffBare, sniffLanguage } from "./viz-auto";
import type { AutoBlock, CommandLine, Comparison, CronSpec, EnvVar, FileEntry, IniSection, JwtDecoded, LinkItem, StackTrace, UrlParts } from "./viz-auto-types";

export * from "./viz-extra";
export type * from "./viz-auto-types";
export { parseStatusItems } from "./viz-auto";

// ---------------------------------------------------------------- numbers

/**
 * Numeric reading of a cell for alignment and magnitude. Accepts the shapes agents actually emit:
 * `1,234`, `12.5%`, `3.4 MB`, `$1.2k`, `-7ms`, `~90`. Returns null for prose.
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
  unit?: string;
  stacked?: boolean;
}

const CHART_TYPES: Record<string, ChartSpec["type"]> = {
  bar: "bar", bars: "bar", column: "bar", columns: "bar", histogram: "bar",
  line: "line", lines: "line", area: "area",
  donut: "donut", doughnut: "donut", pie: "donut",
  sparkline: "sparkline", spark: "sparkline", scatter: "scatter",
};

function chartNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return cellNumber(v) ?? NaN;
  return NaN;
}

const firstArray = (o: Record<string, unknown>, keys: string[]): unknown[] | undefined => {
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[];
  return undefined;
};

/** ```chart fence: JSON `{type, labels, series:[{name,data}]}` or `{type, labels, values}`. */
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
  const n = labels.length;
  if (series.some((s) => s.data.length !== n)) return null;
  if ((type === "donut" || type === "sparkline") && series.length > 1) return null;
  if (type === "donut" && series[0].data.some((v) => v < 0)) return null;
  if (type === "scatter" && series.length > 3) return null;
  const stacked = o.stacked === true && type === "bar";
  if (stacked && series.some((s) => s.data.some((v) => v < 0))) return null;
  return { type, title, labels, series, unit: typeof o.unit === "string" ? o.unit : undefined, stacked: stacked || undefined };
}

// ---------------------------------------------------------------- stats fence

export interface Stat {
  label: string;
  value: string;
  delta?: string;
  deltaGood?: boolean;
  note?: string;
}

/** ```stats: `Label: value | +12% | note` per line; a trailing `!` on the delta flips "up is good". */
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

// ---------------------------------------------------------------- csv / tsv / tables

export interface ParsedTable {
  head: string[];
  rows: string[][];
  /** Per-column alignment; undefined → auto (numeric columns right-align). */
  align?: ("left" | "right" | "center" | undefined)[];
}

/** ```csv / ```tsv → header + rows. Quoted CSV fields with embedded commas are handled. */
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

/** Split one GFM table row `| a | b |` into trimmed cells (escaped `\|` preserved). */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

/** Is this the `|---|:--:|` alignment row of a GFM table? */
export function isTableDelimiterRow(line: string): boolean {
  const s = line.trim();
  if (!s.includes("-")) return false;
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(s);
}

/**
 * GFM pipe table lines → table. The alignment row is required (otherwise it is prose with pipes).
 * Ragged body rows are padded/trimmed to the header width so a half-streamed table still renders.
 */
export function parseGfmTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2 || !isTableDelimiterRow(lines[1])) return null;
  const head = splitTableRow(lines[0]);
  if (head.length < 1) return null;
  const align = splitTableRow(lines[1]).map((c) => {
    const l = c.startsWith(":");
    const r = c.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : undefined;
  });
  const rows = lines.slice(2).map((l) => {
    const cells = splitTableRow(l);
    while (cells.length < head.length) cells.push("");
    return cells.slice(0, head.length);
  });
  return { head, rows, align };
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
  const unbold = (l: string) => l.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a: string | undefined, b: string | undefined) => a ?? b ?? "");
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
        // Indented bullets are sub-steps (parseSteps keeps them under their step); only top-level bullets become steps.
        const m = l.match(/^[-*•+]\s+(?:\[([ xX])\]\s+)?(.*)$/);
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


// ---------------------------------------------------------------- markdown list upgrades

/** A bullet list whose every item is `label: NN%` / `label: a/b` → progress rows (web parity). */
export function progressFromItems(items: string[] | null): ProgressRow[] | null {
  if (!items || items.length < 2) return null;
  const lines = items.map((t) => t.replace(/\*\*|__|`/g, "").trim());
  if (lines.some((l) => !l || l.includes("\n"))) return null;
  return parseProgress(lines.join("\n"));
}

// ---------------------------------------------------------------- JSON tree

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** ```json / ```jsonc → parsed object/array worth exploring (scalars and short one-liners → null). */
export function parseJsonBlock(src: string): JsonValue | null {
  if (!src.includes("\n") && src.length <= 80) return null;
  for (const candidate of [src, stripJsonc(src)]) {
    try {
      const v: unknown = JSON.parse(candidate);
      if (typeof v === "object" && v !== null) return v as JsonValue;
      return null;
    } catch {
      /* not (yet) valid JSON — try the comment-stripped form, then give up */
    }
  }
  return null;
}

/** Remove `//` and `/* *\/` comments (outside strings) and trailing commas from JSONC. */
function stripJsonc(src: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

// ---------------------------------------------------------------- router

export type SmartSpec =
  | { kind: "chart"; title?: string; spec: ChartSpec }
  | { kind: "stats"; title?: string; stats: Stat[] }
  | { kind: "kv"; title?: string; rows: { key: string; value: string }[] }
  | { kind: "badges"; title?: string; badges: Badge[] }
  | { kind: "progress"; title?: string; rows: ProgressRow[] }
  | { kind: "steps"; title?: string; steps: Step[] }
  | { kind: "table"; title?: string; table: ParsedTable }
  | { kind: "json"; title?: string; value: JsonValue }
  | { kind: "tests"; title?: string; report: TestReport }
  | { kind: "timeline"; title?: string; events: TimelineEvent[] }
  | { kind: "callout"; title?: string; callout: CalloutKind; body: string }
  | { kind: "flow"; title?: string; chains: FlowStep[][] }
  | { kind: "tree"; title?: string; roots: TreeNode[] }
  | { kind: "score"; title?: string; scores: Score[] }
  | { kind: "keys"; title?: string; rows: { keys: string[]; action: string }[] }
  | { kind: "palette"; title?: string; swatches: Swatch[] }
  | { kind: "http"; title?: string; calls: HttpCall[] }
  | { kind: "log"; title?: string; lines: LogLine[] }
  | { kind: "diffstat"; title?: string; files: DiffStat[] }
  | { kind: "commits"; title?: string; commits: Commit[] }
  | { kind: "deps"; title?: string; deps: DepUpdate[] }
  | { kind: "graph"; title?: string; dag: Dag }
  | { kind: "sequence"; title?: string; sequence: Sequence }
  | { kind: "mermaid"; title?: string; source: string; label: string }
  | { kind: "findings"; title?: string; findings: Finding[] }
  | { kind: "compare"; title?: string; options: CompareOption[] }
  | { kind: "annotate"; title?: string; data: Annotated }
  | { kind: "layers"; title?: string; layers: Layer[] }
  | { kind: "funnel"; title?: string; stages: { label: string; value: number }[] }
  | { kind: "spans"; title?: string; spans: Span[]; unit?: string }
  | { kind: "heatmap"; title?: string; map: Heatmap }
  | { kind: "ini"; title?: string; sections: IniSection[] }
  | { kind: "env"; title?: string; vars: EnvVar[] }
  | { kind: "stack"; title?: string; trace: StackTrace }
  | { kind: "files"; title?: string; entries: FileEntry[] }
  | { kind: "links"; title?: string; links: LinkItem[] }
  | { kind: "commands"; title?: string; commands: CommandLine[] }
  | { kind: "comparison"; title?: string; rows: Comparison[] }
  | { kind: "cron"; title?: string; specs: CronSpec[] }
  | { kind: "url"; title?: string; url: UrlParts }
  | { kind: "jwt"; title?: string; jwt: JwtDecoded };

/** Fences whose content is line-oriented: a streaming one is parsed up to its last whole line (web LINE_FENCES). */
export const LINE_FENCES = new Set([
  "stats", "flow", "tree", "csv", "tsv", "timeline", "steps", "algorithm", "procedure", "progress", "kv", "badges", "score", "keys", "shortcuts",
  "palette", "http", "tests", "log", "diffstat", "commits", "deps", "graph", "dag", "sequence", "findings", "issues", "risks", "funnel", "gantt", "spans", "heatmap",
  "compare", "annotate", "layers",
]);

/** Bare-ish fences the sniffer (viz-auto.ts) may upgrade. */
const BARE_LANGS = new Set(["", "plaintext", "text", "txt", "plain", "output", "console-output"]);

/** A leading `# title` or `title: …` line is a block title for line fences (stripped before parsing). */
function splitTitle(src: string): { title?: string; body: string } {
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const m = lines[i]?.match(/^\s*(?:#\s+(.+?)|title:\s*(.+?))\s*$/);
  if (!m) return { body: src };
  return { title: (m[1] ?? m[2]).trim(), body: lines.slice(i + 1).join("\n") };
}

/** Mermaid diagram kinds drawn by mermaid itself (flowcharts that parse go to the graph block). */
const MERMAID_KINDS: Record<string, string> = {
  sequenceDiagram: "sequence diagram",
  stateDiagram: "state diagram",
  "stateDiagram-v2": "state diagram",
  classDiagram: "class diagram",
  erDiagram: "entity relationship diagram",
  gantt: "gantt chart",
  journey: "user journey",
  pie: "pie chart",
  mindmap: "mind map",
  timeline: "timeline",
  flowchart: "flowchart",
  graph: "flowchart",
};

/** The diagram kind a raw mermaid fence declares on its first statement, or null. */
export function mermaidKind(src: string): string | null {
  const first = src
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%%"));
  const word = first?.split(/\s+/)[0];
  return word && Object.prototype.hasOwnProperty.call(MERMAID_KINDS, word) ? MERMAID_KINDS[word] : null;
}

/** One sniffed shape → its spec. Shapes the existing parsers own are re-parsed from the source (web renderAuto). */
function fromAuto(auto: AutoBlock | null, src: string): SmartSpec | null {
  if (!auto) return null;
  switch (auto.kind) {
    case "table":
      return { kind: "table", title: auto.title, table: { head: auto.table.head, rows: auto.table.rows } };
    case "csv": {
      const table = parseDelimited(src, auto.delimiter === "|" ? "," : auto.delimiter);
      return table && { kind: "table", table };
    }
    case "json":
      return { kind: "json", value: auto.value as JsonValue };
    case "kv":
      return { kind: "kv", rows: auto.rows };
    case "ini":
      return { kind: "ini", sections: auto.sections };
    case "env":
      return { kind: "env", vars: auto.vars };
    case "stack":
      return { kind: "stack", trace: auto.trace };
    case "files":
      return { kind: "files", entries: auto.entries };
    case "links":
      return { kind: "links", links: auto.links };
    case "commands":
      return { kind: "commands", commands: auto.commands };
    case "comparison":
      return { kind: "comparison", rows: auto.rows };
    case "cron":
      return { kind: "cron", specs: auto.specs };
    case "url":
      return { kind: "url", url: auto.url };
    case "jwt":
      return { kind: "jwt", jwt: auto.jwt };
    case "semver":
      return { kind: "deps", deps: auto.rows };
    case "dag":
      return { kind: "graph", dag: auto.dag };
    case "sequence":
      return { kind: "sequence", sequence: auto.sequence };
    case "progress": {
      const rows = parseProgress(src);
      return rows && { kind: "progress", rows };
    }
    case "badges": {
      const badges = parseBadges(src);
      return badges && { kind: "badges", badges };
    }
    case "http": {
      const calls = parseHttp(src);
      return calls && { kind: "http", calls };
    }
    case "log": {
      const lines = parseLog(src);
      return lines && { kind: "log", lines };
    }
    case "tests": {
      const report = parseTests(src);
      return report && { kind: "tests", report };
    }
    case "timeline": {
      const events = parseTimeline(src);
      return events && { kind: "timeline", events };
    }
    case "steps": {
      const steps = parseSteps(src);
      return steps && { kind: "steps", steps };
    }
    case "deps": {
      const deps = parseDeps(src);
      return deps && { kind: "deps", deps };
    }
    case "diffstat": {
      const files = parseDiffstat(src);
      return files && { kind: "diffstat", files };
    }
    case "commits": {
      const commits = parseCommits(src);
      return commits && { kind: "commits", commits };
    }
    case "tree": {
      const roots = parseTree(src);
      return roots && { kind: "tree", roots };
    }
  }
}

/**
 * The output-visualizer router (web SmartBlock): fence language + text → a parsed spec, or null
 * for "plain code". Only call this on CLOSED fences; the markdown layer keeps open fences as code
 * so a half-streamed block never flips between code and visual until it completes.
 */
export function smartBlock(language: string, code: string): SmartSpec | null {
  const lang = language.toLowerCase();
  const src = code.replace(/\n$/, "");
  try {
    const ck = calloutKind(lang);
    if (ck) return src.trim() ? { kind: "callout", callout: ck, body: src } : null;
    switch (lang) {
      case "chart": {
        const spec = parseChartSpec(src);
        return spec ? { kind: "chart", title: spec.title, spec } : null;
      }
      case "json":
      case "jsonc": {
        const value = parseJsonBlock(src);
        return value ? { kind: "json", value } : null;
      }
      case "heatmap": {
        const map = parseHeatmap(src);
        return map ? { kind: "heatmap", map } : null;
      }
      case "mermaid": {
        // Flowcharts our parser understands draw as a native graph; sequence diagrams that parse
        // draw natively too (WebView mermaid first); every other kind goes to mermaid in a WebView.
        const auto = sniffLanguage(lang, src);
        if (auto?.kind === "dag") return fromAuto(auto, src);
        const label = mermaidKind(src);
        return label ? { kind: "mermaid", source: src, label } : null;
      }
    }
    if (BARE_LANGS.has(lang)) return fromAuto(sniffBare(src), src);
    if (lang === "csv" || lang === "tsv") {
      const { title, body } = splitTitle(src);
      const table = parseDelimited(body, lang === "csv" ? "," : "\t");
      return table ? { kind: "table", title, table } : null;
    }
    if (!LINE_FENCES.has(lang)) return fromAuto(sniffLanguage(lang, src), src);
    const { title, body } = splitTitle(src);
    const tidy = tidyFence(lang, body);
    switch (lang) {
      case "stats": {
        const stats = parseStats(tidy);
        return stats ? { kind: "stats", title, stats } : null;
      }
      case "flow": {
        const chains = parseFlow(tidy);
        return chains ? { kind: "flow", title, chains } : null;
      }
      case "tree": {
        const roots = parseTree(body);
        return roots ? { kind: "tree", title, roots } : null;
      }
      case "kv": {
        const rows = parseKv(tidy);
        return rows ? { kind: "kv", title, rows } : null;
      }
      case "badges": {
        const badges = parseBadges(tidy);
        return badges ? { kind: "badges", title, badges } : null;
      }
      case "progress": {
        const rows = parseProgress(tidy);
        return rows ? { kind: "progress", title, rows } : null;
      }
      case "steps":
      case "algorithm":
      case "procedure": {
        const steps = parseSteps(tidyFence("steps", body));
        return steps ? { kind: "steps", title, steps } : null;
      }
      case "tests": {
        const report = parseTests(body);
        return report ? { kind: "tests", title, report } : null;
      }
      case "timeline": {
        const events = parseTimeline(tidy);
        return events ? { kind: "timeline", title, events } : null;
      }
      case "score": {
        const scores = parseScores(tidy);
        return scores ? { kind: "score", title, scores } : null;
      }
      case "keys":
      case "shortcuts": {
        const rows = parseKeys(body);
        return rows ? { kind: "keys", title, rows } : null;
      }
      case "palette": {
        const swatches = parsePalette(body);
        return swatches ? { kind: "palette", title, swatches } : null;
      }
      case "http": {
        const calls = parseHttp(body);
        return calls ? { kind: "http", title, calls } : null;
      }
      case "log": {
        const lines = parseLog(body);
        return lines ? { kind: "log", title, lines } : null;
      }
      case "diffstat": {
        const files = parseDiffstat(body);
        return files ? { kind: "diffstat", title, files } : null;
      }
      case "commits": {
        const commits = parseCommits(body);
        return commits ? { kind: "commits", title, commits } : null;
      }
      case "deps": {
        const deps = parseDeps(body);
        return deps ? { kind: "deps", title, deps } : null;
      }
      case "graph":
      case "dag": {
        const dag = parseDag(body);
        return dag ? { kind: "graph", title, dag } : null;
      }
      case "sequence": {
        const sequence = parseSequence(body);
        return sequence ? { kind: "sequence", title, sequence } : null;
      }
      case "findings":
      case "issues":
      case "risks": {
        const findings = parseFindings(body);
        return findings ? { kind: "findings", title, findings } : null;
      }
      case "compare": {
        const options = parseCompare(body);
        return options ? { kind: "compare", title, options } : null;
      }
      case "annotate": {
        const data = parseAnnotate(src);
        return data ? { kind: "annotate", data } : null;
      }
      case "layers": {
        const layers = parseLayers(body);
        return layers ? { kind: "layers", title, layers } : null;
      }
      case "funnel": {
        const stages = parseFunnel(tidy);
        return stages ? { kind: "funnel", title, stages } : null;
      }
      case "gantt":
      case "spans": {
        const r = parseSpans(body);
        return r ? { kind: "spans", title, spans: r.spans, unit: r.unit } : null;
      }
    }
  } catch {
    /* a parser bug must never take the transcript down — fall back to code */
  }
  return null;
}
