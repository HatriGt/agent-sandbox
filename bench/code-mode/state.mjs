// Per-run write log shared by the bench's fake servers. box-run.mjs writes the log's path to
// /root/bench/current-log before each run (runs are sequential); every write or injected failure
// is appended there as one JSON line. A server process replays the log at start, so a follow-up
// turn (`claude -c`, new processes) sees the writes of the first turn. With no pointer file
// (unit tests, the host) nothing is logged and the servers start from data.mjs.
import { appendFileSync, readFileSync } from "node:fs";

const PTR = process.env.BENCH_LOG_PTR || "/root/bench/current-log";

export const LOG = (() => {
  try {
    return readFileSync(PTR, "utf8").trim();
  } catch {
    return "";
  }
})();

/** Every entry of a log file (default: this run's), oldest first. */
export function readLog(file = LOG) {
  if (!file) return [];
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function log(entry) {
  if (LOG) appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

/** The labels/status/priority/assignee each issue ends with after the log's successful update_issue calls. */
export function applyUpdates(issues, entries) {
  const byId = new Map(issues.map((i) => [i.id, { ...i, labels: [...i.labels], assignee: { ...i.assignee } }]));
  for (const e of entries) {
    if (e.server !== "tracker" || e.tool !== "update_issue" || !e.ok) continue;
    const i = byId.get(Number(e.args.id));
    if (!i) continue;
    if (e.args.status) i.status = e.args.status;
    if (e.args.priority) i.priority = e.args.priority;
    if (e.args.labels) i.labels = [...e.args.labels];
    if (e.args.assignee_id) i.assignee = { id: e.args.assignee_id };
  }
  return byId;
}
