/**
 * Automatic visualizers: recognise the shapes agents naturally put in a BARE code fence (or a
 * fence with a language the router does not render rich) with no cooperation from the agent —
 * `.env` listings, stack traces, `docker ps` columns, psql grids, `ls -l`, before → after lines,
 * cron schedules, URLs, JWTs, mermaid flowcharts, YAML, INI… Every parser returns null unless it
 * is confident; `sniffBare` tries them in an order that keeps look-alikes apart (an env file is
 * not kv, a stack trace is not a log, a psql grid is not CSV). Pure; covered by test/viz-auto.test.ts.
 */
import { looksLikeCommits, looksLikeDiffstat, parseBadges, parseDag, parseHttp, parseKv, parseProgress, parseSteps, parseTests, parseTimeline } from "./viz-extra";
import { looksLikeTree } from "./viz";
import type { AutoBlock, Columns, CommandLine, Comparison, CronSpec, Definition, EnvVar, FileEntry, IniSection, JwtDecoded, LinkItem, SemverRow, StackFrame, StackTrace, StatusItem, UrlParts } from "./viz-auto-types";

const MAX_LINES = 400;
const MAX_BYTES = 40_000;

function lines(src: string): string[] {
  return src.replace(/\r/g, "").split("\n");
}
function nonEmpty(src: string): string[] {
  return lines(src).map((l) => l.trimEnd()).filter((l) => l.trim());
}
/** True when at least `frac` of `xs` satisfy `ok` (and there is at least one). */
function mostly<T>(xs: T[], ok: (x: T) => boolean, frac = 0.8): boolean {
  return xs.length > 0 && xs.filter(ok).length >= xs.length * frac;
}

// ---------------------------------------------------------------- url / jwt / links

const URL_RE = /^https?:\/\/[^\s<>"')\]]+$/;

/** A fence that is exactly one URL → its anatomy. */
export function parseUrl(src: string): UrlParts | null {
  const ls = nonEmpty(src);
  if (ls.length !== 1 || !URL_RE.test(ls[0].trim())) return null;
  try {
    const u = new URL(ls[0].trim());
    const query: UrlParts["query"] = [];
    u.searchParams.forEach((value, key) => query.push({ key, value }));
    return { href: u.href, protocol: u.protocol.replace(/:$/, ""), host: u.host, path: u.pathname, query, hash: u.hash ? u.hash.slice(1) : undefined };
  } catch {
    return null;
  }
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
    const text = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const v: unknown = JSON.parse(decodeURIComponent(Array.from(text, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A fence that is exactly one JWT → decoded header + payload. DECODED, NOT VERIFIED — the signature is never checked. */
export function parseJwt(src: string, now = Date.now()): JwtDecoded | null {
  const ls = nonEmpty(src);
  if (ls.length !== 1) return null;
  const raw = ls[0].trim();
  const m = raw.match(/^([A-Za-z0-9_-]{10,})\.([A-Za-z0-9_-]{10,})\.([A-Za-z0-9_-]*)$/);
  if (!m) return null;
  const header = b64urlJson(m[1]);
  const payload = b64urlJson(m[2]);
  if (!header || !payload || typeof header.alg !== "string") return null;
  const iat = typeof payload.iat === "number" ? payload.iat : undefined;
  const exp = typeof payload.exp === "number" ? payload.exp : undefined;
  return { raw, header, payload, iat, exp, expired: exp !== undefined ? exp * 1000 < now : undefined };
}

function classifyLink(u: URL): { kind: LinkItem["kind"]; ref?: string } {
  const p = u.pathname.split("/").filter(Boolean);
  if (u.hostname === "github.com" && p.length >= 2) {
    const repo = `${p[0]}/${p[1]}`;
    if (p[2] === "pull" && p[3]) return { kind: "pr", ref: `${repo}#${p[3]}` };
    if (p[2] === "issues" && p[3]) return { kind: "issue", ref: `${repo}#${p[3]}` };
    if (p[2] === "commit" && p[3]) return { kind: "commit", ref: p[3].slice(0, 7) };
    if (p.length === 2) return { kind: "repo", ref: repo };
  }
  if (/^(docs?|developer|developers|learn|wiki)\./.test(u.hostname) || /readthedocs|\/docs?(\/|$)/.test(u.href)) return { kind: "doc" };
  return { kind: "other" };
}

/** Two or more lines that are each a link (bare, `[label](url)`, `label: url`, list-prefixed) → link cards. */
export function parseLinks(src: string): LinkItem[] | null {
  const ls = nonEmpty(src);
  if (ls.length < 2 || ls.length > 60) return null;
  const out: LinkItem[] = [];
  for (const raw of ls) {
    const l = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "");
    let label: string | undefined;
    let url: string | undefined;
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/))) [label, url] = [m[1], m[2]];
    else if ((m = l.match(/^<(https?:\/\/[^>\s]+)>$/))) url = m[1];
    else if ((m = l.match(/^(.{1,60}?):\s+(https?:\/\/\S+)$/))) [label, url] = [m[1], m[2]];
    else if ((m = l.match(/^(https?:\/\/\S+)(?:\s+[-—–]\s+(.+))?$/))) [url, label] = [m[1], m[2]];
    if (!url || !URL_RE.test(url)) return null;
    try {
      const u = new URL(url);
      out.push({ url, label, host: u.host, ...classifyLink(u) });
    } catch {
      return null;
    }
  }
  return out;
}

// ---------------------------------------------------------------- stack traces

const VENDOR_RE = /node_modules|site-packages|dist-packages|\/usr\/lib|<frozen|\bjdk\.|\bjava\.|\bsun\.|golang\.org|\/rustc\/|\/usr\/local\/lib\/python|internal\/(?:process|modules|main)|node:internal/;

export function parseStackTrace(src: string): StackTrace | null {
  const ls = nonEmpty(src);
  if (ls.length < 2 || ls.length > MAX_LINES) return null;
  const frames: StackFrame[] = [];
  const other: string[] = [];
  let language: StackTrace["language"] = "other";
  const push = (f: Omit<StackFrame, "vendor">) => frames.push({ ...f, vendor: VENDOR_RE.test(f.file ?? "") || VENDOR_RE.test(f.fn ?? "") });
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i].trim();
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/))) {
      language = language === "other" ? "js" : language;
      push({ fn: m[1], file: m[2], line: Number(m[3]), col: Number(m[4]), raw: l });
    } else if ((m = l.match(/^File "(.+?)", line (\d+)(?:, in (.+))?$/))) {
      language = "py";
      push({ fn: m[3], file: m[1], line: Number(m[2]), raw: l });
      if (ls[i + 1] && !/^(File "|Traceback|\w+(Error|Exception))/.test(ls[i + 1].trim())) i++; // the source line under a Python frame
    } else if ((m = l.match(/^at ([\w$.<>]+)\((.+?)(?::(\d+))?\)$/))) {
      language = "java";
      push({ fn: m[1], file: m[2], line: m[3] ? Number(m[3]) : undefined, raw: l });
    } else if ((m = l.match(/^(\S+\.go):(\d+)(?: \+0x[0-9a-f]+)?$/))) {
      language = "go";
      const fn = i > 0 && !/\.go:\d+/.test(ls[i - 1]) ? ls[i - 1].trim().replace(/\(.*$/, "") : undefined;
      if (fn && other[other.length - 1] === ls[i - 1].trim()) other.pop();
      push({ fn, file: m[1], line: Number(m[2]), raw: l });
    } else if ((m = l.match(/^(?:\d+:\s+)?(\S+)\s*$/)) && /^[\w$.:<>]+$/.test(m[1]) && ls[i + 1]?.trim().startsWith("at ") && /\.rs:\d+/.test(ls[i + 1])) {
      language = "rust";
      const f = ls[++i].trim().match(/^at (.+?):(\d+)(?::(\d+))?$/);
      push({ fn: m[1], file: f?.[1], line: f ? Number(f[2]) : undefined, col: f?.[3] ? Number(f[3]) : undefined, raw: `${l} ${ls[i].trim()}` });
    } else if (/^Traceback \(most recent call last\):?$/.test(l) || /^goroutine \d+ \[.*\]:$/.test(l)) {
      language = /^goroutine/.test(l) ? "go" : "py";
    } else other.push(l);
  }
  if (frames.length < 2) return null;
  // Python puts the exception LAST; everything else puts it first.
  const msgLines = language === "py" ? other.filter((l) => /^\w+(Error|Exception|Exit|Interrupt)\b/.test(l)).slice(-1) : other.slice(0, 2);
  const message = (msgLines.join(" ") || other[0] || "").trim();
  if (!message) return null;
  const name = message.match(/^([A-Z][\w.]*(?:Error|Exception|Panic|panic))\b/)?.[1] ?? (/^panic:/.test(message) ? "panic" : undefined);
  return { message, name, frames, language };
}

// ---------------------------------------------------------------- env

const SECRET_KEY_RE = /(secret|token|passw(or)?d|pwd|api[_-]?key|private|credential|auth|signing|salt|dsn|database_url|redis_url|connection[_-]?string)/i;

/** `KEY=value` / `export KEY=value` lines (≥2, ≥80% of non-comment lines) → masked env panel. */
export function parseEnv(src: string): EnvVar[] | null {
  const ls = nonEmpty(src);
  if (ls.length < 2 || ls.length > 120) return null;
  const out: EnvVar[] = [];
  let pending: string | undefined;
  let bad = 0;
  for (const raw of ls) {
    const l = raw.trim();
    if (l.startsWith("#")) {
      pending = l.replace(/^#\s?/, "");
      continue;
    }
    const m = l.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) {
      bad++;
      continue;
    }
    let value = m[2].trim();
    let comment: string | undefined = pending;
    const tail = value.match(/^("(?:[^"\\]|\\.)*"|'[^']*'|[^#\s]*)\s*(?:#\s*(.*))?$/);
    if (tail) {
      value = tail[1].replace(/^(['"])(.*)\1$/, "$2");
      comment = tail[2] ?? comment;
    }
    const secret = SECRET_KEY_RE.test(m[1]) || /^(eyJ[A-Za-z0-9_-]+\.)|^(sk|pk|ghp|gho|xox[abp]|AKIA)[_-]?[A-Za-z0-9]{10,}/.test(value) || (/^[A-Za-z0-9+/_-]{32,}$/.test(value) && /\d/.test(value) && /[a-z]/.test(value));
    out.push({ key: m[1], value, secret, comment });
    pending = undefined;
  }
  if (out.length < 2 || bad > out.length * 0.25) return null;
  return out;
}

// ---------------------------------------------------------------- columns (ps / docker ps / kubectl / psql / boxes)

function stripBox(l: string): string[] {
  return l.replace(/^[|│]/, "").replace(/[|│]$/, "").split(/[|│]/).map((c) => c.trim());
}

/** ASCII / unicode boxed tables (mysql, sqlite `-box`, psql, markdown-like `| a | b |` without a header rule). */
export function parseBoxedTable(src: string): Columns | null {
  const ls = nonEmpty(src).map((l) => l.trim());
  if (ls.length < 2 || ls.length > MAX_LINES) return null;
  const isRule = (l: string) => /^[+┌┐└┘├┤┬┴┼─\-=|│\s]+$/.test(l) && /[-─=]{2,}/.test(l);
  const data = ls.filter((l) => !isRule(l) && !/^\(\d+ rows?\)$/.test(l));
  if (data.length < 2 || !data.every((l) => /[|│]/.test(l))) return null;
  // psql omits the outer bars: `id | login` … `----+-----`. Boxed forms carry them. Both split on the bar.
  const rows = data.map(stripBox);
  const width = rows[0].length;
  if (width < 2 || rows.some((r) => r.length !== width)) return null;
  const [head, ...body] = rows;
  if (body.length < 1 || head.some((h) => !h)) return null;
  return { head, rows: body };
}

/** Fixed-width column output: a header of short tokens separated by ≥2 spaces, rows cut at the same offsets. */
export function parseFixedColumns(src: string): Columns | null {
  const ls = lines(src).filter((l) => l.trim());
  if (ls.length < 2 || ls.length > MAX_LINES) return null;
  const header = ls[0].trimEnd();
  if (/[:|=]/.test(header) || header.startsWith(" ")) return null;
  const starts: number[] = [];
  for (const m of header.matchAll(/(?:^|\s{2,})(\S)/g)) starts.push(m.index! + m[0].length - 1);
  if (starts.length < 2 || starts.length > 16) return null;
  const head = starts.map((s, i) => header.slice(s, starts[i + 1] ?? header.length).trim());
  // Headers are labels: short, no sentences. `NAME`, `Status`, `CPU %`, `Time left` — not prose.
  if (!head.every((h) => h.length <= 24 && /^[A-Za-z0-9 %#_./()-]+$/.test(h))) return null;
  const upper = head.every((h) => h === h.toUpperCase());
  const body = ls.slice(1);
  const rows: string[][] = [];
  let cleanCuts = 0;
  let cuts = 0;
  for (const raw of body) {
    const r = starts.map((s, i) => raw.slice(s, i + 1 < starts.length ? starts[i + 1] : undefined).trim());
    for (const s of starts.slice(1)) {
      cuts++;
      if (s >= raw.length || raw[s - 1] === " ") cleanCuts++;
    }
    rows.push(r);
  }
  if (rows.length < (upper ? 1 : 2) || cleanCuts < cuts * 0.85) return null;
  if (rows.some((r) => !r[0])) return null;
  return { head, rows };
}

// ---------------------------------------------------------------- yaml-lite

function scalar(v: string): unknown {
  const t = v.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const q = t.match(/^(['"])(.*)\1$/);
  if (q) return q[2];
  if (/^\[.*\]$/.test(t)) return t.slice(1, -1).split(",").map((x) => scalar(x)).filter((x) => x !== null);
  if (/^\{.*\}$/.test(t)) {
    const o: Record<string, unknown> = {};
    for (const part of t.slice(1, -1).split(",")) {
      const i = part.indexOf(":");
      if (i <= 0) return t;
      o[part.slice(0, i).trim()] = scalar(part.slice(i + 1));
    }
    return o;
  }
  return t;
}

/** A YAML subset (nested maps, `- ` lists, scalars, inline `[]`/`{}`) → a JSON value; null on anything fancier. */
export function parseYamlLite(src: string): unknown | null {
  const ls = lines(src)
    .map((l) => l.replace(/\s+#.*$/, "").trimEnd())
    .filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (ls.length === 0 || ls.length > MAX_LINES) return null;
  if (ls.some((l) => /\t/.test(l) || /^---|^\.\.\.|[&*!]\w|:\s*[|>]-?\s*$/.test(l.trim()))) return null;
  const indent = (l: string) => l.match(/^ */)![0].length;
  let i = 0;
  const parseBlock = (level: number): unknown => {
    const isList = ls[i].trim().startsWith("- ");
    const out: unknown[] | Record<string, unknown> = isList ? [] : {};
    while (i < ls.length && indent(ls[i]) === level) {
      const l = ls[i].trim();
      if (isList !== l.startsWith("- ")) throw new Error("mixed");
      if (isList) {
        const item = l.slice(2).trim();
        i++;
        const kv = item.match(/^([^:\s][^:]*):(?:\s+(.*))?$/);
        if (kv) {
          // `- key: value` opens a map whose siblings sit at level + 2.
          const obj: Record<string, unknown> = { [kv[1].trim()]: kv[2] !== undefined && kv[2] !== "" ? scalar(kv[2]) : null };
          if (kv[2] === undefined || kv[2] === "") {
            if (i < ls.length && indent(ls[i]) > level + 2) obj[kv[1].trim()] = parseBlock(indent(ls[i]));
          }
          if (i < ls.length && indent(ls[i]) === level + 2 && !ls[i].trim().startsWith("- ")) Object.assign(obj, parseBlock(level + 2));
          (out as unknown[]).push(obj);
        } else (out as unknown[]).push(scalar(item));
      } else {
        const kv = l.match(/^([^:\s][^:]*):(?:\s+(.*))?$/);
        if (!kv) throw new Error("not kv");
        i++;
        const key = kv[1].trim();
        if (kv[2] !== undefined && kv[2] !== "") (out as Record<string, unknown>)[key] = scalar(kv[2]);
        else if (i < ls.length && indent(ls[i]) > level) (out as Record<string, unknown>)[key] = parseBlock(indent(ls[i]));
        else (out as Record<string, unknown>)[key] = null;
      }
    }
    return out;
  };
  try {
    if (indent(ls[0]) !== 0) return null;
    const v = parseBlock(0);
    if (i !== ls.length) return null;
    // A flat map of only scalars is kv territory, not a JSON explorer — unless it is large.
    if (!Array.isArray(v) && Object.values(v as object).every((x) => x === null || typeof x !== "object") && ls.length < 6) return null;
    return v;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- ini / toml

export function parseIni(src: string): IniSection[] | null {
  const ls = nonEmpty(src).map((l) => l.trim()).filter((l) => !/^[;#]/.test(l));
  if (ls.length < 2 || ls.length > 200) return null;
  const out: IniSection[] = [];
  let cur: IniSection = { rows: [] };
  let sections = 0;
  for (const l of ls) {
    const sec = l.match(/^\[([^\]]+)\]$/);
    if (sec) {
      if (cur.rows.length || cur.name) out.push(cur);
      cur = { name: sec[1], rows: [] };
      sections++;
      continue;
    }
    const kv = l.match(/^([A-Za-z_][\w.-]*)\s*[=:]\s*(.*)$/);
    if (!kv) return null;
    cur.rows.push({ key: kv[1], value: kv[2].replace(/\s+[;#].*$/, "").replace(/^(['"])(.*)\1$/, "$2") });
  }
  if (cur.rows.length || cur.name) out.push(cur);
  if (sections === 0 || out.every((s) => s.rows.length === 0)) return null;
  return out;
}

// ---------------------------------------------------------------- files (ls -l / du)

function toBytes(s: string): number | undefined {
  const m = s.match(/^([\d.]+)\s*([KMGTP]?)(i?B)?$/i);
  if (!m) return undefined;
  const mult = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 }[m[2].toUpperCase()] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

export function parseFileList(src: string): FileEntry[] | null {
  const ls = nonEmpty(src).map((l) => l.trim()).filter((l) => !/^total \d+/.test(l));
  if (ls.length < 2 || ls.length > MAX_LINES) return null;
  const out: FileEntry[] = [];
  const LS = /^([-dlbcps][rwxsStT-]{9}[@+.]?)\s+\d+\s+\S+\s+\S+\s+([\d.]+[KMGTP]?i?B?)\s+(\w{3}\s+\d{1,2}\s+(?:[\d:]{4,5}|\d{4})|\d{4}-\d{2}-\d{2}(?:\s+[\d:]+)?)\s+(.+)$/;
  const DU = /^([\d.]+[KMGTP]?i?B?|\d+)\s+(.+)$/;
  const isLs = mostly(ls, (l) => LS.test(l));
  const isDu = !isLs && ls.every((l) => DU.test(l));
  if (!isLs && !isDu) return null;
  for (const l of ls) {
    if (isLs) {
      const m = l.match(LS);
      if (!m) continue;
      const kind: FileEntry["kind"] = m[1][0] === "d" ? "dir" : m[1][0] === "l" ? "link" : "file";
      out.push({ name: m[4], kind, bytes: toBytes(m[2]), sizeText: m[2], mode: m[1], modified: m[3] });
    } else {
      const m = l.match(DU)!;
      out.push({ name: m[2], kind: /\.\w{1,5}$/.test(m[2]) ? "file" : "dir", bytes: toBytes(m[1]), sizeText: m[1] });
    }
  }
  return out.length >= 2 ? out : null;
}

// ---------------------------------------------------------------- commands

const BINARIES = /^(npm|npx|pnpm|yarn|bun|deno|git|gh|docker|docker-compose|kubectl|helm|terraform|aws|gcloud|az|curl|wget|cd|ls|cat|less|tail|head|grep|rg|find|make|cmake|cargo|rustup|go|python3?|pip3?|poetry|uv|node|ruby|gem|bundle|brew|apt|apt-get|yum|dnf|sudo|export|source|echo|mkdir|rm|cp|mv|chmod|chown|ssh|scp|rsync|tar|unzip|zip|systemctl|service|psql|mysql|redis-cli|sqlite3|vite|tsc|eslint|prettier|jest|vitest|pytest|dotnet|java|mvn|gradle|flutter|swift|xcodebuild|open|code)\b/;

/** `$ cmd` lines (with `# comment` lines above them), or a fence of plain shell commands. */
export function parseCommands(src: string): CommandLine[] | null {
  const ls = nonEmpty(src).map((l) => l.trim());
  if (ls.length === 0 || ls.length > 80) return null;
  const prompted = ls.filter((l) => /^\$ \S/.test(l));
  const out: CommandLine[] = [];
  let comment: string | undefined;
  if (prompted.length >= 1) {
    for (const l of ls) {
      if (l.startsWith("#")) comment = l.replace(/^#\s?/, "");
      else if (/^\$ \S/.test(l)) {
        out.push({ cmd: l.slice(2).trim(), comment });
        comment = undefined;
      } // anything else is output under a command: kept in the raw view, not as a command
    }
    return out.length ? out : null;
  }
  if (ls.length < 2) return null;
  for (const l of ls) {
    if (l.startsWith("#")) {
      comment = l.replace(/^#\s?/, "");
      continue;
    }
    if (!BINARIES.test(l)) return null;
    out.push({ cmd: l, comment });
    comment = undefined;
  }
  return out.length >= 2 ? out : null;
}

// ---------------------------------------------------------------- comparison (before → after)

const NUM_RE = /^([+-]?\d[\d,]*(?:\.\d+)?)\s*([a-zA-Zµ%/]+(?:\/[a-zA-Z]+)?)?$/;
const LOWER_IS_BETTER = /latenc|time|duration|size|bytes|kb|mb|memory|mem|cpu|error|fail|cost|p9\d|ttfb|lcp|cls|fid|inp|delay|wait|bundle|debt|churn/i;
const HIGHER_IS_BETTER = /throughput|requests?|rps|qps|score|coverage|speed|users|revenue|uptime|hit|success|pass|accuracy|conversion|retention|fps/i;

function num(s: string): { n: number; unit?: string } | null {
  const m = s.trim().match(NUM_RE);
  return m ? { n: Number(m[1].replace(/,/g, "")), unit: m[2] } : null;
}

export function parseComparison(src: string): Comparison[] | null {
  const ls = nonEmpty(src).map((l) => l.trim());
  if (ls.length === 0 || ls.length > 40) return null;
  const out: Comparison[] = [];
  for (const l of ls) {
    let m = l.match(/^(.+?)\s*[:—–-]\s*(.+?)\s*(?:→|->|=>|⟶)\s*(.+)$/);
    let label: string, before: string, after: string;
    if (m) [label, before, after] = [m[1], m[2], m[3]];
    else if ((m = l.match(/^(.+?)\s*(?:→|->|=>|⟶)\s*(.+?)\s*\((.+)\)$/))) [before, after, label] = [m[1], m[2], m[3]];
    else return null;
    if (label.length > 60 || !before || !after) return null;
    const b = num(before);
    const a = num(after);
    out.push({
      label,
      before,
      after,
      beforeNum: b?.n,
      afterNum: a?.n,
      unit: b?.unit ?? a?.unit,
      betterWhen: LOWER_IS_BETTER.test(label) ? "lower" : HIGHER_IS_BETTER.test(label) ? "higher" : undefined,
    });
  }
  // Prose with an arrow in it is not a comparison: most rows need a number on at least one side.
  return mostly(out, (r) => r.beforeNum !== undefined || r.afterNum !== undefined, 0.6) ? out : null;
}

// ---------------------------------------------------------------- cron

const FIELD_RE = /^(\*|\?|L|\d+|\*\/\d+|\d+-\d+(?:\/\d+)?|(?:\d+|[A-Z]{3})(?:,(?:\d+|[A-Z]{3}))+|[A-Z]{3}(?:-[A-Z]{3})?|\d+#\d)$/i;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DOW3 = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const ALIASES: Record<string, string> = { "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *" };

function dowName(v: string): string {
  const n = Number(v);
  if (!Number.isNaN(n)) return DOW[n] ?? v;
  const i = DOW3.indexOf(v.toUpperCase());
  return i >= 0 ? DOW[i] : v;
}
function monName(v: string): string {
  const n = Number(v);
  if (!Number.isNaN(n)) return MON[n - 1] ?? v;
  const i = MON3.indexOf(v.toUpperCase());
  return i >= 0 ? MON[i] : v;
}
function describeField(v: string, unit: string, name: (x: string) => string = (x) => x): string {
  if (v === "*" || v === "?") return `every ${unit}`;
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^\*\/(\d+)$/))) return `every ${m[1]} ${unit}s`;
  if ((m = v.match(/^(\w+)-(\w+)(?:\/(\d+))?$/))) return `${name(m[1])}–${name(m[2])}${m[3] ? ` every ${m[3]}` : ""}`;
  if (v.includes(",")) return v.split(",").map(name).join(", ");
  return name(v);
}
const pad = (n: string) => n.padStart(2, "0");

function describeCron(f: string[]): string {
  const [min, hour, dom, mon, dow] = f;
  const plain = (v: string) => /^\d+$/.test(v);
  const every = (v: string) => v === "*" || v === "?";
  const at = plain(min) && plain(hour) ? `at ${pad(hour)}:${pad(min)}` : null;
  let when: string;
  if (every(min) && every(hour)) when = "Every minute";
  else if (min.startsWith("*/") && every(hour)) when = `Every ${min.slice(2)} minutes`;
  else if (plain(min) && every(hour)) when = `Every hour at :${pad(min)}`;
  else if (plain(min) && hour.startsWith("*/")) when = `Every ${hour.slice(2)} hours at :${pad(min)}`;
  else if (at) when = at[0].toUpperCase() + at.slice(1);
  else when = `Minute ${describeField(min, "minute")}, hour ${describeField(hour, "hour")}`;
  const parts: string[] = [];
  if (!every(dow)) parts.push(`on ${describeField(dow, "day", dowName)}`);
  if (!every(dom)) parts.push(`on day ${describeField(dom, "day")} of the month`);
  if (!every(mon)) parts.push(`in ${describeField(mon, "month", monName)}`);
  if (parts.length === 0 && at) when = `Every day ${at}`;
  return [when, ...parts].join(" ");
}

export function parseCron(src: string): CronSpec[] | null {
  const ls = nonEmpty(src).map((l) => l.trim()).filter((l) => !l.startsWith("#"));
  if (ls.length === 0 || ls.length > 30) return null;
  const out: CronSpec[] = [];
  for (const l of ls) {
    let expr = l;
    let cmd = "";
    const alias = l.match(/^(@\w+)(?:\s+(.*))?$/);
    if (alias && ALIASES[alias[1]]) {
      expr = ALIASES[alias[1]];
      cmd = alias[2] ?? "";
    } else {
      const toks = l.split(/\s+/);
      if (toks.length < 5) return null;
      const fields = toks.slice(0, 5);
      if (!fields.every((t) => FIELD_RE.test(t))) return null;
      expr = fields.join(" ");
      cmd = toks.slice(5).join(" ");
    }
    const f = expr.split(" ");
    const labels = ["minute", "hour", "day of month", "month", "weekday"];
    const namers = [(x: string) => x, (x: string) => x, (x: string) => x, monName, dowName];
    out.push({
      expr: alias && ALIASES[alias[1]] ? alias[1] : expr,
      description: describeCron(f) + (cmd ? ` — ${cmd}` : ""),
      fields: f.map((v, i) => ({ label: labels[i], value: v, meaning: describeField(v, labels[i].split(" ")[0], namers[i]) })),
    });
  }
  return out;
}

// ---------------------------------------------------------------- semver

function jumpOf(from: string, to: string): SemverRow["jump"] {
  const a = from.replace(/^v/, "").split(".").map(Number);
  const b = to.replace(/^v/, "").split(".").map(Number);
  if (a.length < 3 || b.length < 3 || [...a, ...b].some((n) => Number.isNaN(n))) return "other";
  return b[0] !== a[0] ? "major" : b[1] !== a[1] ? "minor" : "patch";
}

/** `name 1.2.3 → 2.0.0`, `name: a -> b`, `name@a → name@b`, or an `npm outdated` table → upgrade rows. */
export function parseSemver(src: string): SemverRow[] | null {
  const ls = nonEmpty(src).map((l) => l.trim());
  if (ls.length === 0 || ls.length > 80) return null;
  const V = String.raw`v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?`;
  if (/^Package\s+Current\s+Wanted\s+Latest/i.test(ls[0])) {
    const rows: SemverRow[] = [];
    for (const l of ls.slice(1)) {
      const m = l.match(new RegExp(`^(\\S+)\\s+(${V})\\s+(${V})\\s+(${V})`));
      if (!m) return null;
      rows.push({ name: m[1], from: m[2], to: m[4], jump: jumpOf(m[2], m[4]) });
    }
    return rows.length ? rows : null;
  }
  const out: SemverRow[] = [];
  for (const l of ls) {
    const m = l.match(new RegExp(`^([@\\w./-]+?)(?:@|:\\s*|\\s+)(${V})\\s*(?:→|->|=>|⟶)\\s*(?:[@\\w./-]+@)?(${V})$`));
    if (!m) return null;
    out.push({ name: m[1], from: m[2], to: m[3], jump: jumpOf(m[2], m[3]) });
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------- mermaid flowchart

/** `graph LR` / `flowchart TD` edges → label pairs for the DAG renderer. Labels replace ids. */
export function parseMermaidFlow(src: string): [string, string][] | null {
  const ls = nonEmpty(src).map((l) => l.trim()).filter((l) => !l.startsWith("%%"));
  if (ls.length < 2 || !/^(graph|flowchart)\s+(TD|TB|LR|RL|BT)\b/i.test(ls[0])) return null;
  const labels = new Map<string, string>();
  const node = (s: string): string | null => {
    const m = s.trim().match(/^([\w.-]+)\s*(?:\[\[?"?([^\]"]+)"?\]?\]|\(\(?"?([^)"]+)"?\)?\)|\{"?([^}"]+)"?\}|>"?([^\]"]+)"?\])?$/);
    if (!m) return null;
    const label = (m[2] ?? m[3] ?? m[4] ?? m[5])?.trim();
    if (label) labels.set(m[1], label);
    return m[1];
  };
  const edges: [string, string][] = [];
  for (const l of ls.slice(1)) {
    if (/^(subgraph|end|classDef|class|style|click|linkStyle|direction)\b/.test(l)) continue;
    for (const stmt of l.split(";").map((s) => s.trim()).filter(Boolean)) {
      const parts = stmt.split(/\s*(?:-->|---|-\.->|==>|-\.-|~~~)(?:\|[^|]*\|)?\s*/);
      if (parts.length === 1) {
        if (!node(parts[0])) return null;
        continue;
      }
      for (let i = 0; i + 1 < parts.length; i++) {
        const a = node(parts[i]);
        const b = node(parts[i + 1]);
        if (!a || !b) return null;
        edges.push([a, b]);
      }
    }
  }
  if (edges.length === 0 || edges.length > 40) return null;
  return edges.map(([a, b]) => [labels.get(a) ?? a, labels.get(b) ?? b]);
}

// ---------------------------------------------------------------- lists (definitions / status)

export function parseDefinitions(items: string[]): Definition[] | null {
  if (items.length < 3 || items.length > 40) return null;
  const out: Definition[] = [];
  for (const raw of items) {
    const t = raw.trim().replace(/^\*\*(.+?)\*\*/, "$1");
    const m = t.match(/^(.{1,40}?)\s*(?:—|–|:|\s-\s)\s*(.{3,})$/);
    if (!m || /[.!?]$/.test(m[1]) || /^https?$/i.test(m[1]) || URL_RE.test(m[2]) || m[2].startsWith("//")) return null;
    out.push({ term: m[1].replace(/:$/, "").trim(), detail: m[2].trim() });
  }
  return out;
}

const STATUS_RE = /^(✅|✔️?|✓|❌|✘|✗|⚠️?|⏳|🔄|🕒|ℹ️?|🟢|🔴|🟡|\[(?:x|X| )\]|PASS(?:ED)?|FAIL(?:ED)?|WARN(?:ING)?|OK|DONE|TODO|PENDING|SKIP(?:PED)?|ERROR|INFO)\s*[:\-–—]?\s*(.+)$/u;

export function parseStatusItems(items: string[]): StatusItem[] | null {
  if (items.length < 2 || items.length > 60) return null;
  const out: StatusItem[] = [];
  for (const raw of items) {
    const m = raw.trim().match(STATUS_RE);
    if (!m) return null;
    const g = m[1].toUpperCase();
    const state: StatusItem["state"] = /✅|✔|✓|PASS|OK|DONE|🟢|\[X\]/.test(g) ? "ok" : /❌|✘|✗|FAIL|ERROR|🔴/.test(g) ? "fail" : /⚠|WARN|🟡/.test(g) ? "warn" : /⏳|🔄|🕒|TODO|PENDING|SKIP|\[ \]/.test(g) ? "pending" : "info";
    out.push({ state, text: m[2].trim() });
  }
  return out;
}

// ---------------------------------------------------------------- sniffers

function looksLikeLog(src: string): boolean {
  const ls = nonEmpty(src);
  return ls.length >= 3 && mostly(ls, (l) => /\b\d{2}:\d{2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b|\b(ERROR|WARN(ING)?|INFO|DEBUG|TRACE|FATAL)\b/.test(l), 0.6);
}
function looksLikeCsv(src: string, d: "," | "\t" | "|"): boolean {
  const ls = nonEmpty(src);
  if (ls.length < 2) return false;
  const n = ls[0].split(d).length;
  return n >= 2 && n <= 20 && ls.every((l) => l.split(d).length === n) && (d !== "," || !/[.!?]\s|\s(and|the|of)\s/.test(ls[0]));
}
function looksLikeDagEdges(src: string): boolean {
  const ls = nonEmpty(src);
  return ls.length >= 2 && ls.every((l) => /\s(?:->|→)\s/.test(l) && !/[:=]/.test(l));
}

/** What a bare fence is. Order matters: specific, high-confidence shapes first; generic key/value last. */
export function sniffBare(code: string): AutoBlock | null {
  if (code.length > MAX_BYTES) return null;
  const src = code.replace(/\n$/, "");
  const ls = nonEmpty(src);
  if (ls.length === 0 || ls.length > MAX_LINES) return null;

  const jwt = parseJwt(src);
  if (jwt) return { kind: "jwt", jwt };
  const url = parseUrl(src);
  if (url) return { kind: "url", url };
  const links = parseLinks(src);
  if (links) return { kind: "links", links };
  const trace = parseStackTrace(src);
  if (trace) return { kind: "stack", trace };
  const env = parseEnv(src);
  if (env) return { kind: "env", vars: env };
  const files = parseFileList(src);
  if (files) return { kind: "files", entries: files };
  const commands = parseCommands(src);
  if (commands) return { kind: "commands", commands };
  const cron = parseCron(src);
  if (cron) return { kind: "cron", specs: cron };
  if (looksLikeTree(src)) return { kind: "tree", lines: src };
  if (looksLikeDiffstat(src)) return { kind: "diffstat", lines: src };
  if (looksLikeCommits(src)) return { kind: "commits", lines: src };
  const boxed = parseBoxedTable(src);
  if (boxed) return { kind: "table", table: boxed };
  if (parseHttp(src)) return { kind: "http", lines: src };
  if (parseTests(src)) return { kind: "tests", lines: src };
  const semver = parseSemver(src);
  if (semver) return { kind: "semver", rows: semver };
  const cmp = parseComparison(src);
  if (cmp) return { kind: "comparison", rows: cmp };
  if (looksLikeDagEdges(src) && parseDag(src)) return { kind: "dag", edges: [] };
  if (looksLikeCsv(src, "\t")) return { kind: "csv", delimiter: "\t" };
  if (looksLikeCsv(src, ",")) return { kind: "csv", delimiter: "," };
  const cols = parseFixedColumns(src);
  if (cols) return { kind: "table", table: cols };
  if (ls.length >= 2 && parseTimeline(src) && ls.every((l) => l.includes("|"))) return { kind: "timeline", lines: src };
  if (ls.length >= 2 && /^\d+[.)]\s/.test(ls[0]) && /[✓✗…]/.test(src) && parseSteps(src)) return { kind: "steps", lines: src };
  const progress = parseProgress(src);
  if (progress && ls.length >= 2) return { kind: "progress", rows: progress.map((r) => ({ label: r.label, value: r.frac * 100, max: 100 })) };
  const badges = parseBadges(src);
  if (badges && ls.length >= 2 && badges.every((b) => b.tone !== "neutral")) return { kind: "badges", badges: badges.map((b) => ({ label: b.label, state: b.value })) };
  if (looksLikeLog(src)) return { kind: "log", lines: src };
  const ini = ls.some((l) => /^\[[^\]]+\]$/.test(l.trim())) ? parseIni(src) : null;
  if (ini) return { kind: "ini", sections: ini };
  if (ls.length >= 3 && ls.length <= 40) {
    const kv = parseKv(src);
    if (kv && kv.every((r) => r.value && r.key.length <= 30 && !/\s{3,}/.test(r.key))) return { kind: "kv", rows: kv };
  }
  const yaml = ls.some((l) => /^\s+\S/.test(l) || /^\s*- /.test(l)) ? parseYamlLite(src) : null;
  if (yaml && typeof yaml === "object") return { kind: "json", value: yaml };
  return null;
}

/** Fences WITH a language the router does not otherwise render rich. */
export function sniffLanguage(language: string, code: string): AutoBlock | null {
  if (code.length > MAX_BYTES) return null;
  const src = code.replace(/\n$/, "");
  switch (language.toLowerCase()) {
    case "yaml":
    case "yml": {
      const v = parseYamlLite(src);
      if (v && typeof v === "object") return { kind: "json", value: v };
      const kv = parseKv(src);
      return kv && kv.length >= 2 ? { kind: "kv", rows: kv } : null;
    }
    case "toml":
    case "ini":
    case "cfg":
    case "conf":
    case "properties": {
      const s = parseIni(src);
      if (s) return { kind: "ini", sections: s };
      const kv = parseKv(src.replace(/^([\w.-]+)\s*=\s*/gm, "$1: "));
      return kv ? { kind: "kv", rows: kv } : null;
    }
    case "env":
    case "dotenv":
    case ".env": {
      const e = parseEnv(src);
      return e ? { kind: "env", vars: e } : null;
    }
    case "mermaid": {
      const edges = parseMermaidFlow(src);
      return edges ? { kind: "dag", edges } : null;
    }
    case "sh":
    case "bash":
    case "zsh":
    case "shell":
    case "console":
    case "shell-session": {
      if (!/^\$ \S/m.test(src)) return null;
      const c = parseCommands(src);
      return c ? { kind: "commands", commands: c } : null;
    }
    case "stacktrace":
    case "traceback": {
      const t = parseStackTrace(src);
      return t ? { kind: "stack", trace: t } : null;
    }
    case "cron":
    case "crontab": {
      const c = parseCron(src);
      return c ? { kind: "cron", specs: c } : null;
    }
    case "jwt": {
      const j = parseJwt(src);
      return j ? { kind: "jwt", jwt: j } : null;
    }
    case "url": {
      const u = parseUrl(src);
      return u ? { kind: "url", url: u } : null;
    }
    default:
      return null;
  }
}
