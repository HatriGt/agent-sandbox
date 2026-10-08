/**
 * Unified-diff parsing for the file pane. Turns `git diff` output into hunks of typed lines with old
 * and new line numbers, ready to render as a two-gutter diff. Pure; covered by the server test suite.
 */
export type DiffLineKind = "context" | "add" | "del" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  binary: boolean;
}

export function parseUnifiedDiff(text: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let additions = 0;
  let deletions = 0;
  const binary = /^Binary files/m.test(text);
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) {
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      cur = { header: h[3].trim(), lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue; // file headers (diff --git, index, ---, +++)
    if (raw.startsWith("\\ No newline")) {
      cur.lines.push({ kind: "meta", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      cur.lines.push({ kind: "add", text: raw.slice(1), newNo: newNo++ });
      additions++;
    } else if (raw.startsWith("-")) {
      cur.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++ });
      deletions++;
    } else if (raw.startsWith(" ") || raw === "") {
      if (raw === "" && cur.lines.length === 0) continue;
      cur.lines.push({ kind: "context", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return { hunks, additions, deletions, binary };
}

/** A whole file rendered as one all-added hunk (untracked / new files have no git diff). */
export function diffForNewFile(content: string): ParsedDiff {
  const lines = content.replace(/\r/g, "").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return {
    hunks: [{ header: "new file", lines: lines.map((text, i) => ({ kind: "add", text, newNo: i + 1 })) }],
    additions: lines.length,
    deletions: 0,
    binary: false,
  };
}

/** One file's section of a multi-file `git diff`, parsed — the Review-all panel's unit. */
export interface DiffSection {
  path: string;
  diff: ParsedDiff;
}

/** Split a concatenated multi-file `git diff` into per-file parsed sections. Pure. */
export function splitUnifiedDiff(text: string): DiffSection[] {
  const out: DiffSection[] = [];
  for (const part of text.split(/^(?=diff --git )/m)) {
    const m = part.match(/^diff --git a\/.*? b\/(.*)$/m);
    if (!m) continue;
    out.push({ path: m[1], diff: parseUnifiedDiff(part) });
  }
  return out;
}

/**
 * Serialise one parsed hunk back into unified-diff text (an `@@` header rebuilt from the line
 * numbers, then the lines with their `+`/`-`/` ` prefixes) — what /discard.json reverse-applies.
 * The server prepends its own `---`/`+++` file header, so none is emitted here. Pure.
 */
export function hunkToPatch(hunk: DiffHunk): string {
  const oldNos = hunk.lines.filter((l) => l.oldNo != null);
  const newNos = hunk.lines.filter((l) => l.newNo != null);
  const oldStart = oldNos[0]?.oldNo ?? (newNos[0]?.newNo ?? 1);
  const newStart = newNos[0]?.newNo ?? (oldNos[0]?.oldNo ?? 1);
  const head = `@@ -${oldStart},${oldNos.length} +${newStart},${newNos.length} @@${hunk.header ? ` ${hunk.header}` : ""}`;
  const body = hunk.lines.map((l) => (l.kind === "meta" ? l.text : (l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text));
  return [head, ...body].join("\n") + "\n";
}

/**
 * A stable identity for a hunk — its position plus a hash of its content — so a reviewed mark
 * persisted in sessionStorage survives the pane reopening AND stays attached to the right hunk after
 * a neighbour is rejected (indexes shift; content does not). Pure.
 */
export function hunkId(hunk: DiffHunk): string {
  let h = 5381;
  for (const l of hunk.lines) {
    const s = l.kind[0] + l.text;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  const first = hunk.lines.find((l) => l.newNo != null)?.newNo ?? hunk.lines.find((l) => l.oldNo != null)?.oldNo ?? 0;
  return `${first}:${h.toString(36)}`;
}

/** A changed span inside one line, as [from, to) character offsets. */
export type Span = [number, number];

/**
 * Word-level changes between a deleted line and the added line that replaced it, so a one-word edit
 * highlights the word instead of tinting two whole lines. Common prefix and suffix are stripped, then
 * the middle is aligned with a word-token LCS; when the middle is too big to align cheaply, the whole
 * middle counts as changed. Pure.
 */
export function inlineChanges(a: string, b: string): { a: Span[]; b: Span[] } {
  let pre = 0;
  const max = Math.min(a.length, b.length);
  while (pre < max && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  // Snap to word boundaries: "alpha" → "omega" should highlight whole words, not "alph" / "omeg".
  const w = (c: string | undefined) => !!c && /\w/.test(c);
  while (pre > 0 && w(a[pre - 1]) && (w(a[pre]) || w(b[pre]))) pre--;
  while (suf > 0 && w(a[a.length - suf]) && (w(a[a.length - suf - 1]) || w(b[b.length - suf - 1]))) suf--;
  const ma = a.slice(pre, a.length - suf);
  const mb = b.slice(pre, b.length - suf);
  if (!ma && !mb) return { a: [], b: [] };
  const ta = tokens(ma);
  const tb = tokens(mb);
  if (ta.length * tb.length > 40_000) return { a: ma ? [[pre, a.length - suf]] : [], b: mb ? [[pre, b.length - suf]] : [] };
  // LCS table over tokens; then walk back to mark the tokens that are NOT part of the common sequence.
  const n = ta.length;
  const m = tb.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ta[i] === tb[j]) {
      keepA[i++] = true;
      keepB[j++] = true;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { a: spans(ta, keepA, pre), b: spans(tb, keepB, pre) };
}

function tokens(s: string): string[] {
  return s.match(/\w+|\s+|[^\w\s]/g) ?? [];
}

/** Merge runs of unkept tokens into character spans, offset by the stripped prefix length. */
function spans(toks: string[], keep: boolean[], offset: number): Span[] {
  const out: Span[] = [];
  let pos = offset;
  for (let i = 0; i < toks.length; i++) {
    const end = pos + toks[i].length;
    if (!keep[i]) {
      const last = out[out.length - 1];
      if (last && last[1] === pos) last[1] = end;
      else out.push([pos, end]);
    }
    pos = end;
  }
  // Whitespace-only spans between two changed words are noise; but a whitespace-only change IS a change.
  return out;
}

/**
 * Pair deleted lines with the added lines that replaced them: within each `-` run followed by a `+`
 * run, the i-th deletion partners the i-th addition. Returns partner indexes into `lines`; unpaired
 * lines are absent. Pure.
 */
export function pairChangedLines(lines: DiffLine[]): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind !== "del") {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === "del") j++;
    let k = j;
    while (k < lines.length && lines[k].kind === "add") k++;
    const pairs = Math.min(j - i, k - j);
    for (let p = 0; p < pairs; p++) {
      out.set(i + p, j + p);
      out.set(j + p, i + p);
    }
    i = k;
  }
  return out;
}
