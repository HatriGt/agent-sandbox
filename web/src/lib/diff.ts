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
