/**
 * Turn the raw agent log into a readable trace.
 *
 * The in-box agent runs `claude -p --output-format stream-json` piped through a formatter that
 * appends readable lines as work happens. That gives us a flat text stream shaped like:
 *
 *     ● session started (model ak-claude-opus-4.8)
 *     I'll write these one at a time. Starting with a.md.
 *     → Write: /workspace/a.md
 *       File created successfully at: /workspace/a.md
 *     a.md done. Now b.md.
 *
 * Rendering that verbatim in a monospace box is what the old dashboard did, and it reads like a
 * log because it *is* a log. Parsing it into speech / tool-call / result / lifecycle events lets the
 * agent's prose be prose, folds tool output away until asked for, and puts lifecycle moments on the
 * rail — which is the whole point of the trace layout.
 *
 * Dependency-free and pure so the server's `node:test` suite can cover it directly.
 */

export type TraceEvent =
  | { kind: "lifecycle"; label: string; detail?: string }
  | { kind: "say"; text: string }
  | { kind: "tool"; name: string; arg?: string; result?: string };

// Written as explicit \u escapes: a literal ESC byte in source is invisible to a reviewer.
const ESC = "\u001b";
const BEL = "\u0007";
const ANSI_RE = new RegExp(
  [
    ESC + "\\[[0-9;?]*[ -/]*[@-~]",
    ESC + "\\][^" + BEL + "]*(?:" + BEL + "|" + ESC + "\\\\)",
    ESC + "[=>PX^_].*?(?:" + ESC + "\\\\|" + BEL + ")",
  ].join("|"),
  "g"
);
const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** Strip escape sequences and carriage-return spinner rewrites. */
export function clean(raw: string): string {
  return String(raw ?? "")
    .replace(ANSI_RE, "")
    .replace(/[^\n]*\r(?!\n)/g, "")
    .replace(CTRL_RE, "");
}

/** `● session started (model X)` and friends — the formatter's own markers. */
const MARKER_RE = /^●\s*(.+)$/;
/** `→ Write: /workspace/a.md` / `→ Bash: npm test` — a tool call with its headline argument. */
const TOOL_RE = /^→\s*([A-Za-z_][\w-]*)\s*:?\s*(.*)$/;

/**
 * Parse a log into trace events. Consecutive prose lines coalesce into one `say`; indented lines
 * following a tool call are that call's result.
 */
export function parseTrace(rawLog: string): TraceEvent[] {
  const lines = clean(rawLog).split("\n");
  const events: TraceEvent[] = [];
  let prose: string[] = [];

  const flushProse = () => {
    const text = dedupeParagraphs(prose.join("\n").trim());
    if (text) events.push({ kind: "say", text });
    prose = [];
  };

  for (const line of lines) {
    const marker = line.match(MARKER_RE);
    if (marker) {
      flushProse();
      const body = marker[1].trim();
      // "session started (model X)" -> label "session started", detail "model X"
      const withDetail = body.match(/^(.*?)\s*\((.+)\)\s*$/);
      events.push(
        withDetail
          ? { kind: "lifecycle", label: withDetail[1].trim(), detail: withDetail[2].trim() }
          : { kind: "lifecycle", label: body }
      );
      continue;
    }

    const tool = line.match(TOOL_RE);
    if (tool) {
      flushProse();
      const arg = tool[2].trim();
      events.push({ kind: "tool", name: tool[1], arg: arg || undefined });
      continue;
    }

    // An indented line directly after a tool call is that call's output.
    const last = events[events.length - 1];
    if (/^\s{2,}\S/.test(line) && prose.length === 0 && last?.kind === "tool") {
      const body = line.replace(/^\s+/, "");
      last.result = last.result ? `${last.result}\n${body}` : body;
      continue;
    }

    prose.push(line);
  }
  flushProse();
  return dedupe(events);
}

/**
 * Drop a paragraph that already appeared earlier in the same block.
 *
 * The formatter streams assistant text and then re-emits the run's final result. With no tool call
 * between them the two runs of text coalesce into one `say`, so block-level dedupe cannot see it —
 * the repetition is *inside* the block. Only substantial paragraphs are considered: short lines like
 * "done." or "ok" legitimately recur and must not be collapsed.
 */
const DEDUPE_MIN_LEN = 40;

export function dedupeParagraphs(text: string): string {
  // Line-level, not paragraph-level. The re-emitted copy does not respect blank-line boundaries:
  // in real output the tail of the first copy and the head of the second share a paragraph, so
  // splitting on blank lines never finds a matching pair. Lines do match.
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const key = line.trim();
    if (key.length >= DEDUPE_MIN_LEN) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Drop a `say` that repeats the one before it.
 *
 * The in-box formatter emits assistant text as it streams AND re-emits the final result text at the
 * end, so a run's closing summary legitimately appears twice in the log. Faithfully rendering both
 * looks like a rendering bug to anyone reading the thread.
 */
function dedupe(events: TraceEvent[]): TraceEvent[] {
  const out: TraceEvent[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (e.kind === "say" && prev?.kind === "say" && prev.text.trim() === e.text.trim()) continue;
    out.push(e);
  }
  return out;
}

/** First line of a tool result, for the collapsed summary row. */
export function resultSummary(result: string | undefined, max = 100): string | undefined {
  if (!result) return undefined;
  const first = result.split("\n").find((l) => l.trim());
  if (!first) return undefined;
  const t = first.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
