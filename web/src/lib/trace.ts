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
  | { kind: "you"; text: string }
  | { kind: "tool"; name: string; arg?: string; result?: string; failed?: boolean };

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
// A user follow-up the resume path stamped into the log: everything between the open and close
// sentinel is the user's message. Keeping it in the log (not just browser state) is what makes the
// turn survive a refresh and sit in the right chronological place among the agent's output.
// The formatter (src/msb.ts ERR_MARK) stamps this on the first line of a tool_result the model
// reported as an error, so the UI can distinguish a failed call from a successful one.
const ERR_MARK = "⟦err⟧";
// Correlation token (src/msb.ts ID_OPEN/ID_CLOSE) carrying the tail of Claude's `tool_use.id`. It is
// stamped on the tool call line and on the first line of that call's result, so parallel tool use —
// one assistant message issuing several calls, whose results arrive together afterwards — attaches
// each result to its own call. Logs written by an older formatter carry no token; those fall back to
// "attach to the most recent tool", which is what they have always done.
const ID_OPEN = "⟦#";
const TOOL_ID_RE = /\s*⟦#([^⟧]+)⟧\s*/;
const YOU_OPEN = "⟦you⟧";
const YOU_CLOSE = "⟦/you⟧";

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

  // While inside a ⟦you⟧…⟦/you⟧ block we collect the user's message verbatim, so agent prose that
  // follows the close marker is never merged into the user's bubble.
  let you: string[] | null = null;

  // A log we are shown is a TAIL of the real one. When the cut lands inside a tool_result the block
  // arrives without its `→ Tool: arg` line, and every indented line of real command output would
  // otherwise fall through to `prose` and render as a wall of pseudo-prose — the shape that made a
  // 60-line command look like an unreadable blob. Adopting the orphan under an explicit placeholder
  // call keeps the content (nothing is swallowed) AND keeps it in a collapsible tool card, while
  // saying plainly that its call line is not in view. Only at the very TOP of the log: an indented
  // block anywhere else has a real tool above it, or is genuinely indented prose.
  const ORPHAN_TOOL_NAME = "output";
  const ORPHAN_TOOL_ARG = "tool call is above the start of this log";
  const adoptOrphan = (): Extract<TraceEvent, { kind: "tool" }> => {
    const ev: Extract<TraceEvent, { kind: "tool" }> = {
      kind: "tool",
      name: ORPHAN_TOOL_NAME,
      arg: ORPHAN_TOOL_ARG,
    };
    events.push(ev);
    return ev;
  };

  // tool_use id tail -> the tool event it belongs to, so a result block stamped with that id lands
  // on its own call even when several calls were issued in one message.
  const byId = new Map<string, Extract<TraceEvent, { kind: "tool" }>>();
  // The tool the CURRENT result block is being appended to. A block's id is stamped on its first
  // line only; the remaining lines belong to the same target.
  let target: Extract<TraceEvent, { kind: "tool" }> | null = null;

  for (const line of lines) {
    if (you !== null) {
      if (line.trim() === YOU_CLOSE) {
        events.push({ kind: "you", text: you.join("\n").trim() });
        you = null;
      } else {
        you.push(line);
      }
      continue;
    }
    if (line.trim() === YOU_OPEN) {
      flushProse();
      you = [];
      continue;
    }

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
      let arg = tool[2].trim();
      const id = arg.match(TOOL_ID_RE);
      if (id) arg = arg.replace(TOOL_ID_RE, " ").trim();
      const ev: Extract<TraceEvent, { kind: "tool" }> = { kind: "tool", name: tool[1], arg: arg || undefined };
      events.push(ev);
      if (id) byId.set(id[1], ev);
      target = null;
      continue;
    }

    // An indented line following a tool call (possibly across a blank line within the same result
    // block) is that call's output. The formatter prefixes every result line with exactly two
    // spaces, so strip two — not all leading whitespace — to preserve the result's own indentation
    // (diffs, JSON, code) instead of flattening it into an unreadable left-justified blob.
    const last = events[events.length - 1];
    const isResultLine = /^\s{2,}\S/.test(line) || (line.trim() === "" && !!target?.result);
    // Nothing at all before it and it is indented => the tail cut its call line off. Adopt it.
    const orphaned = isResultLine && events.length === 0 && prose.length === 0 && !target;
    if (orphaned) target = adoptOrphan();
    if (isResultLine && prose.length === 0 && (target || last?.kind === "tool")) {
      let body = line.replace(/^\s{2}/, "");
      // A result block's first line may carry the correlation token: route the whole block to the
      // call with that id. Unstamped blocks (old formatter) keep attaching to the most recent tool.
      const id = body.match(TOOL_ID_RE);
      if (id && body.trimStart().startsWith(ID_OPEN)) {
        body = body.replace(TOOL_ID_RE, "");
        target = byId.get(id[1]) ?? (last?.kind === "tool" ? last : target);
      } else if (!target) {
        target = last?.kind === "tool" ? last : null;
      }
      if (!target) {
        prose.push(line);
        continue;
      }
      // The formatter prefixes an errored tool_result's first line with the error sentinel. Strip it
      // and flag the call, so the UI can show the failure instead of printing a sentinel at the user.
      if (body.startsWith(ERR_MARK)) {
        target.failed = true;
        body = body.slice(ERR_MARK.length).trimStart();
      }
      target.result = target.result ? `${target.result}\n${body}` : body;
      continue;
    }

    target = null;
    prose.push(line);
  }
  // A ⟦you⟧ block still open at the end (log tail cut mid-message, or the close marker scrolled off):
  // emit what we have so the user's turn is never dropped.
  if (you !== null) {
    const text = you.join("\n").trim();
    if (text) events.push({ kind: "you", text });
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
  // First drop an exact repeated tail. The common shape is the WHOLE final block emitted twice
  // (streamed assistant text, then the run's `result` re-emit). Line-level dedupe cannot clean that
  // up: it drops the long lines but keeps every line under the threshold, so a duplicated markdown
  // summary degrades into a ghost second copy — a stray `## Summary`, a header-only 0-row table, and
  // a repeated fenced block. Removing the exact repeat first leaves the block intact.
  text = dropRepeatedTail(text);

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
 * A repeat shorter than this is not worth collapsing — a genuine short refrain ("Done.", a repeated
 * one-line heading) would be destroyed. The re-emitted `result` block is always substantial.
 */
const REPEAT_MIN_LEN = 80;

/**
 * If the text is some prefix followed by an EXACT repeat of its own tail, drop the repeat.
 *
 * The formatter writes assistant text as it streams and then writes the run's final `result`, which
 * is the same closing block verbatim. So the say ends `…X X` where X is the whole summary. Finding
 * the largest such X and dropping one copy restores the single, correctly-structured block.
 *
 * Implementation: for each candidate tail length we ask whether what comes BEFORE the tail already
 * ends with it. Both sides are trimmed at the boundary, so the blank line the formatter puts between
 * the two copies (and an odd total length) cannot misalign the comparison — an index-based
 * "second half of the trailing 2n chars" test silently fails on exactly those inputs.
 */
export function dropRepeatedTail(text: string): string {
  const t = text.trimEnd();
  // Longest candidate first: prefer collapsing the whole duplicated block over a short inner echo.
  for (let n = Math.floor(t.length / 2); n >= REPEAT_MIN_LEN; n--) {
    const tail = t.slice(t.length - n).trim();
    if (tail.length < REPEAT_MIN_LEN) continue;
    const head = t.slice(0, t.length - n).trimEnd();
    if (head.endsWith(tail)) return head;
  }
  return text;
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

/** A file the agent wrote/edited under /workspace, worth surfacing as a downloadable artifact. */
export interface ProducedFile {
  /** Path relative to /workspace, e.g. "report.md" — what /artifact?path= expects. */
  relPath: string;
  /** Just the basename, for the card title. */
  name: string;
}

// Tools whose headline argument is a filesystem path the agent CREATED or MODIFIED. Read/Grep/Glob
// only inspect, so they never make an artifact. `arg` for these is the path (see the formatter).
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const WORKSPACE_PREFIX = "/workspace/";

/**
 * Which files the agent produced under /workspace, derived purely from the trace's Write/Edit tool
 * calls (cheap, and exactly what the agent made — no directory listing needed). Only paths that
 * resolve literally inside /workspace are kept; a `..` segment or any other root is dropped here too,
 * so the card never even offers a path the backend would reject. De-duplicated by path, in first-seen
 * order, so editing the same file twice shows one card.
 */
export function producedFiles(events: TraceEvent[]): ProducedFile[] {
  const seen = new Set<string>();
  const out: ProducedFile[] = [];
  for (const e of events) {
    if (e.kind !== "tool" || !WRITE_TOOLS.has(e.name) || !e.arg) continue;
    // The arg may carry trailing prose after the path on some formatter lines; take the first token.
    const raw = e.arg.trim().split(/\s+/)[0];
    if (!raw.startsWith(WORKSPACE_PREFIX)) continue;
    const rel = raw.slice(WORKSPACE_PREFIX.length);
    if (!rel || rel.split("/").some((s) => s === ".." || s === ".")) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push({ relPath: rel, name: rel.split("/").pop() || rel });
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
