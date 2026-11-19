/**
 * Threads: the durable unit of work. A box is a holder of files and a running agent; it sleeps,
 * dies, gets reaped, is rebuilt. The THREAD — who asked for what, the transcript, the agent's
 * session, the workspace as of the last turn — is what the person comes back for the next day, and
 * it lives on the controller, never only in the box.
 *
 *   · `threads` (SQLite): one row per thread, keyed by the box name (the URL never changes). Written
 *     from every fleet sweep (owner, task, title, host, run state, question, repos, kept, when the
 *     box was last seen) and marked deleted only by a deliberate teardown. The fleet lists a thread
 *     whose box the hosts do not show from this row: as asleep when its host did not answer, as
 *     AWAY (`absent`) when the box is really gone and a copy of the thread is kept.
 *   · `<dataDir>/threads/<id>/transcript.log`: a copy of the box's `/workspace/.agent.log`, grown by
 *     appends every sweep while the box runs and at every turn end, so the conversation is readable
 *     with the box asleep, gone, or on a host that is paused — and so a crash mid-turn loses at most
 *     the last few seconds of words.
 *   · the rescue copy (src/rescue.ts): the workspace and the agent's session as of the last turn,
 *     which is what a fresh box needs to continue the SAME session.
 *
 * Opening or replying to an away thread brings its machine back from the copy (http.ts bringBack);
 * nobody has to know a box died.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { BoxView, RepoRef, RunState } from "./monitor.js";
import type { RunMeta } from "./run-memory.js";
import { assertBoxName } from "./sync.js";

/** The agent's transcript inside a box (src/msb.ts AGENT_LOG). */
const BOX_LOG = "/workspace/.agent.log";

export interface ThreadRow {
  id: string;
  owner: string | null;
  title: string | null;
  task: string | null;
  agent: string | null;
  host: string | null;
  role: "session" | "pool-claimed";
  run_state: RunState;
  exit_code: number | null;
  question: string | null;
  repos_json: string | null;
  kept: number;
  /** What the hosts last said about the box: running / stopped / absent / unknown (never seen). */
  box_status: string;
  box_seen_at: number | null;
  last_turn_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface ThreadUpsert {
  id: string;
  owner?: string | null;
  title?: string | null;
  task?: string | null;
  agent?: string | null;
  host?: string | null;
  role?: "session" | "pool-claimed";
  runState?: RunState;
  exitCode?: number | null;
  question?: string | null;
  repos?: RepoRef[] | null;
  kept?: boolean;
  boxStatus?: string;
  boxSeenAt?: number | null;
  lastTurnAt?: number | null;
}

const COLS: Record<Exclude<keyof ThreadUpsert, "id">, string> = {
  owner: "owner",
  title: "title",
  task: "task",
  agent: "agent",
  host: "host",
  role: "role",
  runState: "run_state",
  exitCode: "exit_code",
  question: "question",
  repos: "repos_json",
  kept: "kept",
  boxStatus: "box_status",
  boxSeenAt: "box_seen_at",
  lastTurnAt: "last_turn_at",
};

/**
 * Create or update a thread. Only the fields given are written (a sweep that could not read the
 * title must not blank it); a deleted thread stays deleted unless `revive` is set (a box seen
 * running again under a name the operator destroyed is a new thread in the same URL).
 */
export function upsertThread(db: Db, u: ThreadUpsert, now = Date.now(), opts: { revive?: boolean } = {}): void {
  assertBoxName(u.id);
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of Object.entries(COLS) as Array<[Exclude<keyof ThreadUpsert, "id">, string]>) {
    if (!(k in u) || u[k] === undefined) continue;
    const v = u[k];
    cols.push(col);
    vals.push(k === "repos" ? (v ? JSON.stringify(v) : null) : k === "kept" ? (v ? 1 : 0) : v);
  }
  const insertCols = ["id", ...cols, "created_at", "updated_at"];
  const sets = [...cols.map((c) => `${c} = excluded.${c}`), "updated_at = excluded.updated_at", ...(opts.revive ? ["deleted_at = NULL"] : [])];
  db.prepare(`INSERT INTO threads (${insertCols.join(", ")}) VALUES (${insertCols.map(() => "?").join(", ")}) ON CONFLICT(id) DO UPDATE SET ${sets.join(", ")}`).run(
    u.id,
    ...vals,
    now,
    now
  );
}

export function getThread(db: Db, id: string): ThreadRow | undefined {
  return db.prepare(`SELECT * FROM threads WHERE id = ?`).get(id) as ThreadRow | undefined;
}

/** Live threads (not deleted), newest first. */
export function listThreads(db: Db, opts: { owner?: string } = {}): ThreadRow[] {
  if (opts.owner !== undefined) return db.prepare(`SELECT * FROM threads WHERE deleted_at IS NULL AND owner IS ? ORDER BY created_at DESC`).all(opts.owner) as ThreadRow[];
  return db.prepare(`SELECT * FROM threads WHERE deleted_at IS NULL ORDER BY created_at DESC`).all() as ThreadRow[];
}

export function markThreadDeleted(db: Db, id: string, now = Date.now()): void {
  db.prepare(`UPDATE threads SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
}

/** What a sweep's view of a box writes to its thread row. Pure. */
export function threadFromBox(b: BoxView, owner: string | null, extra: { title?: string; kept?: boolean } = {}, now = Date.now()): ThreadUpsert {
  const running = /^running$/i.test(b.boxStatus);
  return {
    id: b.name,
    owner,
    role: b.role === "pool-claimed" ? "pool-claimed" : "session",
    ...(b.task ? { task: b.task } : {}),
    ...(extra.title ?? b.title ? { title: extra.title ?? b.title } : {}),
    ...(b.agent ? { agent: b.agent } : {}),
    ...(b.host ? { host: b.host } : {}),
    runState: b.runState,
    exitCode: b.exitCode ?? null,
    // A running box's question is definitive (none means answered); a stopped box cannot be asked.
    ...(running ? { question: b.question ?? null } : b.question ? { question: b.question } : {}),
    ...(b.repos?.length ? { repos: b.repos } : {}),
    ...(extra.kept !== undefined ? { kept: extra.kept } : {}),
    boxStatus: running ? "running" : "stopped",
    boxSeenAt: now,
  };
}

/**
 * What the thread table remembers of each live thread, in the fleet's run-memory shape (src/run-memory.ts).
 * Seeds the fleet's memory at load: a sleeping thread on a host that is paused or unreachable when the
 * controller starts keeps its task, question and last run state without the host being asked (asking
 * would wake a paused VM). A row whose task was never learned falls back to the head stored at claim
 * time (`taskHead`), so the dashboard names the thread instead of "No task yet". Pure.
 */
export function threadRunMetas(rows: ThreadRow[], taskHead: (id: string) => string | null | undefined = () => null): Map<string, RunMeta> {
  const out = new Map<string, RunMeta>();
  for (const r of rows) {
    if (r.deleted_at) continue;
    const task = r.task ?? taskHead(r.id) ?? undefined;
    if (!task && !r.question) continue;
    let repos: RepoRef[] | undefined;
    try {
      repos = r.repos_json ? (JSON.parse(r.repos_json) as RepoRef[]) : undefined;
    } catch {
      repos = undefined;
    }
    out.set(r.id, {
      name: r.id,
      host: r.host ?? undefined,
      role: r.role,
      runState: r.run_state,
      exitCode: r.exit_code ?? undefined,
      task,
      question: r.question ?? undefined,
      repos,
      uptime: undefined,
    });
  }
  return out;
}

/**
 * Threads whose host answered this sweep with a listing that did not have their box: the row
 * records "absent" (box_status), once. A row younger than two minutes is left alone: its box may
 * still be booting into the listing. Returns the ids written.
 */
export function noteAbsentThreads(db: Db, rows: ThreadRow[], present: ReadonlySet<string>, answered: ReadonlySet<string>, now = Date.now()): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.deleted_at || present.has(r.id) || !r.host || !answered.has(r.host) || r.box_status === "absent") continue;
    if (now - r.created_at < 120_000) continue;
    upsertThread(db, { id: r.id, boxStatus: "absent", boxSeenAt: now }, now);
    out.push(r.id);
  }
  return out;
}

/**
 * The fleet rows for threads whose box the hosts did not list this sweep. Pure.
 *   · host in `stale` (asleep or unreachable) and no listing has said the box is gone (box_status
 *     "absent", noteAbsentThreads): the box is merely out of sight → shown asleep;
 *   · a copy of the thread is kept → shown AWAY (`absent`): opening or replying brings it back;
 *   · neither → not listed (History still has it).
 */
export function threadViews(rows: ThreadRow[], present: ReadonlySet<string>, stale: ReadonlySet<string>, hasCopy: (id: string) => boolean): BoxView[] {
  const out: BoxView[] = [];
  for (const r of rows) {
    if (r.deleted_at || present.has(r.id)) continue;
    const base: BoxView = {
      name: r.id,
      role: r.role,
      boxStatus: "Stopped",
      runState: r.run_state,
      ...(r.exit_code != null ? { exitCode: r.exit_code } : {}),
      ...(r.task ? { task: r.task } : {}),
      ...(r.question ? { question: r.question } : {}),
      ...(r.title ? { title: r.title } : {}),
      ...(r.agent ? { agent: r.agent } : {}),
      ...(r.host ? { host: r.host } : {}),
      ...(r.kept ? { kept: true } : {}),
      ...(r.repos_json ? { repos: safeRepos(r.repos_json) } : {}),
    };
    if (r.host && stale.has(r.host) && r.box_status !== "absent") out.push(base);
    else if (hasCopy(r.id)) out.push({ ...base, boxStatus: "Absent", absent: true });
  }
  return out;
}

function safeRepos(json: string): RepoRef[] | undefined {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as RepoRef[]) : undefined;
  } catch {
    return undefined;
  }
}

// --- The transcript store ------------------------------------------------------------------------

export function threadDir(cfg: Pick<Config, "dataDir">, id: string): string {
  assertBoxName(id);
  return path.join(cfg.dataDir, "threads", id);
}

export function transcriptPath(cfg: Pick<Config, "dataDir">, id: string): string {
  return path.join(threadDir(cfg, id), "transcript.log");
}

/** Bytes stored so far (0 when there is no transcript yet). */
export async function transcriptSize(cfg: Pick<Config, "dataDir">, id: string): Promise<number> {
  return (await fs.stat(transcriptPath(cfg, id)).catch(() => null))?.size ?? 0;
}

export async function readTranscript(cfg: Pick<Config, "dataDir">, id: string): Promise<string | null> {
  return fs.readFile(transcriptPath(cfg, id), "utf8").catch(() => null);
}

export async function removeTranscript(cfg: Pick<Config, "dataDir">, id: string): Promise<void> {
  await fs.rm(threadDir(cfg, id), { recursive: true, force: true }).catch(() => {});
}

/**
 * The in-box read for a sync: the log's size, then either the bytes past what we hold (the log grew)
 * or the whole file behind a marker (it shrank: a restore or a revert rewrote it). Nothing when
 * the sizes match.
 */
export function syncSh(localBytes: number): string {
  const n = Math.max(0, Math.floor(localBytes));
  return (
    `f=${BOX_LOG}; s=$(stat -c %s "$f" 2>/dev/null || echo 0); echo "SIZE $s"; ` +
    `if [ "$s" -gt ${n} ]; then tail -c +${n + 1} "$f"; elif [ "$s" -lt ${n} ]; then echo "---WHOLE---"; cat "$f"; fi`
  );
}

export type SyncPlan = { kind: "none"; size: number } | { kind: "append"; text: string; size: number } | { kind: "replace"; text: string; size: number };

/**
 * What to do with a sync's answer. Only whole lines are stored: the next read starts at a line
 * start, so a multi-byte character the agent was mid-way through writing is never split across two
 * syncs (the partial line is picked up next time). Pure.
 */
export function planSync(localBytes: number, stdout: string): SyncPlan {
  const nl = stdout.indexOf("\n");
  const head = (nl >= 0 ? stdout.slice(0, nl) : stdout).trim();
  const m = /^SIZE (\d+)$/.exec(head);
  if (!m) throw new Error(`unexpected sync answer: ${stdout.slice(0, 80)}`);
  const size = Number(m[1]);
  const rest = nl >= 0 ? stdout.slice(nl + 1) : "";
  const whole = (s: string): string => {
    const lastNl = s.lastIndexOf("\n");
    return lastNl >= 0 ? s.slice(0, lastNl + 1) : "";
  };
  if (size === localBytes) return { kind: "none", size };
  if (rest.startsWith("---WHOLE---\n")) return { kind: "replace", text: whole(rest.slice("---WHOLE---\n".length)), size };
  // Smaller without the marker: a torn answer; wait for the next one.
  if (size < localBytes) return { kind: "none", size };
  const text = whole(rest);
  return text ? { kind: "append", text, size } : { kind: "none", size };
}

/**
 * Bring the stored transcript up to date with the box. `exec` runs a shell line in the box and
 * returns its stdout. Returns the bytes stored afterwards and whether anything changed.
 */
export async function syncTranscript(cfg: Pick<Config, "dataDir">, id: string, exec: (sh: string) => Promise<string>): Promise<{ bytes: number; changed: boolean }> {
  const file = transcriptPath(cfg, id);
  const have = await transcriptSize(cfg, id);
  const plan = planSync(have, await exec(syncSh(have)));
  if (plan.kind === "none") return { bytes: have, changed: false };
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (plan.kind === "append") {
    // A chunk that starts with a replacement character means our byte count drifted from the
    // box's (an invalid sequence in the log): take the whole file next time instead of appending.
    if (plan.text.startsWith("�")) {
      await fs.rm(file, { force: true });
      return { bytes: 0, changed: true };
    }
    await fs.appendFile(file, plan.text);
  } else {
    await fs.writeFile(`${file}.tmp`, plan.text);
    await fs.rename(`${file}.tmp`, file);
  }
  return { bytes: await transcriptSize(cfg, id), changed: true };
}
