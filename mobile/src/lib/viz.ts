/**
 * Pure parsers behind the mobile output visualizers — ported from web/src/lib/viz.ts,
 * viz-extra.ts, viz-auto.ts and viz-tool-output.ts (platform-neutral functions only).
 *
 * Contract (same as web): every parser returns `null` for input it does not confidently
 * understand, is bounded in input size, and never throws. The markdown layer treats null as
 * "render the plain code block instead".
 *
 * UNSUPPORTED on mobile for now (these fence kinds stay code blocks): flow, tree, graph/dag,
 * gantt/spans, heatmap, http, log, diffstat, commits, deps, funnel, score, keys/shortcuts,
 * palette, and the bare-fence auto-sniffers (viz-auto).
 */

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

const COLON_FENCES = new Set(["stats", "progress", "kv", "funnel", "badges", "score"]);

/** Normalize the markdown-ish spellings agents use inside line fences (bullets, bold, `=`/`|`). */
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
        const m = l.match(/^\s*[-*•+]\s+(?:\[([ xX])\]\s+)?(.*)$/);
        if (!m) return l;
        n++;
        return `${n}. ${unbold(m[2])}${m[1] && m[1] !== " " ? " ✓" : ""}`;
      })
      .join("\n");
  }
  return src;
}

// ---------------------------------------------------------------- timeline

export interface TimelineEvent {
  time: string;
  text: string;
  note?: string;
  state: "ok" | "fail" | "active" | "plain";
}

/** ```timeline: `time | text | note?` per line; text may end with ✓ ✗ or …. */
export function parseTimeline(src: string): TimelineEvent[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 50) return null;
  const out: TimelineEvent[] = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    let text = parts[1];
    let state: TimelineEvent["state"] = "plain";
    if (/[✓✔]$/.test(text)) (state = "ok"), (text = text.replace(/\s*[✓✔]$/, ""));
    else if (/[✗✘]$/.test(text)) (state = "fail"), (text = text.replace(/\s*[✗✘]$/, ""));
    else if (/(\.\.\.|…)$/.test(text)) (state = "active"), (text = text.replace(/\s*(\.\.\.|…)$/, ""));
    out.push({ time: parts[0], text, note: parts[2] || undefined, state });
  }
  return out;
}

// ---------------------------------------------------------------- steps

export interface Step {
  title: string;
  detail?: string;
  state: "done" | "active" | "todo" | "fail";
}

/** ```steps: `1. Install deps ✓` lines with optional indented detail lines. */
export function parseSteps(src: string): Step[] | null {
  const lines = src.split("\n").filter((l) => l.trim());
  if (lines.length === 0 || lines.length > 60) return null;
  const out: Step[] = [];
  for (const raw of lines) {
    const m = raw.match(/^(\d+)[.)]\s+(.*)$/);
    if (m) {
      let title = m[2].trim();
      let state: Step["state"] = "todo";
      if (/[✓✔]$/.test(title)) (state = "done"), (title = title.replace(/\s*[✓✔]$/, ""));
      else if (/[✗✘]$/.test(title)) (state = "fail"), (title = title.replace(/\s*[✗✘]$/, ""));
      else if (/(\.\.\.|…)$/.test(title)) (state = "active"), (title = title.replace(/\s*(\.\.\.|…)$/, ""));
      out.push({ title, state });
    } else if (/^\s+\S/.test(raw) && out.length) {
      const prev = out[out.length - 1];
      prev.detail = (prev.detail ? prev.detail + " " : "") + raw.trim();
    } else return null;
  }
  return out.length >= 2 ? out : null;
}

// ---------------------------------------------------------------- progress

export interface ProgressRow {
  label: string;
  frac: number;
  text: string;
}

/** ```progress: `label: 72%` or `label: 34/50` per line. */
export function parseProgress(src: string): ProgressRow[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 20) return null;
  const out: ProgressRow[] = [];
  for (const line of lines) {
    const idx = line.lastIndexOf(":");
    if (idx <= 0) return null;
    const label = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    let frac: number | null = null;
    const pct = val.match(/^(\d+(?:\.\d+)?)\s*%$/);
    const ratio = val.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (pct) frac = Number(pct[1]) / 100;
    else if (ratio && Number(ratio[2]) > 0) frac = Number(ratio[1]) / Number(ratio[2]);
    if (frac === null || !Number.isFinite(frac)) return null;
    out.push({ label, frac: Math.max(0, Math.min(1, frac)), text: val });
  }
  return out;
}

/** A bullet list whose every item is `label: NN%` / `label: a/b` → progress rows (web parity). */
export function progressFromItems(items: string[] | null): ProgressRow[] | null {
  if (!items || items.length < 2) return null;
  const lines = items.map((t) => t.replace(/\*\*|__|`/g, "").trim());
  if (lines.some((l) => !l || l.includes("\n"))) return null;
  return parseProgress(lines.join("\n"));
}

// ---------------------------------------------------------------- kv

/** ```kv: `key: value` per line. */
export function parseKv(src: string): { key: string; value: string }[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 40) return null;
  const out: { key: string; value: string }[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0 || idx > 40) return null;
    out.push({ key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
  }
  return out;
}

// ---------------------------------------------------------------- badges

export type BadgeTone = "ok" | "warn" | "fail" | "live" | "neutral";
export interface Badge {
  label: string;
  value: string;
  tone: BadgeTone;
}

const TONE_WORDS: Record<string, BadgeTone> = {
  ok: "ok", pass: "ok", passed: "ok", healthy: "ok", up: "ok", done: "ok", green: "ok", stable: "ok", active: "ok", enabled: "ok", yes: "ok", on: "ok",
  warn: "warn", warning: "warn", degraded: "warn", flaky: "warn", pending: "warn", stale: "warn", deprecated: "warn",
  fail: "fail", failed: "fail", error: "fail", down: "fail", critical: "fail", broken: "fail", no: "fail", off: "fail", disabled: "fail",
  running: "live", building: "live", deploying: "live", working: "live", live: "live", streaming: "live",
  recurring: "warn", present: "warn", rising: "warn", increasing: "warn", elevated: "warn",
};
const OK_WORDS = new Set(["none", "zero", "0", "clear", "clean", "ok", "healthy", "resolved"]);

/** ```badges: `label: state` per line; tone inferred from the state word and a trouble-naming label. */
export function parseBadges(src: string): Badge[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 16) return null;
  const out: Badge[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) return null;
    const label = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!value || value.length > 40) return null;
    let tone: BadgeTone = TONE_WORDS[value.toLowerCase()] ?? "neutral";
    if (/error|fail|crash|outage|incident/i.test(label)) {
      tone = OK_WORDS.has(value.toLowerCase()) ? "ok" : tone === "neutral" || tone === "warn" ? "warn" : "fail";
    }
    out.push({ label, value, tone });
  }
  return out;
}

// ---------------------------------------------------------------- tests

export interface TestReport {
  passed: number;
  failed: number;
  skipped: number;
  duration?: string;
  failures: string[];
}

/** ```tests: a summary line (`633 passed, 2 failed in 65s`) or `key: n` lines, plus `✗ name` failures. */
export function parseTests(src: string): TestReport | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 60) return null;
  const r: TestReport = { passed: 0, failed: 0, skipped: 0, failures: [] };
  let sawCount = false;
  for (const line of lines) {
    if (/^[✗✘x]\s+/.test(line) && line.length > 2) {
      r.failures.push(line.replace(/^[✗✘x]\s+/, ""));
      continue;
    }
    let matched = false;
    for (const m of line.matchAll(/(\d+)\s*(passed|failed|skipped|pass|fail|skip)\b/gi)) {
      const n = Number(m[1]);
      const k = m[2].toLowerCase();
      if (k.startsWith("pass")) r.passed = n;
      else if (k.startsWith("fail")) r.failed = n;
      else r.skipped = n;
      sawCount = matched = true;
    }
    const kv = line.match(/^(passed|failed|skipped)\s*:\s*(\d+)$/i);
    if (kv) {
      r[kv[1].toLowerCase() as "passed" | "failed" | "skipped"] = Number(kv[2]);
      sawCount = matched = true;
    }
    const dur = line.match(/\b(?:in|duration:?)\s*([\d.]+\s*(?:ms|s|m|min))\b/i);
    if (dur) (r.duration = dur[1]), (matched = true);
    if (!matched) return null;
  }
  return sawCount && r.passed + r.failed + r.skipped > 0 ? r : null;
}

// ---------------------------------------------------------------- callout

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution" | "success" | "error";

/** GitHub alert names + fence aliases → the console's functional hues. */
export function calloutKind(name: string): CalloutKind | null {
  const k = name.toLowerCase();
  if (["note", "info"].includes(k)) return "note";
  if (["tip", "hint"].includes(k)) return "tip";
  if (["important"].includes(k)) return "important";
  if (["warning", "warn"].includes(k)) return "warning";
  if (["caution", "danger"].includes(k)) return "caution";
  if (["success", "ok"].includes(k)) return "success";
  if (["error", "failure"].includes(k)) return "error";
  return null;
}

// ---------------------------------------------------------------- status list (markdown upgrade)

export interface StatusItem {
  state: "ok" | "fail" | "warn" | "pending" | "info";
  text: string;
}

const STATUS_RE = /^(✅|✔️?|✓|❌|✘|✗|⚠️?|⏳|🔄|🕒|ℹ️?|🟢|🔴|🟡|\[(?:x|X| )\]|PASS(?:ED)?|FAIL(?:ED)?|WARN(?:ING)?|OK|DONE|TODO|PENDING|SKIP(?:PED)?|ERROR|INFO)\s*[:\-–—]?\s*(.+)$/u;

/** A list whose every item opens with a status glyph/word → status rows (web parity). */
export function parseStatusItems(items: string[]): StatusItem[] | null {
  if (items.length < 2 || items.length > 60) return null;
  const out: StatusItem[] = [];
  for (const raw of items) {
    const m = raw.trim().match(STATUS_RE);
    if (!m) return null;
    const g = m[1].toUpperCase();
    const state: StatusItem["state"] = /✅|✔|✓|PASS|OK|DONE|🟢|\[X\]/.test(g)
      ? "ok"
      : /❌|✘|✗|FAIL|ERROR|🔴/.test(g)
        ? "fail"
        : /⚠|WARN|🟡/.test(g)
          ? "warn"
          : /⏳|🔄|🕒|TODO|PENDING|SKIP|\[ \]/.test(g)
            ? "pending"
            : "info";
    out.push({ state, text: m[2].trim() });
  }
  return out;
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
  | { kind: "callout"; title?: string; callout: CalloutKind; body: string };

/** Fence kinds this router understands (anything else → plain code block). */
export const SMART_LANGS = new Set([
  "chart", "stats", "kv", "badges", "progress", "steps", "csv", "tsv", "json", "jsonc", "tests", "timeline",
  "note", "info", "tip", "important", "warn", "warning", "caution", "danger", "success", "error",
]);

/** A leading `# title` or `title: …` line is a block title for line fences (stripped before parsing). */
function splitTitle(src: string): { title?: string; body: string } {
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const m = lines[i]?.match(/^\s*(?:#\s+(.+?)|title:\s*(.+?))\s*$/);
  if (!m) return { body: src };
  return { title: (m[1] ?? m[2]).trim(), body: lines.slice(i + 1).join("\n") };
}

/**
 * The output-visualizer router: fence language + text → a parsed spec, or null for "plain code".
 * Only call this on CLOSED fences; the markdown layer keeps open fences as code (streaming).
 */
export function smartBlock(language: string, code: string): SmartSpec | null {
  const lang = language.toLowerCase();
  if (!SMART_LANGS.has(lang)) return null;
  const src = code.replace(/\n$/, "");
  try {
    const ck = calloutKind(lang);
    if (ck) return src.trim() ? { kind: "callout", callout: ck, body: src } : null;
    if (lang === "chart") {
      const spec = parseChartSpec(src);
      return spec ? { kind: "chart", title: spec.title, spec } : null;
    }
    if (lang === "json" || lang === "jsonc") {
      const value = parseJsonBlock(src);
      return value ? { kind: "json", value } : null;
    }
    if (lang === "csv" || lang === "tsv") {
      const { title, body } = splitTitle(src);
      const table = parseDelimited(body, lang === "csv" ? "," : "\t");
      return table ? { kind: "table", title, table } : null;
    }
    const { title, body } = splitTitle(src);
    const tidy = tidyFence(lang, body);
    switch (lang) {
      case "stats": {
        const stats = parseStats(tidy);
        return stats ? { kind: "stats", title, stats } : null;
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
      case "steps": {
        const steps = parseSteps(tidy);
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
    }
  } catch {
    /* a parser bug must never take the transcript down — fall back to code */
  }
  return null;
}
