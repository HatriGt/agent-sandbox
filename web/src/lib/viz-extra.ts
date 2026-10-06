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
  /** Sub-steps / notes under the step, one per line. */
  detail?: string;
  /** `plain` = a walkthrough with no status marks anywhere (a procedure, not a to-do list). */
  state: "done" | "active" | "todo" | "fail" | "plain";
}

const SUB_STEP_RE = /^\s{2,}(?:[-•*]|[a-z]\)|[ivx]+\.|\d+[.)])\s+(.*)$/i;

/**
 * ```steps: numbered lines (`1. Install deps ✓`), optional indented detail lines under each.
 * ✓ = done, ✗ = failed, … = active; unmarked steps are upcoming — unless NO step carries a mark,
 * in which case the list is a procedure and every step is `plain`. Indented `- sub` / `a) sub` /
 * `i. sub` lines become one detail line each; other indented text continues the previous line.
 */
export function parseSteps(src: string): Step[] | null {
  const lines = src.split("\n").filter((l) => l.trim());
  if (lines.length === 0 || lines.length > 60) return null;
  const out: Step[] = [];
  let marked = false;
  for (const raw of lines) {
    const m = raw.match(/^(\d+)[.)]\s+(.*)$/);
    if (m) {
      let title = m[2].trim();
      let state: Step["state"] = "todo";
      if (/[✓✔]$/.test(title)) (state = "done"), (title = title.replace(/\s*[✓✔]$/, ""));
      else if (/[✗✘]$/.test(title)) (state = "fail"), (title = title.replace(/\s*[✗✘]$/, ""));
      else if (/(\.\.\.|…)$/.test(title)) (state = "active"), (title = title.replace(/\s*(\.\.\.|…)$/, ""));
      if (state !== "todo") marked = true;
      out.push({ title, state });
    } else if (/^\s+\S/.test(raw) && out.length) {
      const prev = out[out.length - 1];
      const sub = raw.match(SUB_STEP_RE);
      if (sub) prev.detail = (prev.detail ? prev.detail + "\n" : "") + sub[1].trim();
      else prev.detail = (prev.detail ? prev.detail + " " : "") + raw.trim();
    } else return null;
  }
  if (out.length < 2) return null;
  if (!marked) for (const s of out) s.state = "plain";
  return out;
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
  recurring: "warn", present: "warn", rising: "warn", increasing: "warn", elevated: "warn",
};

const OK_WORDS = new Set(["none", "zero", "0", "clear", "clean", "ok", "healthy", "resolved"]);

/**
 * ```badges: `label: state` per line → status chip row; tone inferred from the state word — and
 * from the LABEL when it names trouble: `errors: recurring` must read as a warning even though
 * "recurring" alone is neutral, while `errors: none` stays green.
 */
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

export type DagKind = "step" | "decision" | "terminal";

export interface Dag {
  nodes: string[];
  edges: [number, number][];
  /** topological layer per node (longest path from a root). */
  layers: number[];
  /** Edge labels (`A -> B: yes`, `A -|yes|-> B`), parallel to `edges`; absent when no edge has one. */
  labels?: (string | undefined)[];
  /** Node shapes (`{Decision?}`, `[Step]`, `(Start)` / `((End))`), parallel to `nodes`; absent when none is shaped. */
  kinds?: DagKind[];
}

/** Strip a flowchart shape from a node name: `{X}` decision, `[X]` step, `(X)` / `((X))` terminal. */
function shapedNode(raw: string): { name: string; kind?: DagKind } {
  const m = raw.match(/^(?:\{(.+)\}|\[(.+)\]|\(\((.+)\)\)|\((.+)\))$/);
  if (!m) return { name: raw };
  if (m[1] !== undefined) return { name: m[1].trim(), kind: "decision" };
  if (m[2] !== undefined) return { name: m[2].trim(), kind: "step" };
  return { name: (m[3] ?? m[4]).trim(), kind: "terminal" };
}

/**
 * Layer named edges into a {@link Dag}: dedupes nodes by name and edges by pair, longest-path
 * layering. Null on < 2 or > 24 nodes, or a cycle. Shared by ```graph and mermaid flowcharts.
 */
export function dagFromEdges(edges: [string, string][], labels: (string | undefined)[] = [], kinds: Record<string, DagKind> = {}): Dag | null {
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
  const out: [number, number][] = [];
  const outLabels: (string | undefined)[] = [];
  const seen = new Map<string, number>();
  edges.forEach(([from, to], k) => {
    const [a, b] = [id(from), id(to)];
    const key = `${a}>${b}`;
    const at = seen.get(key);
    if (at === undefined) {
      seen.set(key, out.length);
      out.push([a, b]);
      outLabels.push(labels[k]);
    } else if (labels[k] && !outLabels[at]) outLabels[at] = labels[k];
  });
  if (nodes.length < 2 || nodes.length > 24) return null;
  // Longest-path layering; detects cycles by exceeding node count.
  const layers = new Array<number>(nodes.length).fill(0);
  for (let pass = 0; pass <= nodes.length; pass++) {
    let changed = false;
    for (const [a, b] of out) {
      if (layers[b] < layers[a] + 1) {
        layers[b] = layers[a] + 1;
        changed = true;
      }
    }
    if (!changed) {
      const dag: Dag = { nodes, edges: out, layers };
      if (outLabels.some(Boolean)) dag.labels = outLabels;
      const shaped = nodes.map((n) => kinds[n]);
      if (shaped.some(Boolean)) dag.kinds = shaped.map((k) => k ?? "step");
      return dag;
    }
  }
  return null; // cycle
}

/**
 * ```graph: `A -> B` edges (one or more per line, chains allowed) → layered DAG. Cycles → null.
 * Edge labels: `A -> B: yes` or `A -|yes|-> B`. Node shapes: `{Decision?}`, `[Step]`, `(Start)`, `((End))`.
 */
export function parseDag(src: string): Dag | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 40) return null;
  const edges: [string, string][] = [];
  const labels: (string | undefined)[] = [];
  const kinds: Record<string, DagKind> = {};
  const node = (raw: string): string => {
    const { name, kind } = shapedNode(raw);
    if (kind) kinds[name] = kind;
    return name;
  };
  for (const line of lines) {
    // Tokens alternate node, arrow, node, arrow… — the arrow may carry `-|label|->`.
    const parts = line.split(/\s*(->|→|-\|[^|]*\|->)\s*/).map((p) => p.trim());
    if (parts.length < 3 || parts.length % 2 === 0 || !parts[0]) return null;
    let from = node(parts[0]);
    for (let i = 1; i < parts.length; i += 2) {
      const arrow = parts[i];
      let target = parts[i + 1];
      if (!target) return null;
      let label = arrow.length > 2 ? arrow.slice(2, -3).trim() || undefined : undefined;
      const colon = target.match(/^(.*\S):\s+(.+)$/);
      if (colon && !label) (target = colon[1]), (label = colon[2].trim());
      const to = node(target);
      edges.push([from, to]);
      labels.push(label);
      from = to;
    }
  }
  return dagFromEdges(edges, labels, kinds);
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

// ---------------------------------------------------------------- sequence

export type SequenceItem =
  | { kind: "msg"; from: number; to: number; text: string; reply: boolean }
  | { kind: "note"; actor: number; text: string }
  /** A `loop` / `alt` / `opt` / `else` section spanning items[start..end] (inclusive). */
  | { kind: "block"; label: string; start: number; end: number };

export interface Sequence {
  actors: string[];
  items: SequenceItem[];
}

const SEQ_MAX_ACTORS = 8;
const SEQ_MAX_MSGS = 40;

/**
 * ```sequence (also mermaid `sequenceDiagram`): `Caller -> Callee: message` per line (`->>`,
 * `-->>`, `-->` accepted; dashed = reply). Optional `participant X [as Y]`, `note over X: text`
 * / `note right of X: text`, and `loop label` / `alt label` / `else label` / `opt label` … `end`
 * blocks. Null when any line is not one of these, or on > 8 actors / > 40 messages.
 */
export function parseSequence(src: string): Sequence | null {
  const lines = src.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
  if (lines.length === 0 || lines.length > 120) return null;
  const actors: string[] = [];
  const idx = new Map<string, number>();
  const actor = (raw: string): number => {
    const name = raw.trim();
    let i = idx.get(name);
    if (i === undefined) {
      i = actors.length;
      actors.push(name);
      idx.set(name, i);
    }
    return i;
  };
  const items: SequenceItem[] = [];
  const open: { label: string; start: number }[] = [];
  let msgs = 0;
  for (const [n, line] of lines.entries()) {
    if (n === 0 && /^sequenceDiagram$/i.test(line)) continue;
    if (/^(autonumber|activate|deactivate|title|accTitle|accDescr)\b/i.test(line)) continue;
    let m = line.match(/^participant\s+(\S+)(?:\s+as\s+(.+))?$/i) ?? line.match(/^actor\s+(\S+)(?:\s+as\s+(.+))?$/i);
    if (m) {
      actor(m[2] ?? m[1]);
      if (m[2]) idx.set(m[1], idx.get(m[2])!);
      continue;
    }
    m = line.match(/^note\s+(?:over|(?:right|left)\s+of)\s+([^:,]+?)(?:\s*,\s*[^:]+)?\s*:\s*(.+)$/i);
    if (m) {
      items.push({ kind: "note", actor: actor(m[1]), text: m[2].trim() });
      continue;
    }
    m = line.match(/^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i);
    if (m) {
      open.push({ label: m[2].trim() || m[1].toLowerCase(), start: items.length });
      continue;
    }
    m = line.match(/^(else|and)\b\s*(.*)$/i);
    if (m) {
      const cur = open.pop();
      if (!cur) return null;
      if (cur.start < items.length) items.push({ kind: "block", label: cur.label, start: cur.start, end: items.length - 1 });
      open.push({ label: m[2].trim() || m[1].toLowerCase(), start: items.length });
      continue;
    }
    if (/^end$/i.test(line)) {
      const cur = open.pop();
      if (!cur) return null;
      if (cur.start < items.length) items.push({ kind: "block", label: cur.label, start: cur.start, end: items.length - 1 });
      continue;
    }
    m = line.match(/^(.+?)\s*(-->>|->>|-->|->|—>|→|-x|--x|-\)|--\))\s*(.+?)\s*:\s*(.+)$/);
    if (!m) return null;
    const [, from, arrow, to, text] = m;
    if (++msgs > SEQ_MAX_MSGS) return null;
    items.push({ kind: "msg", from: actor(from), to: actor(to), text: text.trim(), reply: arrow.startsWith("--") });
    if (actors.length > SEQ_MAX_ACTORS) return null;
  }
  if (open.length || msgs === 0 || actors.length < 2) return null;
  return { actors, items };
}

// ---------------------------------------------------------------- findings

export type Severity = "high" | "medium" | "low" | "info";

export interface Finding {
  severity: Severity;
  where?: string;
  text: string;
}

const SEVERITY_WORDS: Record<string, Severity> = {
  critical: "high", blocker: "high", high: "high", severe: "high", major: "high", error: "high",
  medium: "medium", moderate: "medium", warn: "medium", warning: "medium",
  low: "low", minor: "low", nit: "low", trivial: "low",
  info: "info", note: "info", informational: "info", suggestion: "info",
};

/** The severity a word like `High`, `[critical]`, `P1`-less "warn" names, or null. */
export function severityOf(word: string): Severity | null {
  return SEVERITY_WORDS[word.trim().toLowerCase().replace(/^\[|\]$/g, "")] ?? null;
}

export const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/**
 * ```findings (aliases `issues`, `risks`): one per line — `severity | where | what`,
 * `[severity] where — what`, or `severity: what`. Null when any line lacks a severity word.
 */
export function parseFindings(src: string): Finding[] | null {
  const lines = src.split("\n").map((l) => l.trim().replace(/^[-*•]\s+/, "")).filter(Boolean);
  if (lines.length === 0 || lines.length > 40) return null;
  const out: Finding[] = [];
  for (const line of lines) {
    let f: Finding | null = null;
    if (line.includes("|")) {
      const parts = line.split("|").map((p) => p.trim());
      const severity = severityOf(parts[0]);
      if (!severity || parts.length < 2) return null;
      const where = parts.length >= 3 ? parts[1] : undefined;
      const text = parts.slice(parts.length >= 3 ? 2 : 1).filter(Boolean).join(" — ");
      f = { severity, where: where || undefined, text };
    } else {
      const bracket = line.match(/^\[([^\]]+)\]\s*(.+?)\s+[—–-]\s+(.+)$/) ?? line.match(/^\[([^\]]+)\]\s*(.+?)\s*:\s+(.+)$/);
      const colon = bracket ? null : line.match(/^([A-Za-z]+)\s*[:\-–—]\s*(.+)$/);
      const m = bracket ?? colon;
      const severity = m ? severityOf(m[1]) : null;
      if (!m || !severity) return null;
      f = bracket ? { severity, where: bracket[2].trim(), text: bracket[3].trim() } : { severity, text: m[2].trim() };
    }
    if (!f.text) return null;
    out.push(f);
  }
  return out;
}

/** Stable severity-descending order for rendering. */
export function sortFindings(items: Finding[]): Finding[] {
  return items.map((f, i) => [f, i] as const).sort((a, b) => SEVERITY_RANK[a[0].severity] - SEVERITY_RANK[b[0].severity] || a[1] - b[1]).map(([f]) => f);
}

// ---------------------------------------------------------------- compare

export type CompareTone = "pro" | "con" | "note";
export interface CompareOption {
  name: string;
  picked: boolean;
  items: { tone: CompareTone; text: string }[];
}

const PICK_RE = /\s*(?:\((?:recommended|pick|chosen)\)|★)\s*/gi;

/**
 * ```compare: `## Name` starts an option (`(recommended)` or `★` marks the pick), then `+ pro`,
 * `- con`, `~ note` or a plain line (neutral note). 2–6 options, at most one pick; text before the
 * first heading, an empty option name, or more than 20 lines in one option → null.
 */
export function parseCompare(src: string): CompareOption[] | null {
  const lines = src.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 120) return null;
  const out: CompareOption[] = [];
  for (const line of lines) {
    const head = line.match(/^##\s+(.+)$/);
    if (head) {
      const picked = /\((?:recommended|pick|chosen)\)|★/i.test(head[1]);
      const name = head[1].replace(PICK_RE, " ").trim();
      if (!name || name.length > 60) return null;
      out.push({ name, picked, items: [] });
      continue;
    }
    const cur = out[out.length - 1];
    if (!cur || cur.items.length >= 20) return null;
    const m = line.match(/^([+\-~•*])\s*(.*)$/);
    const mark = m?.[1];
    const text = (m ? m[2] : line).trim();
    if (!text) continue;
    cur.items.push({ tone: mark === "+" ? "pro" : mark === "-" ? "con" : "note", text });
  }
  if (out.length < 2 || out.length > 6 || out.filter((o) => o.picked).length > 1) return null;
  return out;
}

// ---------------------------------------------------------------- annotate

export interface AnnotateNote {
  /** Inclusive line range in the displayed numbering (file numbering when a start line was given). */
  from: number;
  to: number;
  text: string;
}
export interface Annotated {
  file?: string;
  /** Number of the snippet's first line (1 without a `file: path:N` header). */
  startLine: number;
  code: string;
  notes: AnnotateNote[];
}

const NOTE_RE = /^L?(\d{1,6})(?:\s*[-–]\s*L?(\d{1,6}))?\s*:\s*(.+)$/i;

/**
 * ```annotate: optional `file: path/to/x.ts:40` first line, the code, a `---` line, then notes
 * `L42: why` / `42-45: why`. The LAST `---` splits (code may hold its own). Notes whose start lies
 * outside the snippet are dropped, ends clamp; no `---`, no code, a non-note line after the split,
 * or no surviving note → null.
 */
export function parseAnnotate(src: string): Annotated | null {
  const lines = src.replace(/\r/g, "").split("\n");
  let sep = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim() === "---") (sep = i), i = -1;
  if (sep < 0) return null;
  let body = lines.slice(0, sep);
  let file: string | undefined;
  let startLine = 1;
  const header = body[0]?.match(/^\s*file:\s*(\S+?)(?::(\d{1,6}))?\s*$/i);
  if (header) {
    file = header[1];
    if (header[2]) startLine = Math.max(1, Number(header[2]));
    body = body.slice(1);
  }
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  if (body.length === 0 || body.length > 200) return null;
  const last = startLine + body.length - 1;
  const notes: AnnotateNote[] = [];
  for (const raw of lines.slice(sep + 1)) {
    const line = raw.trim().replace(/^[-*•]\s+/, "");
    if (!line) continue;
    const m = line.match(NOTE_RE);
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (to < from || from < startLine || from > last) continue;
    notes.push({ from, to: Math.min(to, last), text: m[3].trim() });
  }
  if (notes.length === 0 || notes.length > 30) return null;
  return { file, startLine, code: body.join("\n"), notes };
}

// ---------------------------------------------------------------- layers

export interface Layer {
  name: string;
  items: string[];
}

/** ```layers: `Layer name: item, item` per line, top → bottom. 2–10 layers, ≤ 16 items each. */
export function parseLayers(src: string): Layer[] | null {
  const lines = src.split("\n").map((l) => l.trim().replace(/^[-*•]\s+/, "")).filter(Boolean);
  if (lines.length < 2 || lines.length > 10) return null;
  const out: Layer[] = [];
  for (const line of lines) {
    const m = line.match(/^([^:]{1,40}?)\s*:(?:\s+(.*))?$/);
    if (!m || !m[1].trim()) return null;
    const items = (m[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (items.length > 16) return null;
    out.push({ name: m[1].trim(), items });
  }
  return out;
}
