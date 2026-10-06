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
