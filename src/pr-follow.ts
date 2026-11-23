import type { Db } from "./db.js";
import type { WatchHit } from "./repo-watch.js";
import type { PrFollow } from "./triggers.js";

/**
 * Following a reviewed PR to its merge (watch automations with `spec.follow`). The first run on a
 * PR (the review the automation's own events started) registers the PR here; from then on the
 * watcher (src/repo-watch.ts) asks this module what a later change on that PR means: a new push
 * or a comment by someone else starts a re-review round on the same PR, a merge or close ends the
 * follow. Rounds are capped, one round runs at a time (changes that land meanwhile are queued and
 * reviewed together), and the automation's own comments never start one — the agent cannot feed
 * itself. The rows outlive controller restarts; a deleted automation takes its rows with it.
 */

export type FollowState = "open" | "merged" | "closed";

export interface FollowedPr {
  triggerId: string;
  repo: string;
  number: number;
  headSha: string;
  /** Re-review rounds started so far (the first review is round 0). */
  rounds: number;
  /** The box of the round (or first review) still running; null once it finished. */
  box: string | null;
  /** Changes that arrived while a round was running: reviewed together once it ends. */
  pending: FollowNote[];
  state: FollowState;
  createdAt: number;
  updatedAt: number;
}

/** One change worth a round, in the words the next round's task uses. */
export interface FollowNote {
  event: string;
  /** Stable key of the change (the delivery claim). */
  key: string;
  text: string;
  /** Head sha after a push. */
  sha?: string;
}

export { FOLLOW_MAX_ROUNDS, FOLLOW_DEFAULT_ROUNDS } from "./triggers.js";
const MAX_PENDING = 8;

/** The automation's own markers in comments: a receipt or a follow-up reply never starts a round. */
export const FOLLOW_MARK = "<!-- agent-sandbox:follow -->";
const OWN_MARKS = ["Agent Sandbox receipt", "<!-- agent-sandbox:followup -->", FOLLOW_MARK];

interface Row {
  trigger_id: string;
  repo: string;
  number: number;
  head_sha: string;
  rounds: number;
  box: string | null;
  pending_json: string | null;
  state: string;
  created_at: number;
  updated_at: number;
}

function parsePending(s: string | null): FollowNote[] {
  try {
    const v = s ? JSON.parse(s) : [];
    return Array.isArray(v) ? v.filter((n) => n && typeof n === "object" && typeof n.text === "string") : [];
  } catch {
    return [];
  }
}

function view(r: Row): FollowedPr {
  return {
    triggerId: r.trigger_id,
    repo: r.repo,
    number: r.number,
    headSha: r.head_sha,
    rounds: r.rounds,
    box: r.box,
    pending: parsePending(r.pending_json),
    state: r.state === "merged" || r.state === "closed" ? r.state : "open",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const keyOf = (repo: string) => repo.toLowerCase();

/** The first review of a PR started: follow it from here. A re-registration (reopened PR) resets the rounds. */
export function followPr(db: Db, f: { triggerId: string; repo: string; number: number; headSha: string; box: string }, now = Date.now()): FollowedPr {
  db.prepare(
    `INSERT INTO watch_followed_prs (trigger_id, repo, number, head_sha, rounds, box, pending_json, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, NULL, 'open', ?, ?)
     ON CONFLICT(trigger_id, repo, number) DO UPDATE SET head_sha = excluded.head_sha, rounds = 0, box = excluded.box, pending_json = NULL, state = 'open', updated_at = excluded.updated_at`
  ).run(f.triggerId, keyOf(f.repo), f.number, f.headSha, f.box, now, now);
  return getFollowed(db, f.triggerId, f.repo, f.number)!;
}

export function getFollowed(db: Db, triggerId: string, repo: string, number: number): FollowedPr | undefined {
  const r = db.prepare(`SELECT * FROM watch_followed_prs WHERE trigger_id = ? AND repo = ? AND number = ?`).get(triggerId, keyOf(repo), number) as Row | undefined;
  return r ? view(r) : undefined;
}

/** The PRs this automation follows, for its page: open first, newest first. */
export function listFollows(db: Db, triggerId: string, limit = 50): FollowedPr[] {
  return (db.prepare(`SELECT * FROM watch_followed_prs WHERE trigger_id = ? ORDER BY (state = 'open') DESC, updated_at DESC LIMIT ?`).all(triggerId, limit) as Row[]).map(view);
}

/** The PR merged or closed: the follow ends (a reopened PR registers again through its next review). */
export function settleFollow(db: Db, triggerId: string, repo: string, number: number, state: Exclude<FollowState, "open">, now = Date.now()): void {
  db.prepare(`UPDATE watch_followed_prs SET state = ?, box = NULL, pending_json = NULL, updated_at = ? WHERE trigger_id = ? AND repo = ? AND number = ?`).run(state, now, triggerId, keyOf(repo), number);
}

/** A round started in `box`: count it, remember the head it reviews, drop the queue it consumed. */
export function noteRoundStarted(db: Db, triggerId: string, repo: string, number: number, box: string, headSha: string | undefined, now = Date.now()): void {
  db.prepare(`UPDATE watch_followed_prs SET rounds = rounds + 1, box = ?, head_sha = COALESCE(?, head_sha), pending_json = NULL, updated_at = ? WHERE trigger_id = ? AND repo = ? AND number = ?`).run(
    box, headSha ?? null, now, triggerId, keyOf(repo), number
  );
}

/** A change arrived while a round was running: queue it for the next one (bounded; the newest keep the tail). */
export function queueNote(db: Db, triggerId: string, repo: string, number: number, note: FollowNote, now = Date.now()): void {
  const cur = getFollowed(db, triggerId, repo, number);
  if (!cur) return;
  const pending = [...cur.pending.filter((n) => n.key !== note.key), note].slice(-MAX_PENDING);
  db.prepare(`UPDATE watch_followed_prs SET pending_json = ?, updated_at = ? WHERE trigger_id = ? AND repo = ? AND number = ?`).run(JSON.stringify(pending), now, triggerId, keyOf(repo), number);
}

/** A round that could not start drops the changes it was for: the next one on the PR gets another go. */
export function clearRound(db: Db, triggerId: string, repo: string, number: number, now = Date.now()): void {
  db.prepare(`UPDATE watch_followed_prs SET box = NULL, pending_json = NULL, updated_at = ? WHERE trigger_id = ? AND repo = ? AND number = ?`).run(now, triggerId, keyOf(repo), number);
}

/** The running round's box finished (or vanished): the next change starts a new round. */
export function clearRoundBox(db: Db, triggerId: string, repo: string, number: number, now = Date.now()): void {
  db.prepare(`UPDATE watch_followed_prs SET box = NULL, updated_at = ? WHERE trigger_id = ? AND repo = ? AND number = ?`).run(now, triggerId, keyOf(repo), number);
}

/** Open follows of one automation in one repo (the watcher's per-tick view). */
export function openFollows(db: Db, triggerId: string, repo: string): FollowedPr[] {
  return (db.prepare(`SELECT * FROM watch_followed_prs WHERE trigger_id = ? AND repo = ? AND state = 'open' ORDER BY number`).all(triggerId, keyOf(repo)) as Row[]).map(view);
}

/* ───────────────────────────── decisions (pure) ───────────────────────────── */

export type FollowDecision = { kind: "ignore"; reason: string } | { kind: "settle"; state: Exclude<FollowState, "open"> } | { kind: "round"; note: FollowNote };

const excerpt = (s: string, n = 400) => {
  const t = s.replace(/\r/g, "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/**
 * What does this change on a followed PR mean under the automation's follow settings? `login` is
 * the account the watch reads as: its own comments (the review, replies, receipts) never start a
 * round, nor do bots. Whether a round may start right now (the cap, a round still running) is
 * `roundGate`'s question, so a change that must wait keeps its words for the queue.
 */
export function followDecision(follow: PrFollow, hit: WatchHit, login: string, allowForks: boolean | undefined): FollowDecision {
  if (hit.event === "pr_merged") return { kind: "settle", state: "merged" };
  if (hit.event === "pr_closed") return { kind: "settle", state: "closed" };
  if (hit.fork && !allowForks && hit.event.startsWith("pr_")) return { kind: "ignore", reason: "PR is from a fork" };
  if (hit.event === "pr_pushed" || hit.event === "pr_ready") {
    if (!follow.onPush) return { kind: "ignore", reason: "not re-reviewing pushes" };
    const pr = (hit.payload.pull_request ?? {}) as { head?: { sha?: string } };
    const sha = String(pr.head?.sha ?? "");
    const text = hit.event === "pr_ready" ? `the PR left draft (head ${sha.slice(0, 7)})` : `new commits were pushed (head is now ${sha.slice(0, 7)})`;
    return { kind: "round", note: { event: hit.event, key: hit.key, text, ...(sha ? { sha } : {}) } };
  }
  if (hit.event === "comment_created" || hit.event === "review_comment_created") {
    if (!follow.onComment) return { kind: "ignore", reason: "not re-reviewing comments" };
    const c = hit.comment;
    if (!c) return { kind: "ignore", reason: "no comment" };
    if (c.bot) return { kind: "ignore", reason: "comment is from a bot" };
    if (c.author.toLowerCase() === login.toLowerCase()) return { kind: "ignore", reason: "comment written by the watching account" };
    if (OWN_MARKS.some((m) => c.body.includes(m))) return { kind: "ignore", reason: "comment is the automation's own" };
    const rc = (hit.payload.comment ?? {}) as { path?: string; line?: number | null; html_url?: string };
    const where = hit.event === "review_comment_created" ? ` on ${rc.path ?? "a file"}${rc.line ? `:${rc.line}` : ""}` : "";
    const url = rc.html_url ? ` (${rc.html_url})` : "";
    return { kind: "round", note: { event: hit.event, key: hit.key, text: `${c.author} commented${where}${url}:\n  > ${excerpt(c.body).replace(/\n/g, "\n  > ")}` } };
  }
  return { kind: "ignore", reason: `${hit.event} is not a follow event` };
}

/** May a round start now? A running round queues the change; the cap ends the follow quietly. */
export function roundGate(follow: PrFollow, row: FollowedPr, inFlight: boolean): { ok: true } | { ok: false; reason: "running" | "capped" } {
  if (row.rounds >= follow.rounds) return { ok: false, reason: "capped" };
  if (inFlight) return { ok: false, reason: "running" };
  return { ok: true };
}

/**
 * The task of a re-review round, appended to the automation's rendered template (which still names
 * the PR): the agent learns it has been here before, what changed, and what seeing the PR through
 * means. Review threads are resolved only when the automation asks for it.
 */
export function followPreface(f: { row: FollowedPr; notes: FollowNote[]; follow: PrFollow; login: string; prUrl: string }): string {
  const round = f.row.rounds + 1;
  const since = f.row.headSha ? f.row.headSha.slice(0, 7) : "";
  const lines = [
    ``,
    `---`,
    `Follow-up round ${round} on this PR (${f.prUrl}). You reviewed it earlier as ${f.login}${since ? ` at commit ${since}` : ""}; it is not merged yet. Since then:`,
    ...f.notes.map((n) => `- ${n.text}`),
    ``,
    `You are the reviewing architect seeing this PR through to merge. Do this, in order:`,
    `1. Check out the PR branch at its current head. Read what changed since your last review${since ? ` (git diff ${since}...HEAD)` : ""} and every new comment quoted above.`,
    `2. Answer each comment by others that asks you something or disagrees with a finding: reply in that thread, briefly, and say whether you keep or withdraw the point.`,
    f.follow.resolve
      ? `3. For every review thread you opened earlier: when the new commits address it, reply "Addressed in <sha>" and resolve the thread (list them with the GraphQL query pullRequest.reviewThreads { nodes { id isResolved comments { nodes { author { login } body } } } }, then run the resolveReviewThread mutation on each). Leave a thread open when the point still stands, with one line saying what is missing.`
      : `3. For every review thread you opened earlier: when the new commits address it, reply "Addressed in <sha>". Do not resolve threads yourself; this automation leaves that to people. Leave a thread open when the point still stands, with one line saying what is missing.`,
    `4. Review the delta to the same standard as the first pass: comment inline on any new correctness bug, risky change or clear improvement. Do not repeat findings that are already on the PR.`,
    `5. Submit a review: approve when nothing blocking remains, otherwise request changes and list the blocking points. Never merge, never push to the PR branch, never close it.`,
    `End every comment you post with the line ${FOLLOW_MARK} so later rounds can tell your words from the author's.`,
  ];
  return lines.join("\n");
}
