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
}

const POOL_PREFIX = "pool-";

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

/** Extract uptime/cpu/mem from a `msb metrics` table (best-effort; returns {} if unparseable). */
export function parseMetrics(stdout: string): { uptime?: string; cpu?: string; mem?: string } {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  // Data row is the one that isn't the header (header starts with "NAME").
  const dataRow = lines.find((l) => !/^NAME\b/.test(l));
  if (!dataRow) return {};
  // Columns: NAME STATE CPU("a / bc") MEM("x U / y U") DISK("a / b") NET("a / b") UPTIME
  // Split on 2+ spaces to keep the "a / b" cells intact.
  const cols = dataRow.split(/\s{2,}/);
  // cols[0]=name cols[1]=state cols[2]=cpu cols[3]=mem cols[4]=disk cols[5]=net cols[6]=uptime
  return {
    cpu: cols[2],
    mem: cols[3],
    uptime: cols[cols.length - 1],
  };
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

/**
 * Render the fleet report: a summary line, then one block per box. Sessions first (most
 * interesting), then claimed pool, then free pool. Sorted stably by name within each group.
 */
export function formatMonitor(views: BoxView[]): string {
  if (views.length === 0) return "No sandboxes are up.";

  const order: Record<BoxRole, number> = {
    session: 0,
    "pool-claimed": 1,
    "pool-free": 2,
  };
  const sorted = [...views].sort(
    (a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name)
  );

  const sessions = views.filter((v) => v.role === "session" || v.role === "pool-claimed").length;
  const poolFree = views.filter((v) => v.role === "pool-free").length;
  const waiting = views.filter((v) => v.runState === "waiting").length;
  const running = views.filter((v) => v.runState === "running").length;

  const summary =
    `${views.length} sandbox(es) up — ${sessions} session(s), ${poolFree} warm pool free. ` +
    `${running} running, ${waiting} waiting for an answer.`;

  const blocks = sorted.map((v) => {
    const lines = [
      `• ${v.name}  [${roleLabel(v.role)}]  ${runLabel(v)}` +
        (v.uptime ? `  up ${v.uptime}` : ""),
    ];
    if (v.cpu || v.mem) lines.push(`    cpu ${v.cpu ?? "?"} · mem ${v.mem ?? "?"}`);
    if (v.task) lines.push(`    task: ${v.task}`);
    if (v.runState === "waiting" && v.question) lines.push(`    question: ${v.question}`);
    return lines.join("\n");
  });

  return `${summary}\n\n${blocks.join("\n")}`;
}
