/**
 * Live log view — pure parsing and tallying for a command whose output is still streaming
 * (`tail -f access.log`, `kubectl logs -f`, a dev server). docs/output-visualizers.md "Live".
 *
 * Only COMPLETE lines are ever parsed: a line still being written (`GET /api 20`) would otherwise
 * be counted as a wrong status and then counted again once it finishes. The tally is incremental —
 * each feed parses just the lines past what it already consumed — so counters cover everything
 * seen while the rendered rows are capped. Unit-tested in test/viz-live-log.test.ts.
 */

export type LogLevelName = "error" | "warn" | "info" | "debug";

export interface AccessHit {
  method: string;
  path: string;
  status: number;
  /** Latency in ms, only when the line states one (with a unit, or a ms/seconds-named JSON key). */
  ms?: number;
}

export interface LiveRow {
  /** Monotonic line number in the stream — stable React key. */
  seq: number;
  text: string;
  hit?: AccessHit;
  level?: LogLevelName;
}

export type LiveKind = "access" | "levelled";

export interface LiveLogState {
  /** Characters of the source already consumed (always at a line boundary). */
  consumed: number;
  /** The consumed prefix, to detect a rewritten (not appended) source. */
  prefix: string;
  seq: number;
  total: number;
  byClass: { "2xx": number; "3xx": number; "4xx": number; "5xx": number };
  errors: number;
  warns: number;
  latencies: number[];
  rows: LiveRow[];
  /** Lines that were access hits / levelled, over all non-blank lines — for classification. */
  hits: number;
  levelled: number;
  lines: number;
}

export const LIVE_ROW_CAP = 300;

const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE";
// Common / combined log format: `host ident user [date] "GET /p HTTP/1.1" 200 1234 ...`
const CLF_RE = new RegExp(`"(${METHODS}) (\\S+)(?: HTTP/[\\d.]+)?" ([1-5]\\d\\d) (?:\\d+|-)(.*)$`);
// Free-form: `... GET /path 200 12ms`, morgan `GET /api 200 12.345 ms - 13`, `POST /x -> 201 (8ms)`.
const FREE_RE = new RegExp(`\\b(${METHODS})\\s+(\\/\\S*|https?:\\/\\/\\S+)\\s+(?:HTTP\\/[\\d.]+\\s+)?(?:[-=>→:|]+\\s*)?\\(?([1-5]\\d\\d)\\b\\)?(.*)$`);
const DUR_RE = /(?:^|[\s(=:,])(\d+(?:\.\d+)?)\s?(ms|µs|us|s)\b/;
const KV_DUR_RE = /\b(?:rt|request_time|upstream_response_time|duration|latency|took|elapsed)=(\d+(?:\.\d+)?)(ms|µs|us|s)?\b/;
const LOGFMT_RE = /\bmethod="?([A-Z]+)"?.*?\b(?:path|uri|url)="?(\S+?)"?(?:\s|$).*?\bstatus(?:_?code)?="?([1-5]\d\d)\b/;

function toMs(n: number, unit: string | undefined): number | undefined {
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "us" || unit === "µs") return n / 1000;
  return undefined;
}

function durationIn(rest: string): number | undefined {
  const kv = rest.match(KV_DUR_RE);
  if (kv) {
    // nginx `rt=0.012` / `request_time=0.012` is seconds; other bare keys stay unknown.
    const unit = kv[2] ?? (/^(rt|request_time|upstream_response_time)=/.test(kv[0].replace(/^\W*/, "")) ? "s" : undefined);
    const v = toMs(Number(kv[1]), unit);
    if (v !== undefined) return v;
  }
  const m = rest.match(DUR_RE);
  return m ? toMs(Number(m[1]), m[2]) : undefined;
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const parts = k.split(".");
    let v: unknown = o;
    for (const p of parts) v = v && typeof v === "object" ? (v as Record<string, unknown>)[p] : undefined;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const MS_KEYS = ["duration_ms", "durationMs", "latency_ms", "latencyMs", "elapsed_ms", "took_ms", "response_time_ms", "responseTime", "res.responseTime", "ms", "time_ms"];
const S_KEYS = ["duration_s", "latency_s", "request_time", "elapsed_s", "duration_seconds"];
const ANY_KEYS = ["duration", "latency", "elapsed", "took", "response_time", "time"];

function jsonDuration(o: Record<string, unknown>): number | undefined {
  const ms = pick(o, MS_KEYS);
  if (typeof ms === "number") return toMs(ms, "ms");
  const s = pick(o, S_KEYS);
  if (typeof s === "number") return toMs(s, "s");
  const any = pick(o, [...MS_KEYS, ...S_KEYS, ...ANY_KEYS]);
  // A unit-less number under a generic key ("duration": 12) is ambiguous — ns? s? ms? Don't guess.
  if (typeof any === "string") {
    const m = any.trim().match(/^(\d+(?:\.\d+)?)\s?(ms|µs|us|s)$/);
    if (m) return toMs(Number(m[1]), m[2]);
  }
  return undefined;
}

function jsonObject(line: string): Record<string, unknown> | null {
  const t = line.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  try {
    const v: unknown = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One HTTP access-log line → method, path, status and (when stated) latency; else null. */
export function parseAccessLine(line: string): AccessHit | null {
  const obj = jsonObject(line);
  if (obj) {
    const method = pick(obj, ["method", "req.method", "request.method", "http.method", "httpRequest.requestMethod"]);
    const path = pick(obj, ["path", "url", "uri", "req.url", "request.url", "request.path", "http.path", "http.url", "httpRequest.requestUrl"]);
    const status = Number(pick(obj, ["status", "statusCode", "status_code", "res.statusCode", "response.status", "http.status_code", "httpRequest.status"]));
    if (typeof method !== "string" || typeof path !== "string" || !Number.isInteger(status) || status < 100 || status > 599) return null;
    const hit: AccessHit = { method: method.toUpperCase(), path, status };
    const ms = jsonDuration(obj);
    if (ms !== undefined) hit.ms = ms;
    return hit;
  }
  const m = line.match(CLF_RE) ?? line.match(FREE_RE);
  if (m) {
    const hit: AccessHit = { method: m[1], path: m[2], status: Number(m[3]) };
    const ms = durationIn(m[4] ?? "");
    if (ms !== undefined) hit.ms = ms;
    return hit;
  }
  const kv = line.match(LOGFMT_RE);
  if (kv) {
    const hit: AccessHit = { method: kv[1], path: kv[2], status: Number(kv[3]) };
    const ms = durationIn(line);
    if (ms !== undefined) hit.ms = ms;
    return hit;
  }
  return null;
}

const LEVEL_RE = /(?:^|[\s[(|:])(FATAL|PANIC|CRIT(?:ICAL)?|ERROR|ERR|WARN(?:ING)?|INFO|NOTICE|DEBUG|TRACE)(?=[\s\]):|]|$)/i;

/** The level a log line states — a level word near the start, or a JSON `level`/`severity`. */
export function parseLevel(line: string): LogLevelName | null {
  const obj = jsonObject(line);
  let word: string | undefined;
  if (obj) {
    const v = pick(obj, ["level", "severity", "lvl", "log.level"]);
    if (typeof v === "number") return v >= 50 ? "error" : v >= 40 ? "warn" : v >= 30 ? "info" : "debug"; // pino/bunyan
    if (typeof v === "string") word = v;
  } else {
    word = line.slice(0, 80).match(LEVEL_RE)?.[1];
  }
  if (!word) return null;
  const w = word.toUpperCase();
  if (/^(FATAL|PANIC|CRIT|CRITICAL|ERROR|ERR|ALERT|EMERG)/.test(w)) return "error";
  if (w.startsWith("WARN")) return "warn";
  if (w === "INFO" || w === "NOTICE") return "info";
  if (w === "DEBUG" || w === "TRACE") return "debug";
  return null;
}

export function createLiveLog(): LiveLogState {
  return {
    consumed: 0,
    prefix: "",
    seq: 0,
    total: 0,
    byClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
    errors: 0,
    warns: 0,
    latencies: [],
    rows: [],
    hits: 0,
    levelled: 0,
    lines: 0,
  };
}

/**
 * Feed the whole output so far. Parses only complete lines past `state.consumed` (all of it when
 * `final`), and returns a new state — or the same one when nothing new completed. A source that
 * was rewritten rather than appended to (a different tail window) starts a fresh tally.
 */
export function feedLiveLog(state: LiveLogState, text: string, { final = false } = {}): LiveLogState {
  let s = state;
  if (s.consumed > text.length || !text.startsWith(s.prefix)) s = createLiveLog();
  const end = final ? text.length : text.lastIndexOf("\n") + 1;
  if (end <= s.consumed) return s;
  const chunk = text.slice(s.consumed, end);
  const next: LiveLogState = {
    ...s,
    byClass: { ...s.byClass },
    latencies: s.latencies.slice(),
    rows: s.rows.slice(),
    consumed: end,
    prefix: text.slice(0, end),
  };
  for (const raw of chunk.replace(/\n$/, "").split("\n")) {
    const text = raw.replace(/\r$/, "");
    if (!text.trim()) continue;
    next.lines++;
    const hit = parseAccessLine(text) ?? undefined;
    const level = parseLevel(text) ?? undefined;
    const row: LiveRow = { seq: next.seq++, text };
    if (hit) {
      row.hit = hit;
      next.hits++;
      next.total++;
      const cls = `${Math.floor(hit.status / 100)}xx` as keyof LiveLogState["byClass"];
      if (cls in next.byClass) next.byClass[cls]++;
      if (hit.ms !== undefined) next.latencies.push(hit.ms);
    }
    if (level) {
      row.level = level;
      next.levelled++;
      if (level === "error") next.errors++;
      if (level === "warn") next.warns++;
    }
    next.rows.push(row);
  }
  if (next.rows.length > LIVE_ROW_CAP) next.rows.splice(0, next.rows.length - LIVE_ROW_CAP);
  return next;
}

/**
 * What the stream looks like so far: "access" when most lines are HTTP requests, "levelled" when
 * most carry a log level, else null. Needs two lines — one line is not a shape.
 */
export function liveKind(s: LiveLogState): LiveKind | null {
  if (s.lines < 2) return null;
  if (s.hits >= 2 && s.hits / s.lines >= 0.5) return "access";
  if (s.levelled >= 2 && s.levelled / s.lines >= 0.6) return "levelled";
  return null;
}

/** Nearest-rank p95 of the latencies seen, or null when none parsed. */
export function p95(latencies: readonly number[]): number | null {
  if (!latencies.length) return null;
  const sorted = latencies.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 10) return `${Math.round(ms)}ms`;
  return `${ms.toFixed(1)}ms`;
}

/** Cheap whole-text check: is this output a log stream the live view should draw? */
export function looksLikeLiveLog(text: string | undefined, { final = false } = {}): boolean {
  if (!text) return false;
  return liveKind(feedLiveLog(createLiveLog(), text, { final })) !== null;
}
