/**
 * Code references in agent chat — `web/src/lib/viz.ts:42`, `src/x.ts#L10-L20`, `[parseDag](web/src/lib/viz-extra.ts:515)` —
 * parsed into {path, line, endLine} so the box page can open the file in the workspace at that line.
 * Pure and conservative: anything doubtful is not a ref (the UI then renders plain inline code).
 */
export type CodeRef = { path: string; line?: number; endLine?: number };

// A path segment: no spaces, no quotes/brackets that prose would carry.
const SEG = String.raw`[\w@+.\-\[\]]+`;
const REF_RE = new RegExp(String.raw`^(${SEG}(?:/${SEG})*)(?::(\d+)(?:[-–](\d+))?(?::\d+)?|#L(\d+)(?:-L?(\d+))?)?$`);
// A file extension starts with a letter, so 1.2.3 / v2.0 / 3.14 are never files.
const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/** `text` as a code reference, or null when it is a URL, a sentence, a bare word, a version… */
export function parseCodeRef(text: string): CodeRef | null {
  let s = text.trim();
  if (!s || s.length > 300 || /\s/.test(s)) return null;
  if (/^[a-z][\w+.-]*:\/\//i.test(s) || /^(mailto|tel|data|javascript):/i.test(s)) return null;
  s = s.replace(/^\/workspace\//, "").replace(/^\.\//, "");
  const m = REF_RE.exec(s);
  if (!m) return null;
  const path = m[1];
  const segs = path.split("/");
  if (segs.some((x) => x === "" || x === "." || x === "..") || path.startsWith("-")) return null;
  const last = segs[segs.length - 1];
  if (!EXT_RE.test(last) && segs.length < 2) return null; // bare word: `foo`, `README`
  if (/^v?\d+(\.\d+)+$/i.test(last)) return null;
  const line = Number(m[2] ?? m[4]) || undefined;
  let endLine = Number(m[3] ?? m[5]) || undefined;
  if (line === undefined || (endLine !== undefined && endLine <= line)) endLine = undefined;
  return { path, ...(line !== undefined && { line }), ...(endLine !== undefined && { endLine }) };
}

const NAME_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;
const PAIRS: RegExp[] = [
  // [name](path:line) or [`name`](path:line)
  /\[`?([^\]`\s]+)`?\]\(([^)\s]+)\)/g,
  // `name` (`path:line`)
  /`([^`\s]+)`\s*\(\s*`([^`\s]+)`\s*\)/g,
  // `name` in `path:line`
  /`([^`\s]+)`\s+in\s+`([^`\s]+)`/g,
];

/**
 * Symbols tied to a location within one message: `[parseDag](web/src/lib/viz-extra.ts:515)`,
 * `` `parseDag` (`viz-extra.ts:515`) `` or `` `parseDag` in `viz-extra.ts:515` ``. Later inline-code
 * mentions of exactly that name link to the same place. The first binding of a name wins.
 */
export function symbolRefs(markdown: string): Map<string, CodeRef> {
  const out = new Map<string, { at: number; ref: CodeRef }>();
  for (const re of PAIRS) {
    for (const m of markdown.matchAll(re)) {
      const name = m[1];
      if (!NAME_RE.test(name) || parseCodeRef(name)) continue;
      const ref = parseCodeRef(m[2]);
      if (!ref) continue;
      const prev = out.get(name);
      if (!prev || prev.at > m.index) out.set(name, { at: m.index, ref });
    }
  }
  return new Map([...out].map(([k, v]) => [k, v.ref]));
}

/**
 * A resolver over the box's file list: an exact path wins; otherwise a unique path-suffix match on
 * segment boundaries (`viz.ts` → `agent-sandbox/web/src/lib/viz.ts`). Ambiguous or missing → null.
 */
export function pathResolver(files: readonly string[]): (path: string) => string | null {
  const exact = new Set(files);
  const byBase = new Map<string, string[]>();
  for (const f of files) {
    const base = f.slice(f.lastIndexOf("/") + 1);
    const list = byBase.get(base);
    if (list) list.push(f);
    else byBase.set(base, [f]);
  }
  return (path) => {
    if (exact.has(path)) return path;
    const base = path.slice(path.lastIndexOf("/") + 1);
    const tail = "/" + path;
    const hits = (byBase.get(base) ?? []).filter((f) => f.endsWith(tail));
    return hits.length === 1 ? hits[0] : null;
  };
}

/** `path:line` / `path:from-to` as shown in tooltips. */
export const refLabel = (r: CodeRef) => r.path + (r.line ? `:${r.line}${r.endLine ? `-${r.endLine}` : ""}` : "");

/** A ref found inside plain prose, with its character span in the source text. */
export type ProseRef = { start: number; end: number; ref: CodeRef };
type LineHint = { line: number; endLine?: number };

const PATH = String.raw`${SEG}(?:/${SEG})*`;
const LOC = String.raw`(?::\d+(?:[-–]\d+)?(?::\d+)?|#L\d+(?:-L?\d+)?)`;
const LEFT = String.raw`(?<![^\s(\["'])`;
const RIGHT = String.raw`(?=[.,;:)\]"']*(?:\s|$))`;
const RANGE = String.raw`(\d+)(?:\s*(?:[-–]|to)\s*(\d+))?`;
const TRAIL = /[.,;:)\]"']+$/;

type Form = { re: RegExp; ref: (m: RegExpExecArray) => CodeRef | null };
const lineOf = (a: string, b?: string): LineHint => {
  const line = Number(a);
  const endLine = Number(b) || undefined;
  return { line, ...(endLine !== undefined && endLine > line && { endLine }) };
};
const looksLikeFile = (r: CodeRef) => r.line !== undefined || r.path.includes("/");
const FORMS: Record<"lineOfPath" | "pathLine" | "bareToken", Form> = {
  lineOfPath: {
    re: new RegExp(String.raw`(?<!\w)lines?\s+${RANGE}\s+(?:of|in)\s+(${PATH})${RIGHT}`, "gi"),
    ref: (m) => {
      const r = parseCodeRef(m[3].replace(TRAIL, ""));
      return r && { ...r, ...lineOf(m[1], m[2]) };
    },
  },
  pathLine: {
    re: new RegExp(String.raw`${LEFT}(${PATH})(?:,|\s+at)?\s+lines?\s+${RANGE}(?!\w)`, "gi"),
    ref: (m) => {
      const sentenceEndsBeforeLine = TRAIL.test(m[1]);
      if (sentenceEndsBeforeLine) return null;
      const r = parseCodeRef(m[1]);
      return r && { ...r, ...lineOf(m[2], m[3]) };
    },
  },
  bareToken: {
    re: new RegExp(String.raw`${LEFT}(${PATH}${LOC}?)${RIGHT}`, "g"),
    ref: (m) => {
      const token = m[1].replace(TRAIL, "");
      if (/^www\./i.test(token)) return null;
      const r = parseCodeRef(token);
      return r && looksLikeFile(r) ? r : null;
    },
  },
};

/**
 * Code refs inside a run of prose: whitespace-delimited `path(:line(-line)?)?` tokens (a path needs a
 * `/` or a line; trailing sentence punctuation is dropped) and the English forms `<path> line N`,
 * `<path> lines N-M`, `line N of <path>`, `lines N to M in <path>`. Every candidate goes through
 * parseCodeRef; the resolver, not this scanner, decides what is a real file. Non-overlapping,
 * ascending; on overlap the earlier start wins, then the longer match.
 */
export function findCodeRefs(text: string): ProseRef[] {
  const hits: ProseRef[] = [];
  for (const { re, ref } of Object.values(FORMS)) {
    for (const m of text.matchAll(re)) {
      const r = ref(m);
      if (!r) continue;
      const end = m.index + m[0].replace(TRAIL, "").length;
      hits.push({ start: m.index, end, ref: r });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ProseRef[] = [];
  for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
  return out;
}

/** `lines 3-5 of ` at the end of a text run: the path is whatever follows (an inline-code sibling). */
export function trailingLineHint(text: string): LineHint | null {
  const m = new RegExp(String.raw`(?<!\w)lines?\s+${RANGE}\s+(?:of|in)\s*$`, "i").exec(text);
  return m && lineOf(m[1], m[2]);
}

/** ` line 42` / `, line 42` / ` at lines 3-5` at the start of a text run: the path is what precedes it. */
export function leadingLineHint(text: string): LineHint | null {
  const m = new RegExp(String.raw`^[,\s]*(?:at\s+)?lines?\s+${RANGE}(?!\w)`, "i").exec(text);
  return m && lineOf(m[1], m[2]);
}
