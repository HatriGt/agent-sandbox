/**
 * Code mode, what comes back: unwrapping an upstream MCP result into a plain value, cutting values
 * to size without breaking their JSON, summarising a value's shape (never its contents) and writing
 * the text a `run` returns to the model. Pure; shipped into the box next to server.js.
 */

/**
 * Return value shown to the model and console output. Upstream results are NOT capped for the
 * script: it sees each result whole (the bench, docs/plan-code-mode.md section 7.1, measured a 24k
 * in-script cut making the first script of a big-result task wrong). UPSTREAM_MAX only bounds
 * memory: the sandbox child has a 256 MB heap and up to 8 results in flight, so a result over 8M
 * chars (the recall limit too) reaches the script as a cut copy and is not kept for recall.
 */
export const RETURN_CAP = 20_000;
export const CONSOLE_CAP = 4_000;
export const UPSTREAM_MAX = 8_000_000;
export const TRUNCATED = "--- TRUNCATED ---";

interface McpContent {
  type?: string;
  text?: string;
  mimeType?: string;
  data?: string;
  resource?: { uri?: string; text?: string; mimeType?: string };
}
export interface McpResult {
  isError?: boolean;
  structuredContent?: unknown;
  content?: McpContent[];
  toolResult?: unknown;
}

/**
 * An upstream result as a script value, the way Cloudflare's mcp.ts does it: an error result
 * throws its text; `structuredContent` wins when present; text that is JSON becomes the value; other
 * text stays text. Binary parts become a placeholder: their bytes help nobody inside a script and
 * would only inflate every size the model sees.
 */
export function unwrapResult(r: McpResult): unknown {
  const parts = Array.isArray(r.content) ? r.content : [];
  const text = parts.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("\n");
  if (r.isError) throw new Error(text || "the tool reported an error without a message");
  if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent;
  if (r.toolResult !== undefined) return r.toolResult;
  if (parts.every((p) => p?.type === "text")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return parts.map((p) =>
    p?.type === "text"
      ? p.text
      : p?.type === "resource"
        ? { resource: p.resource?.uri, text: p.resource?.text }
        : { [p?.type ?? "content"]: p?.mimeType ?? "binary", chars: String(p?.data ?? "").length }
  );
}

/** JSON text of a value; `undefined` (and a value JSON cannot express) reads as null. */
export function toJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "null";
  } catch {
    return JSON.stringify(String(v));
  }
}

interface Limits {
  str: number;
  arr: number;
  keys: number;
  note: string;
}

/** A copy with strings cut to `str` chars, arrays to `arr` items and objects to `keys` keys. */
function shrink(v: unknown, l: Limits, depth = 0): unknown {
  if (typeof v === "string") return v.length > l.str ? `${v.slice(0, l.str)}…[${v.length - l.str} more chars]` : v;
  if (!v || typeof v !== "object") return v;
  if (depth > 40) return "[nested too deep]";
  if (Array.isArray(v)) {
    const out = v.slice(0, l.arr).map((x) => shrink(x, l, depth + 1));
    if (v.length > l.arr) out.push(`${TRUNCATED} ${v.length - l.arr} more items${l.note}`);
    return out;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [k, x] of entries.slice(0, l.keys)) out[k] = shrink(x, l, depth + 1);
  if (entries.length > l.keys) out[TRUNCATED] = `${entries.length - l.keys} more keys${l.note}`;
  return out;
}

/** The fewest chars a cut child is worth showing at; below it the tail is dropped instead. */
const MIN_SHARE = 48;

/**
 * Water-fill (Cloudflare's truncate.ts does the same): a value cut to `budget` chars by giving each
 * child an equal share, where a child that needs less hands the rest to the others, so one huge
 * text field or one long list no longer starves its siblings. Too many children for the budget and
 * the tail is dropped with a marker. Every cut is marked in the data itself.
 */
function fit(v: unknown, budget: number, note: string, depth = 0): unknown {
  const full = toJson(v);
  if (full.length <= budget) return v;
  if (typeof v === "string") {
    const keep = Math.max(0, budget - 40 - String(v.length).length);
    return `${v.slice(0, keep)}…[${v.length - keep} more chars]`;
  }
  if (!v || typeof v !== "object" || depth > 40) return v;
  const isArr = Array.isArray(v);
  const entries = isArr ? (v as unknown[]).map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>);
  const marker = (n: number) => (isArr ? `${TRUNCATED} ${n} more items${note}` : `${n} more keys${note}`);
  // The chars each child costs beyond its value: a comma, and for an object its quoted key and colon.
  const fixed = (k: string) => 1 + (isArr ? 0 : toJson(k).length + 1);
  // How many children fit at all: at least MIN_SHARE each (or whole when smaller).
  let keep = entries.length;
  const markerCost = marker(0).length + 24 + (isArr ? 0 : TRUNCATED.length + 3);
  let avail = budget - 2;
  for (;;) {
    const need = entries.slice(0, keep).reduce((n, [k, x]) => n + fixed(k) + Math.min(MIN_SHARE, toJson(x).length), 0) + (keep < entries.length ? markerCost : 0);
    if (need <= avail || keep <= 1) break;
    keep = Math.min(keep - 1, Math.floor((keep * avail) / need));
  }
  const kept = entries.slice(0, keep);
  if (keep < entries.length) avail -= markerCost;
  avail -= kept.reduce((n, [k]) => n + fixed(k), 0);
  // Water-fill the value budget over the kept children, smallest first.
  const sizes = kept.map(([, x]) => toJson(x).length);
  const share = new Map<number, number>();
  const order = kept.map((_, i) => i).sort((a, b) => sizes[a] - sizes[b]);
  let left = Math.max(0, avail);
  order.forEach((i, pos) => {
    const s = Math.min(sizes[i], Math.floor(left / (order.length - pos)));
    share.set(i, s);
    left -= s;
  });
  const out = kept.map(([, x], i) => (sizes[i] <= share.get(i)! ? x : fit(x, share.get(i)!, note, depth + 1)));
  if (isArr) {
    if (keep < entries.length) out.push(marker(entries.length - keep));
    return out;
  }
  const obj: Record<string, unknown> = {};
  kept.forEach(([k], i) => (obj[k] = out[i]));
  if (keep < entries.length) obj[TRUNCATED] = marker(entries.length - keep);
  return obj;
}

/**
 * The value as JSON text of at most `max` chars, cut so it is still valid JSON, by water-filling
 * the budget over the value's children (fit) and, should that still overshoot, by the older
 * strings-then-tails-then-keys shrink. Only a value that still does not fit becomes plain cut text.
 */
export function capValue(v: unknown, max: number, note = ""): { text: string; cut: boolean } {
  const full = toJson(v);
  if (full.length <= max) return { text: full, cut: false };
  const flat = (s: string) => ({ text: toJson(`${s.slice(0, Math.max(0, max - 120 - note.length))}…${TRUNCATED}${note}`), cut: true });
  if (typeof v === "string") return flat(v);
  for (const factor of [1, 0.9, 0.75]) {
    const text = toJson(fit(v, Math.floor(max * factor), note));
    if (text.length <= max) return { text, cut: true };
  }
  const l: Limits = { str: 2000, arr: 1000, keys: 200, note };
  for (let i = 0; i < 60; i++) {
    const text = toJson(shrink(v, l));
    if (text.length <= max) return { text, cut: true };
    if (l.str > 200) l.str = Math.floor(l.str / 2);
    else if (l.arr > 1) l.arr = Math.max(1, Math.floor(l.arr / 2));
    else if (l.str > 20) l.str = Math.floor(l.str / 2);
    else if (l.keys > 5) l.keys = Math.max(5, Math.floor(l.keys / 2));
    else break;
  }
  return flat(full);
}

/** A key that is data rather than a field name: ids, numbers, emails, uuids, anything with spaces. */
export function isDataKey(k: string): boolean {
  return (
    !/^[A-Za-z_$][\w$.-]{0,39}$/.test(k) ||
    /^[0-9a-f]{8,}$/i.test(k) ||
    /^[A-Za-z]{1,8}[-_]?\d{2,}$/.test(k) ||
    /^(?=.*\d)[A-Z0-9]{8,}$/.test(k) ||
    /\d{4,}/.test(k)
  );
}

const SHAPE_KEYS = 16;

/**
 * The shape of a value: keys and array lengths, never values. `{messages: [312 × {ts, text, user,
 * …+5}], next_cursor}`. An object whose keys are mostly data (a map from id to record) shows a count
 * instead of the keys, so ids and emails never reach the model through a summary line. Key names
 * that are not plain identifiers count as data too — a result controls its key names, and a
 * summary line must not become a way to put text in front of the model.
 */
export function shapeOf(v: unknown, depth = 0): string {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    const objs = v.slice(0, 20);
    const inner = objs.every((x) => x && typeof x === "object" && !Array.isArray(x))
      ? shapeOf(Object.assign({}, ...objs), depth + 1)
      : shapeOf(v[0], depth + 1);
    return `[${v.length} × ${inner}]`;
  }
  if (typeof v !== "object") return typeof v;
  const keys = Object.keys(v as object);
  if (!keys.length) return "{}";
  if (depth >= 4) return `{${keys.length} keys}`;
  const data = keys.filter(isDataKey).length;
  if (data * 2 > keys.length) return `{${keys.length} keys: ${shapeOf((v as Record<string, unknown>)[keys[0]], depth + 1)}}`;
  const named = keys.filter((k) => !isDataKey(k));
  const shown = named.slice(0, SHAPE_KEYS).map((k) => {
    const x = (v as Record<string, unknown>)[k];
    return x && typeof x === "object" ? `${k}: ${shapeOf(x, depth + 1)}` : k;
  });
  const more = keys.length - shown.length;
  return `{${shown.join(", ")}${more ? `, …+${more}` : ""}}`;
}

const PREVIEW_SHORT = 100;
const PREVIEW_SAMPLE = 40;
const PREVIEW_MAX = 220;

/**
 * A glimpse of a result for its summary line, so the model need not recall a value to learn how a
 * field is spelt or what a status looks like: a value of PREVIEW_SHORT chars or less whole, else one
 * sample value per top-level field (the first item's for a list), each cut to PREVIEW_SAMPLE chars.
 */
export function previewOf(v: unknown): string {
  const full = toJson(v);
  if (full.length <= PREVIEW_SHORT) return full;
  const sample = (x: unknown): string => {
    if (x && typeof x === "object") {
      if (Array.isArray(x)) return x.length ? `[${x.length} × ${sample(x[0])}]` : "[]";
      const keys = Object.keys(x);
      return keys.length ? `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}` : "{}";
    }
    const s = toJson(x);
    return s.length > PREVIEW_SAMPLE ? `${s.slice(0, PREVIEW_SAMPLE - 1)}…` : s;
  };
  let out: string;
  if (Array.isArray(v)) {
    const first = v[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const parts = Object.entries(first as Record<string, unknown>).slice(0, 8).map(([k, x]) => `${k}: ${sample(x)}`);
      out = `[${v.length} × {${parts.join(", ")}}]`;
    } else out = `[${v.length} × ${sample(first)}]`;
  } else if (v && typeof v === "object") {
    const parts = Object.entries(v as Record<string, unknown>).slice(0, 8).map(([k, x]) => `${k}: ${sample(x)}`);
    out = `{${parts.join(", ")}}`;
  } else out = sample(v);
  return out.length > PREVIEW_MAX ? `${out.slice(0, PREVIEW_MAX - 1)}…` : out;
}

/** 312 → "312", 181_402 → "181k", 2_400_000 → "2.4M": sizes in the summary are chars. */
export function size(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** One MCP call a script made, as the summary reports it. */
export interface CallLine {
  n: number;
  name: string;
  /**
   * "ok": replied; "failed": threw; "unfinished": no reply before the script ended or was stopped;
   * "paused": the call waits for the operator's approval (the run stopped here, resume continues it).
   */
  state: "ok" | "failed" | "unfinished" | "paused";
  chars?: number;
  /** Set when the result was over UPSTREAM_MAX and the script saw a cut copy. */
  cut?: boolean;
  shape?: string;
  /** previewOf the result: the whole value when short, else one sample per field. */
  preview?: string;
  /** A replayed call: answered from the record of the run that paused, no new call made. */
  replayed?: boolean;
  error?: string;
  /** Argument JSON length, the "out" side of the call. */
  sent: number;
}

export interface RunOutcome {
  /** JSON text of the returned value, or undefined when the script returned nothing. */
  value?: string;
  /** Object fields that were undefined in the returned value (dropped from its JSON), with counts. */
  undef?: Record<string, number>;
  /** Why the script failed (thrown error, refusal, timeout). */
  error?: string;
  logs: string[];
  droppedLogChars: number;
  calls: CallLine[];
}

/**
 * The text a `run` returns, in a fixed order the prompt can rely on: the value (or the error), the
 * console, then one line per MCP call with its size and shape, and how to get a result again.
 */
export function formatRun(o: RunOutcome): string {
  const out: string[] = [];
  // The child already names a thrown error ("Error: x", "TypeError: y"); do not double the generic name.
  if (o.error) out.push(o.error.startsWith("Error: ") ? o.error : `Error: ${o.error}`);
  else if (o.value === undefined) out.push("(the script returned nothing; `return` the value you need)");
  else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(o.value);
    } catch {
      parsed = o.value;
    }
    const v = capValue(parsed, RETURN_CAP);
    out.push(v.cut ? `${v.text}\n${TRUNCATED} the returned value was ${size(o.value.length)} chars; return less (filter, pick fields, count) or use saveFile` : v.text);
    const undef = Object.entries(o.undef ?? {}).sort((a, b) => b[1] - a[1]);
    if (undef.length) {
      const list = undef.slice(0, 8).map(([k, n]) => `${JSON.stringify(k.slice(0, 60))} ×${n}`).join(", ");
      out.push(`(undefined, so left out of the value above: ${list}${undef.length > 8 ? `, +${undef.length - 8} more` : ""}; check those field names against the result shapes below)`);
    }
  }
  const log = o.logs.join("\n");
  if (log || o.droppedLogChars) {
    const shown = log.slice(0, CONSOLE_CAP);
    const dropped = o.droppedLogChars + log.length - shown.length;
    out.push("--- console ---", shown + (dropped ? `\n${TRUNCATED} ${size(dropped)} more console chars dropped` : ""));
  }
  if (o.calls.length) {
    const got = o.calls.reduce((a, c) => a + (c.chars ?? 0), 0);
    const ret = o.value?.length ?? 0;
    out.push(`--- ${o.calls.length} MCP call${o.calls.length === 1 ? "" : "s"}: ${size(got)} chars in, ${size(ret)} out ---`);
    for (const c of o.calls) out.push(callLine(c));
    if (o.calls.some((c) => c.state === "ok")) out.push("await recall(n) returns result #n again, with no new call.");
  }
  return out.join("\n");
}

/** One summary line: number, name, size, shape, then the preview when there is one. */
export function callLine(c: CallLine): string {
  if (c.state === "failed") return `#${c.n} ${c.name} failed: ${oneLine(c.error ?? "", 300)}`;
  if (c.state === "unfinished") return `#${c.n} ${c.name} did not finish`;
  if (c.state === "paused") return `#${c.n} ${c.name} paused: waits for the operator's approval`;
  const head = `#${c.n} ${c.name} ${size(c.chars ?? 0)}${c.cut ? ` (over ${size(UPSTREAM_MAX)}: the script saw a cut copy)` : ""}${c.replayed ? " (replayed)" : ""}`;
  // A short result is its own preview; the shape would only repeat its keys.
  if (c.preview !== undefined && c.preview.length <= PREVIEW_SHORT && (c.chars ?? 0) <= PREVIEW_SHORT) return `${head} = ${c.preview}`;
  return `${head} ${c.shape ?? ""}${c.preview ? ` e.g. ${c.preview}` : ""}`.trimEnd();
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};

/** Globals a script has, appended to a ReferenceError so the model stops guessing at others. */
export const SCRIPT_GLOBALS =
  "call(name, args), recall(n), saveFile(name, data), sleep(ms), console.log/warn/error and the JavaScript built-ins (JSON, Math, Array, Object, Promise, Date, …). There is no fetch, require, import, process, setTimeout or file system.";

/** A script error as the model should read it. */
export function explainError(message: string): string {
  return /ReferenceError: .* is not defined/.test(message) ? `${message}\nA script has only: ${SCRIPT_GLOBALS}` : message;
}

/** CSV for an array of rows: the union of keys as the header; nested values as JSON. */
export function toCsv(rows: unknown[]): string {
  const objects = rows.every((r) => r && typeof r === "object" && !Array.isArray(r));
  const header = objects ? [...new Set(rows.flatMap((r) => Object.keys(r as object)))] : ["value"];
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => (objects ? header.map((h) => cell((r as Record<string, unknown>)[h])) : [cell(r)]).join(","));
  return [header.map(cell).join(","), ...lines].join("\n") + "\n";
}

/** File contents for saveFile: CSV/JSONL by extension, text as is, anything else pretty JSON. */
export function fileContents(name: string, data: unknown): string {
  if (/\.csv$/i.test(name) && Array.isArray(data)) return toCsv(data);
  if (/\.jsonl$/i.test(name)) return (Array.isArray(data) ? data : [data]).map((x) => toJson(x)).join("\n") + "\n";
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2) ?? "null";
}

/** The only file name saveFile accepts: a plain base name, other characters replaced. */
export function safeFileName(name: unknown): string | undefined {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^\w.-]/g, "_").replace(/^\.+/, "").slice(0, 120);
  return clean ? clean : undefined;
}
