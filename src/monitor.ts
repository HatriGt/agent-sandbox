/**
 * Fleet monitor — pure shaping/formatting for "how many sandboxes are up and what each is doing".
 *
 * The IO (msb ls / per-box sentinel + metrics reads) lives in msb.ts (gatherMonitor); everything
 * here is pure so it's unit-testable: parse `msb ls --format json`, classify each box by name, and
 * render a compact human report with a summary line.
 */

/** A sandbox's role, derived purely from its name prefix + claim marker. */
export type BoxRole = "pool-free" | "pool-claimed" | "session";

/** Run state of the in-box agent, from the sentinels (mirrors status/agentProgress). */
export type RunState = "running" | "waiting" | "done" | "idle";

/** One row of `msb ls --format json`. */
export interface LsEntry {
  name: string;
  status: string; // "Running" | "Stopped" | ...
  image?: string;
  created_at?: string;
}

/** Per-box view assembled from ls + in-box sentinels + metrics. */
export interface BoxView {
  name: string;
  role: BoxRole;
  /** msb-level lifecycle (running/stopped) — distinct from the agent runState. */
  boxStatus: string;
  runState: RunState;
  /** exit code when runState==="done", else undefined. */
  exitCode?: number;
  /** The task the box is working on (from /workspace/.agent.task), trimmed to one line. */
  task?: string;
  /** The pending question when runState==="waiting". */
  question?: string;
  /** Human uptime string from `msb metrics` (e.g. "43m18s"), best-effort. */
  uptime?: string;
  /** CPU string from metrics (e.g. "0.00 / 1c"), best-effort. */
  cpu?: string;
  /** MEM string from metrics (e.g. "63.4 MiB / 1.0 GiB"), best-effort. */
  mem?: string;
  /** Unix seconds of the agent log's last write — when the agent last produced output. Best-effort. */
  lastOutputAt?: number;
  /** Follow-ups queued by the dashboard while the agent was mid-turn; delivered when it finishes. */
  queued?: string[];
  /** Repositories checked out under /workspace (dir name + current branch). */
  repos?: RepoRef[];
  /** Pinned by the operator: never reaped while asleep; only Destroy removes it. */
  kept?: boolean;
}

export interface RepoRef {
  name: string;
  branch?: string;
}

/**
 * Parse an msb duration flag ("15m", "1h", "90s", "1h30m", "2d") into seconds. Returns undefined for
 * anything it does not understand, so a misconfigured value degrades to "unknown" rather than 0.
 */
export function parseDurationSec(raw: string | undefined): number | undefined {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (/^\d+$/.test(s)) return Number(s);
  const re = /(\d+(?:\.\d+)?)\s*(d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === "d" ? n * 86400 : m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : n;
  }
  return matched ? Math.round(total) : undefined;
}

/** `msb metrics` uptime ("43m18s", "1h02m03s", "2d1h") → seconds. Same grammar as the flags. */
export function parseUptimeSec(raw: string | undefined): number | undefined {
  return parseDurationSec(raw?.replace(/^ran\s+/, ""));
}

const POOL_PREFIX = "pool-";

/** True when the box's msb lifecycle status means it's actually running (vs stopped/exited). */
export function isRunning(boxStatus: string): boolean {
  return /^running$/i.test(boxStatus.trim());
}

/** Parse `msb ls --format json`; tolerant of empty/garbage output (returns []). */
export function parseLsJson(stdout: string): LsEntry[] {
  const s = stdout.trim();
  if (!s) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      name: String(e.name ?? ""),
      status: String(e.status ?? ""),
      image: e.image != null ? String(e.image) : undefined,
      created_at: e.created_at != null ? String(e.created_at) : undefined,
    }))
    .filter((e) => e.name);
}

/** Classify a box by name + whether it's been claimed (only meaningful for pool boxes). */
export function classifyBox(name: string, claimed: boolean): BoxRole {
  if (name.startsWith(POOL_PREFIX)) return claimed ? "pool-claimed" : "pool-free";
  return "session";
}

/** Parse the `run:*` sentinel line into a state + optional exit code. */
export function parseRunState(runLine: string): { state: RunState; exitCode?: number } {
  const l = runLine.trim();
  if (l.startsWith("run:running")) return { state: "running" };
  if (l.startsWith("run:waiting")) return { state: "waiting" };
  if (l.startsWith("run:done")) {
    const m = l.match(/exit=(-?\d+)/);
    return { state: "done", exitCode: m ? Number(m[1]) : undefined };
  }
  return { state: "idle" };
}

/** Parsed `msb metrics` row (best-effort). */
export interface Metrics {
  /** msb's own STATE column (running / exited / …), lowercased. */
  state?: string;
  cpu?: string;
  mem?: string;
  uptime?: string;
}

/**
 * Extract state/cpu/mem/uptime from a `msb metrics` table by HEADER COLUMN POSITIONS, not by
 * naive delimiter splitting. Blind 2+-space splitting breaks on real rows: an exited box shows an
 * em-dash CPU, the DISK/NET cells contain the word "total", and uptime reads "ran 59m59s". Slicing
 * each cell at its header's start offset (to the next header's offset) is robust to all of that.
 * Returns {} when there's no data row.
 */
export function parseMetrics(stdout: string): Metrics {
  const lines = stdout.split("\n").filter((l) => l.trim());
  const header = lines.find((l) => /^\s*NAME\b/.test(l));
  const dataRow = lines.find((l) => !/^\s*NAME\b/.test(l));
  if (!header || !dataRow) return {};

  // Column start offsets from the header labels (order as emitted by msb).
  const at = (label: string) => header.indexOf(label);
  type Col = { key: keyof Metrics | "skip"; start: number };
  const cols: Col[] = (
    [
      { key: "skip", start: at("NAME") },
      { key: "state", start: at("STATE") },
      { key: "cpu", start: at("CPU") },
      { key: "mem", start: at("MEM") },
      { key: "skip", start: at("DISK") },
      { key: "skip", start: at("NET") },
      { key: "uptime", start: at("UPTIME") },
    ] as Col[]
  ).filter((c) => c.start >= 0);

  const out: Metrics = {};
  for (let i = 0; i < cols.length; i++) {
    const { key, start } = cols[i];
    if (key === "skip") continue;
    const end = i + 1 < cols.length ? cols[i + 1].start : dataRow.length;
    const cell = dataRow.slice(start, end).trim();
    if (!cell) continue;
    if (key === "state") out.state = cell.toLowerCase();
    else if (key === "cpu") out.cpu = normalizeCpu(cell);
    else if (key === "mem") out.mem = cell;
    else if (key === "uptime") out.uptime = cell.replace(/^ran\s+/, "");
  }
  return out;
}

/** An em-dash (or empty) CPU means "no sample" (box not running) → undefined, not a literal dash. */
function normalizeCpu(cell: string): string | undefined {
  const c = cell.trim();
  if (!c || c === "\u2014" || c === "-") return undefined;
  return c;
}

// ----- watch: a live over-the-shoulder view of ONE box -----------------------------------------

/** Everything the watch view shows for a single box (assembled by gatherWatch in msb.ts). */
export interface WatchSnapshot {
  name: string;
  /** msb lifecycle: running / stopped (may be "missing" if the box is gone). */
  boxStatus: string;
  runState: RunState;
  exitCode?: number;
  task?: string;
  question?: string;
  uptime?: string;
  cpu?: string;
  mem?: string;
  /** The log tail (already limited to N lines by the caller). */
  log: string;
}

/**
 * Render the watch view: a compact header (state · task · resources) then the log tail. Designed to
 * be redrawn in place by the CLI every couple seconds, so it leads with the one line that changes
 * meaning most — the run state — and flags WAITING loudly since that needs a human/agent to answer.
 */
export function formatWatch(s: WatchSnapshot): string {
  if (s.boxStatus === "missing") return `Box ${s.name} is gone (torn down or never existed).`;

  const stateLine =
    s.runState === "waiting"
      ? "⏸  WAITING — the agent asked a question and needs an answer (resume to continue)"
      : s.runState === "running"
        ? "▶  running"
        : s.runState === "done"
          ? `■  done (exit=${s.exitCode ?? "?"})`
          : "·  idle";

  const res = [s.uptime && `up ${s.uptime}`, s.cpu && `cpu ${s.cpu}`, s.mem && `mem ${s.mem}`]
    .filter(Boolean)
    .join(" · ");

  const header = [
    `┌─ ${s.name}  (${s.boxStatus})`,
    `│ ${stateLine}`,
    s.task ? `│ task: ${s.task}` : undefined,
    s.question ? `│ question: ${s.question}` : undefined,
    res ? `│ ${res}` : undefined,
    `└─ log ─────────────────────────────────────────`,
  ]
    .filter(Boolean)
    .join("\n");

  return `${header}\n${s.log || "(no output yet)"}`;
}

/** One-line-per-box label used in the report. */
function roleLabel(role: BoxRole): string {
  switch (role) {
    case "pool-free":
      return "pool(free)";
    case "pool-claimed":
      return "session(pool)";
    case "session":
      return "session";
    default: {
      const _never: never = role;
      return _never;
    }
  }
}

function runLabel(v: BoxView): string {
  switch (v.runState) {
    case "running":
      return "running";
    case "waiting":
      return "WAITING(needs answer)";
    case "done":
      return `done exit=${v.exitCode ?? "?"}`;
    case "idle":
      return "idle";
    default: {
      const _never: never = v.runState;
      return _never;
    }
  }
}

function boxBlock(v: BoxView): string {
  const lines = [
    `• ${v.name}  [${roleLabel(v.role)}]  ${runLabel(v)}` + (v.uptime ? `  up ${v.uptime}` : ""),
  ];
  if (v.cpu || v.mem) lines.push(`    cpu ${v.cpu ?? "?"} · mem ${v.mem ?? "?"}`);
  if (v.task) lines.push(`    task: ${v.task}`);
  if (v.runState === "waiting" && v.question) lines.push(`    question: ${v.question}`);
  return lines.join("\n");
}

/**
 * Render the fleet report. Only RUNNING boxes count as "up" (a stopped/auto-torn-down box no longer
 * consumes resources and can't be doing anything). Running boxes are listed first — sessions, then
 * claimed pool, then free pool — followed by a compact one-line note for any stopped boxes so you
 * still know they exist without inflating the "up" count.
 */
export function formatMonitor(views: BoxView[]): string {
  const running = views.filter((v) => isRunning(v.boxStatus));
  const stopped = views.filter((v) => !isRunning(v.boxStatus));

  if (running.length === 0) {
    const tail = stopped.length ? ` (${stopped.length} stopped box(es) present)` : "";
    return `No sandboxes are up.${tail}`;
  }

  const order: Record<BoxRole, number> = { session: 0, "pool-claimed": 1, "pool-free": 2 };
  const sorted = [...running].sort(
    (a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name)
  );

  const sessions = running.filter((v) => v.role === "session" || v.role === "pool-claimed").length;
  const poolFree = running.filter((v) => v.role === "pool-free").length;
  const waiting = running.filter((v) => v.runState === "waiting").length;
  const active = running.filter((v) => v.runState === "running").length;

  const summary =
    `${running.length} sandbox(es) up — ${sessions} session(s), ${poolFree} warm pool free. ` +
    `${active} running, ${waiting} waiting for an answer.`;

  const blocks = sorted.map(boxBlock);
  let out = `${summary}\n\n${blocks.join("\n")}`;
  if (stopped.length) {
    out += `\n\nstopped (${stopped.length}): ${stopped.map((v) => v.name).join(", ")}`;
  }
  return out;
}
