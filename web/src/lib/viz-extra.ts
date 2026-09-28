/**
 * Parsers for the second wave of output visualizers (docs/output-visualizers.md). Same contract
 * as lib/viz.ts: null for anything not confidently understood, bounded input sizes, no throws.
 */

// ---------------------------------------------------------------- timeline

export interface TimelineEvent {
  time: string;
  text: string;
  note?: string;
  state: "ok" | "fail" | "active" | "plain";
}

/** ```timeline: one event per line — `time | text | note?`; text may end with ✓ ✗ or …. */
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

/**
 * ```steps: numbered lines (`1. Install deps ✓`), optional indented detail lines under each.
 * ✓ = done, ✗ = failed, … = active; unmarked steps after the first unmarked are upcoming.
 */
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
  frac: number; // 0..1
  text: string; // original value text ("72%", "34/50")
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

// ---------------------------------------------------------------- kv

/** ```kv: `key: value` per line → definition panel. Values keep everything after the first colon. */
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
};

/** ```badges: `label: state` per line → status chip row; tone inferred from the state word. */
export function parseBadges(src: string): Badge[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 16) return null;
  const out: Badge[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) return null;
    const value = line.slice(idx + 1).trim();
    if (!value || value.length > 40) return null;
    out.push({ label: line.slice(0, idx).trim(), value, tone: TONE_WORDS[value.toLowerCase()] ?? "neutral" });
  }
  return out;
}

// ---------------------------------------------------------------- score

export interface Score {
  label: string;
  value: number;
  max: number;
  note?: string;
}

/** ```score: `label: 8/10 | note?` per line → dot-scale scorecards. Max ≤ 10 renders dots, else a bar. */
export function parseScores(src: string): Score[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 12) return null;
  const out: Score[] = [];
  for (const line of lines) {
    const m = line.match(/^(.+?):\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*(?:\|\s*(.+))?$/);
    if (!m) return null;
    const value = Number(m[2]);
    const max = Number(m[3]);
    if (!(max > 0) || value < 0 || value > max) return null;
    out.push({ label: m[1].trim(), value, max, note: m[4]?.trim() });
  }
  return out;
}

// ---------------------------------------------------------------- keys

/** ```keys: `Ctrl+K: open command palette` per line → kbd shortcut list. */
export function parseKeys(src: string): { keys: string[]; action: string }[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 30) return null;
  const out: { keys: string[]; action: string }[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0 || idx > 30) return null;
    const combo = line.slice(0, idx).trim();
    const action = line.slice(idx + 1).trim();
    if (!action) return null;
    out.push({ keys: combo.split("+").map((k) => k.trim()).filter(Boolean), action });
  }
  return out;
}

// ---------------------------------------------------------------- palette

export interface Swatch {
  hex: string;
  label?: string;
}

/** ```palette: one `#hex label?` per line (or `label: #hex`) → color swatches. */
export function parsePalette(src: string): Swatch[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 24) return null;
  const out: Swatch[] = [];
  for (const line of lines) {
    let m = line.match(/^(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?)\s*(.*)$/);
    if (m) out.push({ hex: m[1], label: m[2].trim() || undefined });
    else if ((m = line.match(/^(.+?):\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?)$/)))
      out.push({ hex: m[2], label: m[1].trim() });
    else return null;
  }
  return out;
}

// ---------------------------------------------------------------- http

export interface HttpCall {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  time?: string;
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/**
 * ```http: one call per line — `GET /api/x → 200 OK · 48ms` (arrow, status text, timing optional).
 * The URL part is everything between the method and the arrow, spaces included — agents shorten
 * long query strings with `...` and parenthetical notes, and one decorated line must not knock the
 * whole block back to a code fence.
 */
export function parseHttp(src: string): HttpCall[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 60) return null;
  const out: HttpCall[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z]+)\s+(.+?)(?:\s*(?:→|->)\s*(\d{3})\b\s*([A-Za-z][A-Za-z ]*?)?)?\s*(?:[·|]\s*([\d.]+\s?(?:ms|s|m|µs)))?$/);
    if (!m || !METHODS.has(m[1]) || !m[2].trim()) return null;
    out.push({ method: m[1], url: m[2].trim(), status: m[3] ? Number(m[3]) : undefined, statusText: m[4]?.trim(), time: m[5] });
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

/**
 * ```tests: either one summary line (`633 passed, 2 failed, 1 skipped in 65s`) or `key: n` lines,
 * plus optional `✗ test name` lines listing failures.
 */
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

// ---------------------------------------------------------------- diffstat

export interface DiffStat {
  path: string;
  add: number;
  del: number;
}

/**
 * ```diffstat (also auto-detected in bare fences): git `--stat` rows (`path | 12 ++--`), numstat
 * rows (`12\t3\tpath`), or `path +12 -3`. The trailing summary line is tolerated and dropped.
 */
export function parseDiffstat(src: string): DiffStat[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 200) return null;
  const out: DiffStat[] = [];
  for (const line of lines) {
    if (/^\d+ files? changed/.test(line)) continue; // git's summary footer
    let m = line.match(/^(\S+)\s*\|\s*(\d+)\s*([+-]*)$/);
    if (m) {
      const total = Number(m[2]);
      const plus = (m[3].match(/\+/g) ?? []).length;
      const minus = (m[3].match(/-/g) ?? []).length;
      const marks = plus + minus;
      const add = marks ? Math.round((total * plus) / marks) : total;
      out.push({ path: m[1], add, del: total - add });
      continue;
    }
    m = line.match(/^(\d+)\s+(\d+)\s+(\S+)$/); // numstat: add del path
    if (m) {
      out.push({ path: m[3], add: Number(m[1]), del: Number(m[2]) });
      continue;
    }
    m = line.match(/^(\S+)\s+\+(\d+)\s+[-−](\d+)$/);
    if (m) {
      out.push({ path: m[1], add: Number(m[2]), del: Number(m[3]) });
      continue;
    }
    return null;
  }
  return out.length ? out : null;
}

/** Auto-detect: does a bare fence look like `git diff --stat` output? */
export function looksLikeDiffstat(src: string): boolean {
  const lines = src.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const statRows = lines.filter((l) => /^\s*\S+\s*\|\s*\d+\s*[+-]*\s*$/.test(l)).length;
  return statRows >= Math.max(2, lines.length - 1);
}

// ---------------------------------------------------------------- commits

export interface Commit {
  hash: string;
  message: string;
}

/** ```commits (also auto-detected): `git log --oneline` rows — `abc1234 message`. */
export function parseCommits(src: string): Commit[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 100) return null;
  const out: Commit[] = [];
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{7,40})\s+(.+)$/);
    if (!m) return null;
    out.push({ hash: m[1], message: m[2] });
  }
  return out;
}

/** Auto-detect: a bare fence of ≥3 oneline-log rows. */
export function looksLikeCommits(src: string): boolean {
  const lines = src.split("\n").filter((l) => l.trim());
  return lines.length >= 3 && lines.every((l) => /^[0-9a-f]{7,12}\s+\S/.test(l.trim()));
}

// ---------------------------------------------------------------- deps

export interface DepUpdate {
  name: string;
  from: string;
  to: string;
  /** semver jump — colors the chip: major = riskiest. */
  jump: "major" | "minor" | "patch" | "other";
}

/** ```deps: `name 1.2.3 → 2.0.0` (or `->`) per line → upgrade table with semver-jump tones. */
export function parseDeps(src: string): DepUpdate[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 60) return null;
  const out: DepUpdate[] = [];
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+v?(\S+)\s*(?:→|->)\s*v?(\S+)$/);
    if (!m) return null;
    const [a, b] = [m[2], m[3]].map((v) => v.split(".").map((x) => parseInt(x, 10)));
    let jump: DepUpdate["jump"] = "other";
    if (a.length >= 3 && b.length >= 3 && a.every((n) => Number.isFinite(n)) && b.every((n) => Number.isFinite(n))) {
      jump = b[0] !== a[0] ? "major" : b[1] !== a[1] ? "minor" : "patch";
    }
    out.push({ name: m[1], from: m[2], to: m[3], jump });
  }
  return out;
}

// ---------------------------------------------------------------- log

export type LogLevel = "error" | "warn" | "info" | "debug" | "plain";
export interface LogLine {
  level: LogLevel;
  text: string;
}

/** ```log: classify each line by level keyword for coloring + filtering. Always succeeds for a log fence. */
export function parseLog(src: string): LogLine[] | null {
  const lines = src.split("\n");
  if (lines.length === 0 || lines.length > 2000) return null;
  return lines.map((text) => {
    const level: LogLevel = /\b(ERROR|ERR|FATAL|PANIC)\b/i.test(text)
      ? "error"
      : /\b(WARN|WARNING)\b/i.test(text)
        ? "warn"
        : /\b(INFO|NOTICE)\b/i.test(text)
          ? "info"
          : /\b(DEBUG|TRACE|VERBOSE)\b/i.test(text)
            ? "debug"
            : "plain";
    return { level, text };
  });
}

// ---------------------------------------------------------------- graph (DAG)

export interface Dag {
  nodes: string[];
  edges: [number, number][];
  /** topological layer per node (longest path from a root). */
  layers: number[];
}

/** ```graph: `A -> B` edges (one or more per line, chains allowed) → layered DAG. Cycles → null. */
export function parseDag(src: string): Dag | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 40) return null;
  const nodes: string[] = [];
  const idx = new Map<string, number>();
  const id = (name: string) => {
    let i = idx.get(name);
    if (i === undefined) {
      i = nodes.length;
      nodes.push(name);
      idx.set(name, i);
    }
    return i;
  };
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const parts = line.split(/\s*(?:->|→)\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    for (let i = 0; i < parts.length - 1; i++) {
      const [a, b] = [id(parts[i]), id(parts[i + 1])];
      const key = `${a}>${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  if (nodes.length < 2 || nodes.length > 24) return null;
  // Longest-path layering; detects cycles by exceeding node count.
  const layers = new Array<number>(nodes.length).fill(0);
  for (let pass = 0; pass <= nodes.length; pass++) {
    let changed = false;
    for (const [a, b] of edges) {
      if (layers[b] < layers[a] + 1) {
        layers[b] = layers[a] + 1;
        changed = true;
      }
    }
    if (!changed) return { nodes, edges, layers };
  }
  return null; // cycle
}

// ---------------------------------------------------------------- funnel

/** ```funnel: `stage: value` per line, ordered top→bottom. */
export function parseFunnel(src: string): { label: string; value: number }[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 10) return null;
  const out: { label: string; value: number }[] = [];
  for (const line of lines) {
    const m = line.match(/^(.+?):\s*([\d,]+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const value = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(value) || value < 0) return null;
    out.push({ label: m[1].trim(), value });
  }
  return out;
}

// ---------------------------------------------------------------- spans (gantt / waterfall)

export interface Span {
  label: string;
  start: number;
  end: number;
}

/** ```gantt / ```spans: `label | start | end` per line (numbers in any shared unit). */
export function parseSpans(src: string): { spans: Span[]; unit?: string } | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 30) return null;
  let unit: string | undefined;
  const spans: Span[] = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length !== 3) return null;
    const num = (s: string): number | null => {
      const m = s.match(/^([\d,]+(?:\.\d+)?)\s*([a-zµ%]*)$/i);
      if (!m) return null;
      if (m[2]) unit = unit ?? m[2];
      return Number(m[1].replace(/,/g, ""));
    };
    const start = num(parts[1]);
    const end = num(parts[2]);
    if (start === null || end === null || end < start) return null;
    spans.push({ label: parts[0], start, end });
  }
  return { spans, unit };
}

// ---------------------------------------------------------------- heatmap

export interface Heatmap {
  rows: string[];
  cols: string[];
  values: number[][];
  unit?: string;
}

/** ```heatmap: JSON `{rows:[...], cols:[...], values:[[...]], unit?}`. */
export function parseHeatmap(src: string): Heatmap | null {
  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.rows) || !Array.isArray(o.cols) || !Array.isArray(o.values)) return null;
  const rows = o.rows.map(String);
  const cols = o.cols.map(String);
  if (rows.length === 0 || cols.length === 0 || rows.length > 30 || cols.length > 40) return null;
  if (o.values.length !== rows.length) return null;
  const values: number[][] = [];
  for (const r of o.values) {
    if (!Array.isArray(r) || r.length !== cols.length) return null;
    const vals = r.map(Number);
    if (vals.some((n) => !Number.isFinite(n))) return null;
    values.push(vals);
  }
  return { rows, cols, values, unit: typeof o.unit === "string" ? o.unit : undefined };
}

// ---------------------------------------------------------------- callout

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution" | "success" | "error";

/** Map GitHub alert names + our fence aliases onto the console's functional hues. */
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
