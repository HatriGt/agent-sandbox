/**
 * The driver-independent log grammar and in-box channel paths (plan workstream A, step 3). Every
 * driver's formatter writes THIS grammar into `.agent.log`; src/trace.ts and the dashboard parse it
 * without knowing which agent produced it. Moved verbatim out of src/msb.ts, which re-exports it.
 */

// The agent writes a plain-text QUESTION here when it needs a decision/answer to continue, then
// finishes the run. `status` surfaces it as "waiting"; `resume` clears it and feeds back the answer.
export const QUESTION_MARK = "/workspace/.agent.question";

/**
 * Marks a tool result the model reported as an error (`is_error`). The trace parser strips it and
 * flags the tool call as failed, so a command that errored does not read as a normal success.
 */
export const ERR_MARK = "⟦err⟧";

/**
 * Correlation token wrapping the last 8 chars of a `tool_use.id`. Stamped on both the `→ Tool: arg`
 * line and the tool_result block so the parser pairs each result with ITS OWN call under parallel
 * tool use. Stripped before display, exactly like ERR_MARK; logs without it fall back to the
 * historical "attach to the most recent tool" behaviour.
 */
export const ID_OPEN = "⟦#";
export const ID_CLOSE = "⟧";

/**
 * Prefixes a PARTIAL tool result: output a still-running tool has produced so far (omp's
 * `tool_execution_update`). Chunks append to the call's result and keep it `streaming`; the final
 * id-stamped result block replaces them. PARTIAL_RESET means "replace what you have" — the tool's
 * rolling output window moved, so the new chunk is not a continuation.
 */
export const PARTIAL_MARK = "⟦…⟧";
export const PARTIAL_RESET = "⟦…!⟧";

/**
 * How much of a tool_result survives into .agent.log.
 *
 * The tail a formatter drops is gone for good — the raw stream-json is never persisted, so the UI
 * can never recover it. At 20 lines an ordinary `printf` of 60 lines, or a burst of parallel Bash
 * calls each printing 40, lost most of their real output while still looking complete-ish. 400 lines
 * covers essentially every real command (test runs, diffs, listings) at roughly 30KB of log.
 *
 * The byte cap is the actual protection: a `cat` of a minified bundle is few lines but megabytes,
 * and .agent.log is re-read in full on every SSE poll, so bytes — not lines — are what bloat the
 * stream. 64KB per result keeps a pathological dump bounded without touching realistic output.
 * A single absurdly long line is clipped on its own so one 10MB line cannot blow the budget alone.
 */
export const RESULT_MAX_LINES = 400;
export const RESULT_MAX_BYTES = 65536;
export const RESULT_MAX_LINE_CHARS = 4000;

/** Sentinels for extended-thinking and plan (TodoWrite) blocks in the log; the trace parser folds them. */
export const THINK_OPEN = "⟦think⟧";
export const THINK_CLOSE = "⟦/think⟧";
export const PLAN_OPEN = "⟦plan⟧";
export const PLAN_CLOSE = "⟦/plan⟧";

/**
 * Per-edit diff blocks: an Edit/Write/MultiEdit/NotebookEdit's content used to be dropped entirely
 * (only the path survived as the headline arg), so the transcript could not show WHAT changed.
 * The formatter now writes a ⟦diff⟧…⟦/diff⟧ block after the tool line — `-` old lines / `+` new
 * lines — and the trace parser attaches it to the tool event. Capped: the point is a glanceable
 * review of the change, not a byte-faithful archive (the end-of-run diff covers that).
 */
export const DIFF_OPEN = "⟦diff⟧";
export const DIFF_CLOSE = "⟦/diff⟧";

/**
 * Turn-end token usage, previously dropped on the floor: `⟦usage⟧ in=N out=N ctx=N`. `in`/`out` are
 * the turn's cumulative totals from the `result` frame (input + cache reads + cache writes); `ctx`
 * is the last request's context footprint — the "how full is the window" number the dashboard's
 * context-health meter reads. One line per turn; the trace parser folds it into a `usage` event.
 */
export const USAGE_OPEN = "⟦usage⟧";

/**
 * Wall-clock stamp: a column-0 `⟦at⟧ <epoch ms>` line written just before an assistant text block, a
 * tool call row, a tool result block and a ⟦you⟧ follow-up. The log had no clock of its own, so the
 * transcript could not say WHEN something was said or how long a command took; the parser carries
 * the latest stamp onto the next event and derives a tool's duration as result stamp − call stamp.
 * Logs written before this simply carry no stamps and render exactly as before.
 */
export const AT_MARK = "⟦at⟧";
/** A user follow-up recorded as a first-class turn in the log (web/src/lib/trace.ts emits `you`). */
export const YOU_MARK_OPEN = "⟦you⟧";
export const YOU_MARK_CLOSE = "⟦/you⟧";
export const DIFF_MAX_LINES = 200;
export const DIFF_MAX_BYTES = 16384;

export const AGENT_LOG = "/workspace/.agent.log";

/**
 * Memory across runs (src/memory-store.ts) — the `remember` grammar, shared by the controller's
 * parser and the in-box `memory` tool (src/drivers/memory-tool.ts) so both sides agree on it:
 *
 *   <!-- remember: <kind> | <text> [| area: <part/subpart>] [| paths: a, b] [| links: <area>, …] [| why: <text>] [| replaces: "<old note text>"] -->
 *
 * One note per line, several blocks allowed, anywhere in the run (the harvest is incremental). A
 * line without a kind tag is a `fact` — the Phase 2 grammar, still valid. A playbook may continue
 * on indented lines (its steps). The marker is an HTML comment so it is invisible when the agent's
 * prose is rendered as Markdown, like `watch:` and `automate:`.
 */
export const MEMORY_KINDS = ["preference", "rule", "domain", "fact", "decision", "lesson", "playbook"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const REMEMBER_OPEN = "<!-- remember:";
export const REMEMBER_CLOSE = "-->";
/** Matches each block; group 1 is the body (one note per line). */
export const REMEMBER_RE = /<!--\s*remember:\s*([\s\S]*?)-->/g;
/** The optional leading `<kind> |` of a note line; group 1 is the kind. */
export const REMEMBER_KIND_RE = new RegExp(`^(${MEMORY_KINDS.join("|")})\\s*\\|\\s*`, "i");
/** Splits the `| why:` / `| replaces:` / `| area:` / `| paths:` / `| links:` fields off a note (the text itself may contain `|`). */
export const REMEMBER_FIELD_RE = /\s*\|\s*(?=(?:why|replaces|area|paths|links|repo)\s*:)/i;
/** Every field a note line may carry after its text. */
export const REMEMBER_FIELDS = ["why", "replaces", "area", "paths", "links", "repo"] as const;

/** Where the dashboard-configured MCP servers are written inside the box for `claude --mcp-config`. */
export const MCP_CONFIG_PATH = "/root/.agent-mcp.json";

/**
 * The thread's model-provider env (src/providers.ts), `export K='v'` lines, mode 600. Outside
 * /workspace so it never lands in a diff or a checkpoint; sourced by every turn (agentSh).
 */
export const PROVIDER_ENV_PATH = "/root/.agent-provider.env";
